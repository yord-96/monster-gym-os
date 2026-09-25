import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { initCommerce } from "./commerce.mjs";
import { photoUrl } from "./delivery.mjs";

const DEFAULT_PLAN_IDS = {
  monthly: "plan-monthly",
  sessions12: "plan-12-sessions",
  top: "plan-top",
};

const nowIso = () => new Date().toISOString();
const money = (value) => Math.max(0, Math.round(Number(value || 0) * 100));
const fromCents = (value) => Number(value || 0) / 100;

function addMonthsClampedIso(startValue, months = 1) {
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) throw new Error("Fecha de inicio inválida.");
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1, 23, 59, 59, 999));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0, 23, 59, 59, 999)).getUTCDate();
  targetFirst.setUTCDate(Math.min(day, lastDay));
  return targetFirst.toISOString();
}

function addDaysIso(startValue, days) {
  const value = new Date(startValue);
  if (Number.isNaN(value.getTime())) throw new Error("Fecha inválida.");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

const parseHistory = (value) => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};

const activityFromRow = (row) => row ? ({
  id: row.id,
  clientId: row.client_id,
  clientName: row.client_name,
  type: row.type,
  description: row.description,
  createdAt: row.created_at,
}) : null;

const paymentFromRow = (row) => row ? ({
  id: row.id,
  clientId: row.client_id,
  membershipId: row.membership_id,
  amount: fromCents(row.amount_cents),
  method: row.method,
  voucherUrl: row.voucher_path || "",
  note: row.note || "",
  createdAt: row.created_at,
}) : null;

const planFromRow = (row) => row ? ({
  id: row.id,
  name: row.name,
  price: fromCents(row.price_cents),
  billingType: row.billing_type,
  sessionLimit: row.session_limit == null ? null : Number(row.session_limit),
  durationMonths: Number(row.duration_months || 1),
  active: Boolean(row.active),
  sortOrder: Number(row.sort_order || 0),
}) : null;

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function seedPlans(db) {
  const createdAt = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO plans
      (id,name,price_cents,billing_type,session_limit,duration_months,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  insert.run(DEFAULT_PLAN_IDS.monthly, "Mensual", 16000, "unlimited", null, 1, 1, 10, createdAt, createdAt);
  insert.run(DEFAULT_PLAN_IDS.sessions12, "12 sesiones", 0, "sessions", 12, 1, 0, 20, createdAt, createdAt);
  insert.run(DEFAULT_PLAN_IDS.top, "Top", 13000, "unlimited", null, 1, 1, 30, createdAt, createdAt);
}

function migrateLegacyClients(db) {
  const withoutMembership = db.prepare(`
    SELECT c.* FROM clients c
    LEFT JOIN memberships m ON m.client_id=c.id AND m.is_current=1
    WHERE m.id IS NULL
  `).all();
  if (!withoutMembership.length) return;

  const monthly = db.prepare("SELECT * FROM plans WHERE id=?").get(DEFAULT_PLAN_IDS.monthly);
  const insert = db.prepare(`
    INSERT INTO memberships
      (id,client_id,plan_id,plan_name,price_cents,starts_at,expires_at,grace_until,session_limit,sessions_used,is_current,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
  `);

  for (const row of withoutMembership) {
    const start = row.created_at || nowIso();
    const expires = row.expires_at || addMonthsClampedIso(start, 1);
    insert.run(
      randomUUID(), row.id, monthly.id, monthly.name, monthly.price_cents,
      start, expires, addDaysIso(start, 14), null, 0, nowIso(),
    );
    db.prepare("UPDATE clients SET plan=?, expires_at=? WHERE id=?").run(monthly.name, expires, row.id);
  }
}

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

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL DEFAULT 0,
      billing_type TEXT NOT NULL DEFAULT 'unlimited' CHECK(billing_type IN ('unlimited','sessions')),
      session_limit INTEGER,
      duration_months INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      grace_until TEXT NOT NULL,
      session_limit INTEGER,
      sessions_used INTEGER NOT NULL DEFAULT 0,
      is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
    CREATE INDEX IF NOT EXISTS memberships_client_idx ON memberships(client_id);
    CREATE INDEX IF NOT EXISTS memberships_current_idx ON memberships(client_id,is_current);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      method TEXT NOT NULL CHECK(method IN ('cash','qr')),
      voucher_path TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY(membership_id) REFERENCES memberships(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS payments_client_idx ON payments(client_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS payments_membership_idx ON payments(membership_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "clients", "manual_suspended", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "clients", "gender", "TEXT CHECK(gender IN ('male','female'))");
  ensureColumn(db, "clients", "card_variant", "INTEGER CHECK(card_variant >= 0 AND card_variant < 6)");
  // Assign legacy members once, in registration order. Keep the next model even
  // when a member is deleted so assignments never shift or restart.
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const client of db.prepare("SELECT id FROM clients WHERE card_variant IS NULL ORDER BY created_at, rowid").all()) {
      db.prepare("UPDATE clients SET card_variant=? WHERE id=?").run(nextCardVariant(db), client.id);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  ensureColumn(db, "payments", "request_key", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payments_request_idx ON payments(request_key) WHERE request_key IS NOT NULL;");

  seedPlans(db);
  migrateLegacyClients(db);
  initCommerce(db);
  return db;
}

function currentMembershipRow(db, clientId) {
  return db.prepare(`
    SELECT * FROM memberships
    WHERE client_id=? AND is_current=1
    ORDER BY created_at DESC LIMIT 1
  `).get(clientId);
}

function nextCardVariant(db) {
  const current = Number(db.prepare("SELECT value FROM settings WHERE key='next_card_variant'").get()?.value || 0) % 6;
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('next_card_variant',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(String((current + 1) % 6), nowIso());
  return current;
}

function paidCentsForMembership(db, membershipId) {
  const row = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE membership_id=?").get(membershipId);
  return Number(row?.total || 0);
}

function accessFor(clientRow, membership, paidCents, now = new Date()) {
  if (!membership) return { status: "expired", reason: "Sin membresía activa." };
  if (Number(clientRow.manual_suspended || 0) === 1) return { status: "manual_suspended", reason: "Cliente suspendido manualmente." };
  if (now > new Date(membership.expires_at)) return { status: "expired", reason: `Plan vencido el ${membership.expires_at}.` };
  if (membership.session_limit != null && Number(membership.sessions_used || 0) >= Number(membership.session_limit)) {
    return { status: "sessions_exhausted", reason: `Se utilizaron las ${membership.session_limit} sesiones del plan.` };
  }
  const balance = Math.max(0, Number(membership.price_cents || 0) - paidCents);
  if (balance > 0 && now > new Date(membership.grace_until)) {
    return { status: "debt_suspended", reason: "Pago pendiente fuera del período de tolerancia." };
  }
  return { status: "active", reason: balance > 0 ? "Ingreso habilitado dentro del período de tolerancia." : "Ingreso autorizado." };
}

function clientFromRow(db, row) {
  if (!row) return null;
  const membership = currentMembershipRow(db, row.id);
  const paidCents = membership ? paidCentsForMembership(db, membership.id) : 0;
  const balanceCents = membership ? Math.max(0, Number(membership.price_cents || 0) - paidCents) : 0;
  const access = accessFor(row, membership, paidCents);
  const paymentStatus = balanceCents === 0 ? "paid" : paidCents > 0 ? "partial" : "due";

  return {
    id: row.id,
    token: row.token,
    cardVariant: Number(row.card_variant ?? 0),
    gender: row.gender ?? null,
    name: row.name,
    phone: row.phone,
    plan: membership?.plan_name || row.plan,
    planId: membership?.plan_id || "",
    photo: photoUrl(row.id, row.photo || ""),
    createdAt: row.created_at,
    expiresAt: membership?.expires_at || row.expires_at,
    visits: Number(row.visits || 0),
    stamps: Number(row.stamps || 0),
    lastVisit: row.last_visit || undefined,
    visitHistory: parseHistory(row.visit_history),
    membershipId: membership?.id || "",
    membershipStartedAt: membership?.starts_at || row.created_at,
    membershipPrice: fromCents(membership?.price_cents || 0),
    paidAmount: fromCents(paidCents),
    balance: fromCents(balanceCents),
    paymentStatus,
    graceUntil: membership?.grace_until || "",
    sessionLimit: membership?.session_limit == null ? null : Number(membership.session_limit),
    sessionsUsed: Number(membership?.sessions_used || 0),
    manualSuspended: Boolean(row.manual_suspended),
    accessStatus: access.status,
    accessReason: access.reason,
  };
}

function getClientById(db, id) {
  return clientFromRow(db, db.prepare("SELECT * FROM clients WHERE id=?").get(id));
}

export function getPlans(db, includeInactive = true) {
  const sql = includeInactive
    ? "SELECT * FROM plans ORDER BY sort_order,name"
    : "SELECT * FROM plans WHERE active=1 ORDER BY sort_order,name";
  return db.prepare(sql).all().map(planFromRow);
}

export function createPlan(db, input) {
  const name = String(input.name || "").trim();
  const price = Number(input.price ?? 0);
  const billingType = input.billingType === "sessions" ? "sessions" : "unlimited";
  const sessionLimit = billingType === "sessions" ? Math.max(1, Number(input.sessionLimit || 1)) : null;
  const durationMonths = Math.max(1, Number(input.durationMonths || 1));
  if (!name) throw new Error("El nombre del plan es obligatorio.");
  if (!Number.isFinite(price) || price < 0) throw new Error("Precio inválido.");

  const id = randomUUID();
  const now = nowIso();
  const sortOrder = Number(input.sortOrder || 100);
  db.prepare(`
    INSERT INTO plans (id,name,price_cents,billing_type,session_limit,duration_months,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, name, money(price), billingType, sessionLimit, durationMonths, 1, sortOrder, now, now);
  return planFromRow(db.prepare("SELECT * FROM plans WHERE id=?").get(id));
}

export function updatePlan(db, id, input) {
  const current = db.prepare("SELECT * FROM plans WHERE id=?").get(id);
  if (!current) return null;
  const name = String(input.name ?? current.name).trim();
  const priceCents = input.price == null ? Number(current.price_cents) : money(input.price);
  const billingType = (input.billingType ?? current.billing_type) === "sessions" ? "sessions" : "unlimited";
  const sessionLimit = billingType === "sessions"
    ? Math.max(1, Number(input.sessionLimit ?? current.session_limit ?? 1))
    : null;
  const durationMonths = Math.max(1, Number(input.durationMonths ?? current.duration_months ?? 1));
  const active = input.active == null ? Number(current.active) : (input.active ? 1 : 0);
  if (!name) throw new Error("El nombre del plan es obligatorio.");
  db.prepare(`
    UPDATE plans SET name=?,price_cents=?,billing_type=?,session_limit=?,duration_months=?,active=?,updated_at=?
    WHERE id=?
  `).run(name, priceCents, billingType, sessionLimit, durationMonths, active, nowIso(), id);
  return planFromRow(db.prepare("SELECT * FROM plans WHERE id=?").get(id));
}

export function getSettings(db) {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return { paymentQrUrl: values.payment_qr_url || "" };
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, String(value || ""), nowIso());
}

export function getState(db) {
  const clients = db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all().map((row) => clientFromRow(db, row));
  const activities = db.prepare("SELECT * FROM activities ORDER BY created_at DESC LIMIT 1000").all().map(activityFromRow);
  return { clients, activities, plans: getPlans(db), settings: getSettings(db) };
}

function membershipFromPlan(db, clientId, planId, startValue) {
  const plan = db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(planId);
  if (!plan) throw new Error("Selecciona un plan válido.");
  const start = new Date(startValue || nowIso());
  if (Number.isNaN(start.getTime())) throw new Error("Fecha de inicio inválida.");
  const startsAt = start.toISOString();
  return {
    id: randomUUID(),
    clientId,
    planId: plan.id,
    planName: plan.name,
    priceCents: Number(plan.price_cents || 0),
    startsAt,
    expiresAt: addMonthsClampedIso(startsAt, Number(plan.duration_months || 1)),
    graceUntil: addDaysIso(startsAt, 14),
    sessionLimit: plan.session_limit == null ? null : Number(plan.session_limit),
    sessionsUsed: 0,
    createdAt: nowIso(),
  };
}

function insertMembership(db, membership) {
  db.prepare(`
    INSERT INTO memberships
      (id,client_id,plan_id,plan_name,price_cents,starts_at,expires_at,grace_until,session_limit,sessions_used,is_current,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
  `).run(
    membership.id, membership.clientId, membership.planId, membership.planName,
    membership.priceCents, membership.startsAt, membership.expiresAt,
    membership.graceUntil, membership.sessionLimit, membership.sessionsUsed, membership.createdAt,
  );
}

export function createClient(db, input) {
  const gender = input.gender || null;
  if (gender !== null && !["male","female"].includes(gender)) throw new Error("Selecciona Varón o Mujer.");
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  if (!name || !phone) throw new Error("Nombre y WhatsApp son obligatorios.");
  const planId = String(input.planId || DEFAULT_PLAN_IDS.monthly);
  const now = nowIso();
  const id = randomUUID();
  const token = randomUUID();
  const membership = membershipFromPlan(db, id, planId, input.startsAt || now);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO clients
        (id,token,name,phone,plan,photo,created_at,expires_at,visits,stamps,last_visit,visit_history,manual_suspended,card_variant,gender)
      VALUES (?,?,?,?,?,?,?,?,0,0,NULL,'[]',0,?,?)
    `).run(id, token, name, phone, membership.planName, String(input.photo || ""), now, membership.expiresAt, nextCardVariant(db),gender);
    insertMembership(db, membership);
    const activity = {
      id: randomUUID(), clientId: id, clientName: name, type: "registro",
      description: `Cliente registrado · ${membership.planName}`, createdAt: now,
    };
    db.prepare("INSERT INTO activities (id,client_id,client_name,type,description,created_at) VALUES (?,?,?,?,?,?)")
      .run(activity.id, activity.clientId, activity.clientName, activity.type, activity.description, activity.createdAt);
    db.exec("COMMIT");
    return { client: getClientById(db, id), activity };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function updateClient(db, id, input) {
  const current = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!current) return null;
  const name = String(input.name ?? current.name).trim();
  const phone = String(input.phone ?? current.phone).trim();
  const photo = input.photo == null || input.photo === photoUrl(id, current.photo)
    ? current.photo : String(input.photo);
  const manualSuspended = input.manualSuspended == null ? Number(current.manual_suspended || 0) : (input.manualSuspended ? 1 : 0);
  if (!name || !phone) throw new Error("Nombre y WhatsApp son obligatorios.");
  const gender = input.gender === undefined ? current.gender : input.gender || null;
  if (gender !== null && !["male","female"].includes(gender)) throw new Error("Selecciona Varón o Mujer.");
  db.prepare("UPDATE clients SET name=?,phone=?,photo=?,manual_suspended=?,gender=? WHERE id=?")
    .run(name, phone, photo, manualSuspended, gender, id);
  db.prepare("UPDATE activities SET client_name=? WHERE client_id=?").run(name, id);
  return getClientById(db, id);
}

export function renewMembership(db, clientId, input) {
  const client = db.prepare("SELECT * FROM clients WHERE id=?").get(clientId);
  if (!client) return null;
  const current = currentMembershipRow(db,clientId);
  if (current && paidCentsForMembership(db,current.id) < current.price_cents) throw new Error("Cobra el saldo pendiente antes de renovar el plan.");
  const membership = membershipFromPlan(db, clientId, String(input.planId || DEFAULT_PLAN_IDS.monthly), input.startsAt || nowIso());
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE memberships SET is_current=0,ended_at=? WHERE client_id=? AND is_current=1").run(nowIso(), clientId);
    insertMembership(db, membership);
    db.prepare("UPDATE clients SET plan=?,expires_at=? WHERE id=?").run(membership.planName, membership.expiresAt, clientId);
    db.exec("COMMIT");
    return getClientById(db, clientId);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function deleteClient(db, id) {
  const info = db.prepare("DELETE FROM clients WHERE id=?").run(id);
  return Number(info.changes || 0) > 0;
}

export function getPayments(db, clientId) {
  return db.prepare("SELECT * FROM payments WHERE client_id=? ORDER BY created_at DESC").all(clientId).map(paymentFromRow);
}

function insertPayment(db, clientId, input) {
  const requestKey = input.requestKey ? String(input.requestKey) : null;
  if (requestKey) {
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) throw new Error("Identificador de pago inválido.");
    const previous = db.prepare("SELECT * FROM payments WHERE request_key=?").get(requestKey);
    if (previous) {
      if (previous.client_id !== clientId) throw new Error("El identificador pertenece a otro cliente.");
      return { payment:paymentFromRow(previous),client:getClientById(db,clientId) };
    }
  }
  const client = db.prepare("SELECT * FROM clients WHERE id=?").get(clientId);
  if (!client) return null;
  const membership = currentMembershipRow(db, clientId);
  if (!membership) throw new Error("El cliente no tiene una membresía activa.");
  if (input.membershipId && input.membershipId !== membership.id) throw new Error("La membresía cambió. Vuelve a abrir el cobro.");

  const amount = Number(input.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Ingresa un monto válido.");
  const currentPaid = paidCentsForMembership(db, membership.id);
  const balance = Math.max(0, Number(membership.price_cents || 0) - currentPaid);
  const amountCents = money(amount);
  if (amountCents < 1 || Math.abs(amount*100-amountCents)>0.00001) throw new Error("Usa un monto positivo con un máximo de dos decimales.");
  if (balance <= 0) throw new Error("Esta membresía ya está pagada completamente.");
  if (amountCents > balance) throw new Error(`El monto supera el saldo pendiente de Bs ${fromCents(balance).toFixed(2)}.`);

  if (!["cash","qr"].includes(input.method)) throw new Error("Método de pago inválido.");
  const method = input.method;
  const voucherPath = String(input.voucherPath || "");
  if (method === "qr" && !voucherPath) throw new Error("Adjunta la foto del voucher para registrar un pago por QR.");

  const payment = {
    id: randomUUID(),
    clientId,
    membershipId: membership.id,
    amountCents,
    method,
    voucherPath,
    note: String(input.note || "").trim(),
    createdAt: nowIso(),
  };
  db.prepare(`
    INSERT INTO payments(id,client_id,membership_id,amount_cents,method,voucher_path,note,created_at,request_key)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(payment.id, payment.clientId, payment.membershipId, payment.amountCents, payment.method, payment.voucherPath, payment.note, payment.createdAt,requestKey);

  return { payment: paymentFromRow(db.prepare("SELECT * FROM payments WHERE id=?").get(payment.id)), client: getClientById(db, clientId) };
}

export function registerPayment(db, clientId, input) {
  db.exec("BEGIN IMMEDIATE");
  try { const result=insertPayment(db,clientId,input); db.exec("COMMIT"); return result; }
  catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function registerVisit(db, id) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
    if (!row) { db.exec("ROLLBACK"); return null; }
    const membership = currentMembershipRow(db, id);
    const paidCents = membership ? paidCentsForMembership(db, membership.id) : 0;
    const access = accessFor(row, membership, paidCents);
    if (access.status !== "active") {
      const client = clientFromRow(db, row);
      db.exec("ROLLBACK");
      const error = new Error(access.reason);
      error.code = "ACCESS_BLOCKED";
      error.client = client;
      throw error;
    }

    const client = clientFromRow(db, row);
    const now = nowIso();
    const nextStamps = Math.min(client.stamps + 1, 10);
    const history = client.stamps < 10 ? [...client.visitHistory, now] : client.visitHistory;
    const rewardUnlocked = client.stamps < 10 && nextStamps === 10;

    db.prepare("UPDATE clients SET visits=?,stamps=?,last_visit=?,visit_history=? WHERE id=?")
      .run(client.visits + 1, nextStamps, now, JSON.stringify(history), id);
    if (membership?.session_limit != null) {
      db.prepare("UPDATE memberships SET sessions_used=sessions_used+1 WHERE id=?").run(membership.id);
    }

    const updated = getClientById(db, id);
    const activity = {
      id: randomUUID(), clientId: client.id, clientName: client.name,
      type: rewardUnlocked ? "premio" : "visita",
      description: rewardUnlocked
        ? "Recompensa desbloqueada"
        : membership?.session_limit != null
          ? `Visita registrada · Sesión ${updated.sessionsUsed}/${updated.sessionLimit} · Sello ${nextStamps}/10`
          : `Visita registrada · Sello ${nextStamps}/10`,
      createdAt: now,
    };
    db.prepare("INSERT INTO activities (id,client_id,client_name,type,description,created_at) VALUES (?,?,?,?,?,?)")
      .run(activity.id, activity.clientId, activity.clientName, activity.type, activity.description, activity.createdAt);
    db.exec("COMMIT");
    return { client: updated, activity, access: { allowed: true } };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

export { addMonthsClampedIso };
