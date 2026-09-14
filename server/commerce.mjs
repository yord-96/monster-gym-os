import { randomUUID } from "node:crypto";

const cents = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new Error("Ingresa un monto mayor a cero y menor o igual a Bs 1.000.000.");
  const result = Math.round(amount * 100);
  if (result < 1 || Math.abs(amount * 100 - result) > 0.00001) throw new Error("Usa como máximo dos decimales.");
  return result;
};
const productRow = row => ({ id:row.id, name:row.name, price:row.price_cents/100, active:Boolean(row.active) });
const receiptRow = row => ({ id:row.id, kind:row.kind, clientName:row.client_name, description:row.description, amount:row.amount_cents/100, method:row.method, voucherUrl:row.voucher_path, note:row.note, createdAt:row.created_at, lines:JSON.parse(row.lines_json) });

export function initCommerce(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cash_receipts (
      id TEXT PRIMARY KEY, request_key TEXT UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('membership','registration','sale')),
      client_id TEXT, client_name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), method TEXT NOT NULL CHECK(method IN ('cash','qr')),
      voucher_path TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      lines_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_receipts_date_idx ON cash_receipts(created_at);
    CREATE TRIGGER IF NOT EXISTS payment_cash_receipt AFTER INSERT ON payments BEGIN
      INSERT INTO cash_receipts(id,kind,client_id,client_name,description,amount_cents,method,voucher_path,note,created_at)
      SELECT NEW.id,'membership',NEW.client_id,c.name,'Plan ' || m.plan_name,NEW.amount_cents,NEW.method,
        COALESCE(NEW.voucher_path,''),COALESCE(NEW.note,''),NEW.created_at
      FROM clients c JOIN memberships m ON m.id=NEW.membership_id WHERE c.id=NEW.client_id;
    END;
    INSERT OR IGNORE INTO cash_receipts(id,kind,client_id,client_name,description,amount_cents,method,voucher_path,note,created_at)
    SELECT p.id,'membership',p.client_id,c.name,'Plan ' || m.plan_name,p.amount_cents,p.method,
      COALESCE(p.voucher_path,''),COALESCE(p.note,''),p.created_at
    FROM payments p JOIN clients c ON c.id=p.client_id JOIN memberships m ON m.id=p.membership_id;
  `);
}

export function getProducts(db) {
  return db.prepare("SELECT * FROM store_products ORDER BY active DESC,name COLLATE NOCASE,id").all().map(productRow);
}
export function saveProduct(db, input, id = null) {
  const name = String(input.name || "").trim();
  if (!name || name.length > 100) throw new Error("Escribe un nombre de hasta 100 caracteres.");
  const price = cents(input.price);
  if (id && !db.prepare("SELECT id FROM store_products WHERE id=?").get(id)) throw new Error("Artículo no encontrado.");
  const productId = id || randomUUID();
  db.prepare(`INSERT INTO store_products(id,name,price_cents,active,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_cents=excluded.price_cents,active=excluded.active,updated_at=excluded.updated_at`)
    .run(productId,name,price,input.active === false ? 0 : 1,new Date().toISOString());
  return productRow(db.prepare("SELECT * FROM store_products WHERE id=?").get(productId));
}

export function createCashReceipt(db, input) {
  const key = String(input.requestKey || "");
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(key)) throw new Error("Identificador de operación inválido. Vuelve a abrir el cobro.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT * FROM cash_receipts WHERE request_key=?").get(key);
    if (previous) { db.exec("COMMIT"); return receiptRow(previous); }
    if (!["registration","sale"].includes(input.kind)) throw new Error("Tipo de cobro inválido.");
    if (!["cash","qr"].includes(input.method)) throw new Error("Selecciona QR o efectivo.");
    const voucher = String(input.voucherPath || "");
    if (input.method === "qr" && !voucher) throw new Error("Adjunta el voucher del pago por QR.");
    const client = input.clientId ? db.prepare("SELECT id,name FROM clients WHERE id=?").get(String(input.clientId)) : null;
    if ((input.clientId || input.kind === "registration") && !client) throw new Error("Selecciona un cliente válido.");
    let total = 0;
    const lines = [];
    if (input.kind === "sale") {
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new Error("Añade entre 1 y 100 artículos.");
      const seen = new Set();
      for (const entry of input.items) {
        const quantity = Number(entry.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("La cantidad debe ser un entero entre 1 y 999.");
        if (seen.has(entry.productId)) throw new Error("Artículo duplicado en la venta.");
        seen.add(entry.productId);
        const product = db.prepare("SELECT * FROM store_products WHERE id=? AND active=1").get(String(entry.productId));
        if (!product) throw new Error("Un artículo no está disponible. Actualiza la tienda.");
        if (cents(entry.unitPrice) !== product.price_cents) throw new Error("Cambió el precio de un artículo. Actualiza la caja y revisa el total.");
        total += product.price_cents * quantity;
        lines.push({productId:product.id,name:product.name,quantity,unitPrice:product.price_cents/100,total:product.price_cents*quantity/100});
      }
      if (total > 100000000) throw new Error("La venta supera el monto máximo permitido.");
    } else { total = cents(input.amount); }
    const note = String(input.note || "").trim();
    if (note.length > 500) throw new Error("La nota no puede superar 500 caracteres.");
    const id = randomUUID();
    db.prepare(`INSERT INTO cash_receipts(id,request_key,kind,client_id,client_name,description,amount_cents,method,voucher_path,note,lines_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,key,input.kind,client?.id || null,client?.name || "Venta de mostrador",input.kind === "sale" ? "Venta de tienda" : "Inscripción",total,input.method,voucher,note,JSON.stringify(lines),new Date().toISOString());
    const receipt = receiptRow(db.prepare("SELECT * FROM cash_receipts WHERE id=?").get(id));
    db.exec("COMMIT");
    return receipt;
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function getDailyReport(db, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Selecciona una fecha válida.");
  const midnight = new Date(`${day}T00:00:00.000-04:00`);
  if (Number.isNaN(midnight.getTime()) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) throw new Error("Fecha inválida.");
  const start = midnight.toISOString();
  const end = new Date(midnight.getTime()+86400000).toISOString();
  const rows = db.prepare("SELECT * FROM cash_receipts WHERE created_at>=? AND created_at<? ORDER BY created_at DESC,id DESC").all(start,end);
  const totals = {total:0,cash:0,qr:0,membership:0,registration:0,sale:0,count:rows.length};
  for (const row of rows) { totals.total+=row.amount_cents; totals[row.method]+=row.amount_cents; totals[row.kind]+=row.amount_cents; }
  for (const key of ["total","cash","qr","membership","registration","sale"]) totals[key]/=100;
  return {day,timeZone:"America/La_Paz",totals,receipts:rows.map(receiptRow)};
}
