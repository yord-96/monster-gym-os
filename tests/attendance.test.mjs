import test from "node:test";
import assert from "node:assert/strict";
import { attendanceDay,filterAttendance } from "../app/attendance-utils.mjs";
const clients=[{id:"a",name:"José Pérez",phone:"76543210",plan:"Mensual"},{id:"b",name:"Ana",phone:"70000000",plan:"Top"}];
const activities=[
  {id:"sun",clientId:"a",clientName:"José Pérez",type:"visita",createdAt:"2026-09-14T03:59:59.000Z"},
  {id:"mon",clientId:"a",clientName:"José Pérez",type:"visita",createdAt:"2026-09-14T04:00:00.000Z"},
  {id:"new",clientId:"b",clientName:"Ana",type:"registro",createdAt:"2026-09-14T15:00:00.000Z"},
  {id:"old",clientId:"a",clientName:"José Pérez",type:"premio",createdAt:"2026-08-31T12:00:00.000Z"},
];
const now=new Date("2026-09-14T20:00:00Z");
test("asistencias: hoy y semana respetan medianoche de Bolivia y lunes",()=>{
  assert.equal(attendanceDay(activities[0].createdAt),"2026-09-13");
  for(const period of ["today","week"]) assert.deepEqual(filterAttendance(activities,clients,{period,now}).map(a=>a.id),["new","mon"]);
  assert.deepEqual(filterAttendance(activities,clients,{period:"month",now}).map(a=>a.id),["new","mon","sun"]);
});
test("asistencias: combina período, tipo, cliente y búsquedas sin tildes",()=>{
  assert.deepEqual(filterAttendance(activities,clients,{query:"JOSE",type:"premio",now}).map(a=>a.id),["old"]);
  assert.equal(filterAttendance(activities,clients,{query:"76543210",now}).length,3);
  assert.equal(filterAttendance(activities,clients,{query:"mensual",period:"today",now}).length,1);
  assert.equal(filterAttendance(activities,clients,{clientId:"a",query:"Ana",now}).length,0);
  assert.equal(filterAttendance([],clients,{period:"today",now}).length,0);
});
