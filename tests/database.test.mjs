import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  openGymDatabase, getState, createClient, updateClient, deleteClient, registerVisit,
  getPlans, updatePlan, registerPayment, getPayments, renewMembership, addMonthsClampedIso,
} from "../server/database.mjs";

test("modelos de tarjeta rotan entre seis animales y permanecen al editar, eliminar y reabrir", () => {
  const dir = mkdtempSync(join(tmpdir(), "monsters-cards-"));
  const path = join(dir, "test.sqlite");
  let db = openGymDatabase(path);
  try {
    const clients = Array.from({length:8}, (_, i) => createClient(db, {name:`Miembro ${i}`,phone:`7000000${i}`}).client);
    assert.deepEqual(clients.map(c => c.cardVariant), [0,1,2,3,4,5,0,1]);
    assert.equal(updateClient(db,clients[2].id,{name:"Nombre actualizado"}).cardVariant,2);
    deleteClient(db,clients[7].id);
    db.close(); db = openGymDatabase(path);
    assert.equal(getState(db).clients.find(c => c.id === clients[2].id).cardVariant,2);
    assert.equal(createClient(db,{name:"Siguiente",phone:"71111111"}).client.cardVariant,2);
  } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("asigna modelos una sola vez a clientes anteriores sin alterar visitas ni QR", () => {
  const dir = mkdtempSync(join(tmpdir(), "monsters-card-migration-"));
  const path = join(dir,"test.sqlite");
  let db = openGymDatabase(path);
  try {
    const clients = Array.from({length:7}, (_, i) => createClient(db,{name:`Anterior ${i}`,phone:`7555555${i}`}).client);
    registerVisit(db,clients[0].id);
    db.exec("ALTER TABLE clients DROP COLUMN card_variant; DELETE FROM settings WHERE key='next_card_variant';");
    db.close(); db = openGymDatabase(path);
    const migrated = getState(db).clients;
    assert.deepEqual(clients.map(c=>migrated.find(m=>m.id===c.id).cardVariant),[0,1,2,3,4,5,0]);
    assert.equal(migrated.find(c=>c.id===clients[0].id).visits,1);
    assert.equal(migrated.find(c=>c.id===clients[0].id).token,clients[0].token);
    db.close(); db = openGymDatabase(path);
    assert.equal(createClient(db,{name:"Nuevo",phone:"76666666"}).client.cardVariant,1);
  } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("SQLite central soporta CRUD, planes, pagos y sesiones", () => {
  const dir = mkdtempSync(join(tmpdir(), "monster-gym-"));
  const db = openGymDatabase(join(dir, "test.sqlite"));
  try {
    const plans = getPlans(db);
    const monthly = plans.find((plan) => plan.id === "plan-monthly");
    const sessions = plans.find((plan) => plan.id === "plan-12-sessions");
    const top = plans.find((plan) => plan.id === "plan-top");

    assert.equal(monthly.price, 160);
    assert.equal(monthly.durationMonths, 1);
    assert.equal(sessions.sessionLimit, 12);
    assert.equal(top.price, 130);

    const configuredSessions = updatePlan(db, sessions.id, { price: 140, active: true });
    assert.equal(configuredSessions.price, 140);

    const created = createClient(db, {
      name: "Cliente Prueba",
      phone: "70000000",
      planId: monthly.id,
      startsAt: new Date().toISOString(),
    });
    assert.equal(getState(db).clients.length, 1);
    assert.equal(created.client.membershipPrice, 160);
    assert.equal(created.client.balance, 160);
    assert.equal(created.client.paymentStatus, "due");
    assert.equal(created.client.accessStatus, "active");

    const partial = registerPayment(db, created.client.id, { amount: 60, method: "cash" });
    assert.equal(partial.client.paidAmount, 60);
    assert.equal(partial.client.balance, 100);
    assert.equal(partial.client.paymentStatus, "partial");

    const paid = registerPayment(db, created.client.id, { amount: 100, method: "qr", voucherPath: "/uploads/vouchers/test.jpg" });
    assert.equal(paid.client.balance, 0);
    assert.equal(paid.client.paymentStatus, "paid");
    assert.equal(getPayments(db, created.client.id).length, 2);

    const edited = updateClient(db, created.client.id, { name: "Cliente Editado", phone: "71111111" });
    assert.equal(edited.name, "Cliente Editado");

    const renewed = renewMembership(db, created.client.id, { planId: sessions.id, startsAt: new Date().toISOString() });
    assert.equal(renewed.sessionLimit, 12);
    assert.equal(renewed.sessionsUsed, 0);
    assert.equal(renewed.balance, 140);

    registerPayment(db, created.client.id, { amount: 140, method: "cash" });
    for (let index = 0; index < 12; index += 1) registerVisit(db, created.client.id);
    const afterTwelve = getState(db).clients.find((client) => client.id === created.client.id);
    assert.equal(afterTwelve.sessionsUsed, 12);
    assert.equal(afterTwelve.visits, 12);
    assert.equal(afterTwelve.accessStatus, "sessions_exhausted");
    assert.throws(() => registerVisit(db, created.client.id), /12 sesiones/);

    assert.equal(deleteClient(db, created.client.id), true);
    assert.equal(getState(db).clients.length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("bloquea por deuda después de 14 días y respeta suspensión manual", () => {
  const dir = mkdtempSync(join(tmpdir(), "monster-gym-debt-"));
  const db = openGymDatabase(join(dir, "test.sqlite"));
  try {
    const monthly = getPlans(db).find((plan) => plan.id === "plan-monthly");
    const oldStart = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const created = createClient(db, { name: "Cliente Deudor", phone: "72222222", planId: monthly.id, startsAt: oldStart });
    const due = getState(db).clients.find((client) => client.id === created.client.id);
    assert.equal(due.accessStatus, "debt_suspended");
    assert.throws(() => registerVisit(db, created.client.id), /Pago pendiente/);

    const paid = registerPayment(db, created.client.id, { amount: 160, method: "cash" });
    assert.equal(paid.client.accessStatus, "active");

    const suspended = updateClient(db, created.client.id, { manualSuspended: true });
    assert.equal(suspended.accessStatus, "manual_suspended");
    assert.throws(() => registerVisit(db, created.client.id), /suspendido manualmente/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("la vigencia mensual es fecha a fecha con ajuste de fin de mes", () => {
  assert.match(addMonthsClampedIso("2026-09-02T12:00:00.000Z", 1), /^2026-10-02/);
  assert.match(addMonthsClampedIso("2026-01-31T12:00:00.000Z", 1), /^2026-02-28/);
});
