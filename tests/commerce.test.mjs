import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openGymDatabase, createClient, registerPayment, deleteClient, getState } from "../server/database.mjs";
import { saveProduct, createCashReceipt, getDailyReport } from "../server/commerce.mjs";

const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/La_Paz",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),"monster-cash-"));
  const db=openGymDatabase(join(dir,"test.sqlite"));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const client=createClient(db,{name:"Cliente Caja",phone:"70000001",planId:"plan-monthly"}).client;
  return {db,client};
}
test("reportes concilian membresías, inscripción y venta; no duplica reintentos",t=>{
  const {db,client}=setup(t);
  const requestKey=randomUUID();
  const payment=registerPayment(db,client.id,{amount:60,method:"cash",requestKey,membershipId:client.membershipId});
  assert.equal(registerPayment(db,client.id,{amount:60,method:"cash",requestKey}).payment.id,payment.payment.id);
  const product=saveProduct(db,{name:"Agua",price:7.5});
  const sale={kind:"sale",method:"qr",voucherPath:"/uploads/vouchers/venta.jpg",requestKey:randomUUID(),items:[{productId:product.id,unitPrice:7.5,quantity:3}]};
  const receipt=createCashReceipt(db,sale);
  assert.equal(createCashReceipt(db,sale).id,receipt.id);
  createCashReceipt(db,{kind:"registration",method:"cash",clientId:client.id,amount:25,requestKey:randomUUID()});
  const report=getDailyReport(db,today());
  assert.deepEqual(report.totals,{total:107.5,cash:85,qr:22.5,membership:60,registration:25,sale:22.5,count:3});
  assert.equal(getState(db).clients[0].balance,100,"la inscripción no paga ni renueva el plan");
  assert.equal(report.receipts.find(r=>r.id===receipt.id).voucherUrl,sale.voucherPath);
});
test("los precios se validan en servidor y el historial sobrevive a cambios y eliminación de cliente",t=>{
  const {db,client}=setup(t);
  const product=saveProduct(db,{name:"Polera",price:55});
  const sale=createCashReceipt(db,{kind:"sale",clientId:client.id,method:"cash",requestKey:randomUUID(),items:[{productId:product.id,unitPrice:55,quantity:2}]});
  registerPayment(db,client.id,{amount:160,method:"cash"});
  saveProduct(db,{name:"Polera nueva",price:80,active:false},product.id);
  deleteClient(db,client.id);
  const report=getDailyReport(db,today());
  assert.equal(report.totals.total,270);
  const saved=report.receipts.find(r=>r.id===sale.id);
  assert.equal(saved.clientName,"Cliente Caja");
  assert.deepEqual(saved.lines[0],{productId:product.id,name:"Polera",quantity:2,unitPrice:55,total:110});
});
test("rechaza importes, métodos, clientes, productos y cantidades inválidos sin registrar ingresos",t=>{
  const {db,client}=setup(t);
  const product=saveProduct(db,{name:"Agua",price:5});
  for(const amount of [0,-1,Infinity,NaN,.001,2.123]) assert.throws(()=>saveProduct(db,{name:"Inválido",price:amount}));
  const base={kind:"sale",method:"cash",requestKey:randomUUID()};
  for(const items of [[],[{productId:product.id,quantity:0,unitPrice:5}],[{productId:product.id,quantity:1.5,unitPrice:5}],[{productId:product.id,quantity:1,unitPrice:1}],[{productId:product.id,quantity:1,unitPrice:5},{productId:"missing",quantity:1,unitPrice:5}]]) assert.throws(()=>createCashReceipt(db,{...base,items}));
  assert.throws(()=>createCashReceipt(db,{...base,kind:"registration",amount:20}));
  assert.throws(()=>createCashReceipt(db,{...base,kind:"registration",clientId:client.id,amount:20,method:"qr"}));
  assert.throws(()=>createCashReceipt(db,{...base,kind:"registration",clientId:client.id,amount:20,method:"other"}));
  assert.throws(()=>registerPayment(db,client.id,{amount:10,method:"cash",membershipId:"stale"}));
  assert.throws(()=>registerPayment(db,client.id,{amount:160.01,method:"cash"}));
  assert.equal(getDailyReport(db,today()).totals.count,0);
});
test("el reporte usa límites de día en Bolivia y rechaza fechas inexistentes",t=>{
  const {db,client}=setup(t);
  const ids=[];
  for(let i=0;i<4;i++) ids.push(createCashReceipt(db,{kind:"registration",clientId:client.id,amount:1,method:"cash",requestKey:randomUUID()}).id);
  ["2026-09-13T03:59:59.999Z","2026-09-13T04:00:00.000Z","2026-09-14T03:59:59.999Z","2026-09-14T04:00:00.000Z"].forEach((time,i)=>db.prepare("UPDATE cash_receipts SET created_at=? WHERE id=?").run(time,ids[i]));
  assert.equal(getDailyReport(db,"2026-09-13").totals.total,2);
  assert.throws(()=>getDailyReport(db,"2026-02-30"));
  assert.throws(()=>getDailyReport(db,"2026-13-01"));
});
test("la migración incorpora pagos anteriores una sola vez y conserva vouchers",()=>{
  const dir=mkdtempSync(join(tmpdir(),"monster-migration-"));const path=join(dir,"test.sqlite");let db=openGymDatabase(path);
  try {
    const client=createClient(db,{name:"Histórico",phone:"70000002"}).client;
    registerPayment(db,client.id,{amount:50,method:"qr",voucherPath:"/uploads/vouchers/historico.jpg"});
    db.exec("DROP TRIGGER payment_cash_receipt; DROP TABLE cash_receipts;"); db.close();
    db=openGymDatabase(path); assert.equal(getDailyReport(db,today()).totals.total,50); db.close();
    db=openGymDatabase(path);const report=getDailyReport(db,today());assert.equal(report.totals.count,1);assert.equal(report.receipts[0].voucherUrl,"/uploads/vouchers/historico.jpg");
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
