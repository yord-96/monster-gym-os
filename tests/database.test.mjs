import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openGymDatabase, getState, createClient, updateClient, deleteClient, registerVisit } from "../server/database.mjs";

test("SQLite central soporta CRUD y visitas", () => {
  const dir = mkdtempSync(join(tmpdir(), "monster-gym-"));
  const db = openGymDatabase(join(dir, "test.sqlite"));
  try {
    const created = createClient(db, { name: "Cliente Prueba", phone: "70000000", plan: "Plan Fuerza · Mensual" });
    assert.equal(getState(db).clients.length, 1);
    const edited = updateClient(db, created.client.id, { name: "Cliente Editado", phone: "71111111" });
    assert.equal(edited.name, "Cliente Editado");
    const visit = registerVisit(db, created.client.id);
    assert.equal(visit.client.visits, 1);
    assert.equal(visit.client.stamps, 1);
    assert.equal(visit.client.visitHistory.length, 1);
    assert.equal(deleteClient(db, created.client.id), true);
    assert.equal(getState(db).clients.length, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
