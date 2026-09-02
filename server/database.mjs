import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const planDays = new Map([
  ["Plan Fuerza · Mensual", 30],
  ["Plan Elite · Trimestral", 90],
  ["Plan Monster · Anual", 365],
]);

const parseHistory = (value) => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};
const defaultExpiry = (plan) => {
  const value = new Date();
  value.setDate(value.getDate() + (planDays.get(plan) ?? 30));
  return value.toISOString();
};
const clientFromRow = (row) => row ? ({
  id: row.id, token: row.token, name: row.name, phone: row.phone, plan: row.plan,
  photo: row.photo || "", createdAt: row.created_at, expiresAt: row.expires_at,
  visits: Number(row.visits || 0), stamps: Number(row.stamps || 0),
  lastVisit: row.last_visit || undefined, visitHistory: parseHistory(row.visit_history),
}) : null;
const activityFromRow = (row) => row ? ({
  id: row.id, clientId: row.client_id, clientName: row.client_name,
  type: row.type, description: row.description, createdAt: row.created_at,
}) : null;

export function openGymDatabase(path = process.env.MONSTER_DB_PATH || resolve("data/monster-gym.sqlite")) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      plan TEXT NOT NULL,
      photo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps >= 0 AND stamps <= 10),
      last_visit TEXT,
      visit_history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS clients_token_idx ON clients(token);
    CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients(phone);
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('registro','visita','premio')),
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS activities_created_idx ON activities(created_at DESC);
    CREATE INDEX IF NOT EXISTS activities_client_idx ON activities(client_id);
  `);
  return db;
}

export function getState(db) {
  const clients = db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all().map(clientFromRow);
  const activities = db.prepare("SELECT * FROM activities ORDER BY created_at DESC LIMIT 1000").all().map(activityFromRow);
  return { clients, activities };
}

export function createClient(db, input) {
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const plan = String(input.plan || "Plan Fuerza · Mensual").trim();
  if (!name || !phone) throw new Error("Nombre y WhatsApp son obligatorios.");
  const now = new Date().toISOString();
  const client = {
    id: randomUUID(), token: randomUUID(), name, phone, plan,
    photo: String(input.photo || ""), createdAt: now,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : defaultExpiry(plan),
    visits: 0, stamps: 0, lastVisit: undefined, visitHistory: [],
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO clients (id,token,name,phone,plan,photo,created_at,expires_at,visits,stamps,last_visit,visit_history) VALUES (?,?,?,?,?,?,?,?,0,0,NULL,'[]')`)
      .run(client.id, client.token, client.name, client.phone, client.plan, client.photo, client.createdAt, client.expiresAt);
    const activity = { id: randomUUID(), clientId: client.id, clientName: client.name, type: "registro", description: "Cliente registrado", createdAt: now };
    db.prepare("INSERT INTO activities (id,client_id,client_name,type,description,created_at) VALUES (?,?,?,?,?,?)")
      .run(activity.id, activity.clientId, activity.clientName, activity.type, activity.description, activity.createdAt);
    db.exec("COMMIT");
    return { client, activity };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function updateClient(db, id, input) {
  const current = clientFromRow(db.prepare("SELECT * FROM clients WHERE id=?").get(id));
  if (!current) return null;
  const name = String(input.name ?? current.name).trim();
  const phone = String(input.phone ?? current.phone).trim();
  const plan = String(input.plan ?? current.plan).trim();
  const photo = String(input.photo ?? current.photo);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : current.expiresAt;
  if (!name || !phone) throw new Error("Nombre y WhatsApp son obligatorios.");
  db.prepare("UPDATE clients SET name=?,phone=?,plan=?,photo=?,expires_at=? WHERE id=?").run(name, phone, plan, photo, expiresAt, id);
  db.prepare("UPDATE activities SET client_name=? WHERE client_id=?").run(name, id);
  return clientFromRow(db.prepare("SELECT * FROM clients WHERE id=?").get(id));
}

export function deleteClient(db, id) {
  const info = db.prepare("DELETE FROM clients WHERE id=?").run(id);
  return Number(info.changes || 0) > 0;
}

export function registerVisit(db, id) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const client = clientFromRow(db.prepare("SELECT * FROM clients WHERE id=?").get(id));
    if (!client) { db.exec("ROLLBACK"); return null; }
    const now = new Date().toISOString();
    const nextStamps = Math.min(client.stamps + 1, 10);
    const history = client.stamps < 10 ? [...client.visitHistory, now] : client.visitHistory;
    const rewardUnlocked = client.stamps < 10 && nextStamps === 10;
    db.prepare("UPDATE clients SET visits=?,stamps=?,last_visit=?,visit_history=? WHERE id=?")
      .run(client.visits + 1, nextStamps, now, JSON.stringify(history), id);
    const activity = {
      id: randomUUID(), clientId: client.id, clientName: client.name,
      type: rewardUnlocked ? "premio" : "visita",
      description: rewardUnlocked ? "Recompensa desbloqueada" : `Visita registrada · Sello ${nextStamps}/10`, createdAt: now,
    };
    db.prepare("INSERT INTO activities (id,client_id,client_name,type,description,created_at) VALUES (?,?,?,?,?,?)")
      .run(activity.id, activity.clientId, activity.clientName, activity.type, activity.description, activity.createdAt);
    db.exec("COMMIT");
    return { client: clientFromRow(db.prepare("SELECT * FROM clients WHERE id=?").get(id)), activity };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
