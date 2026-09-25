import test from "node:test";
import assert from "node:assert/strict";
import { createScannerLifecycle } from "../app/scanner-lifecycle.mjs";

test("cerrar mientras abre la cámara espera el inicio y libera el dispositivo antes de reabrir",async()=>{
  const camera=createScannerLifecycle(), events=[];
  let finishStart;
  const starting=new Promise(resolve=>{finishStart=resolve;});
  const first={isScanning:false,async stop(){events.push("stop 1");this.isScanning=false;},clear(){events.push("clear 1");}};
  const second={isScanning:false,async stop(){events.push("stop 2");this.isScanning=false;},clear(){events.push("clear 2");}};
  const dispose=camera.open(async()=>first,async s=>{events.push("start 1");await starting;s.isScanning=true;},assert.fail);
  await new Promise(resolve=>setImmediate(resolve));
  const closed=dispose();
  const disposeNext=camera.open(async()=>second,async s=>{events.push("start 2");s.isScanning=true;},assert.fail);
  assert.deepEqual(events,["start 1"]);
  finishStart();await closed;
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,["start 1","stop 1","clear 1","start 2"]);
  await disposeNext();assert.equal(second.isScanning,false);
});

test("cancelar antes de abrir evita pedir cámara; un permiso denegado permite reintentar",async()=>{
  const camera=createScannerLifecycle();let created=0;let errors=0;
  const cancel=camera.open(async()=>{created++;},async()=>{},assert.fail);await cancel();assert.equal(created,0);
  const failed=camera.open(async()=>({isScanning:false,clear(){}}),async()=>{throw new Error("NotAllowedError");},()=>errors++);
  await new Promise(resolve=>setImmediate(resolve));await failed();assert.equal(errors,1);
  const stop=camera.open(async()=>({isScanning:false,clear(){}}),async()=>{created++;},assert.fail);
  await new Promise(resolve=>setImmediate(resolve));await stop();assert.equal(created,1);
});
