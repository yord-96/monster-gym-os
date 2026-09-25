import http from "node:http";
import { sendState, sendPhoto, sendQr } from "./server/delivery.mjs";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { getProducts, saveProduct, createCashReceipt, getDailyReport } from "./server/commerce.mjs";
import {
  openGymDatabase, getState, createClient, updateClient, deleteClient, registerVisit,
  getPlans, createPlan, updatePlan, getPayments, registerPayment, renewMembership,
  getSettings, setSetting,
} from "./server/database.mjs";

const port = Number(process.env.PORT || 4100);
const appPort = Number(process.env.MONSTER_APP_PORT || port + 1);
const adminPassword = process.env.MONSTER_ADMIN_PASSWORD || "";
const sessionSecret = process.env.MONSTER_SESSION_SECRET || "";
if (process.env.NODE_ENV === "production" && (!adminPassword || !sessionSecret)) {
  console.error("Faltan MONSTER_ADMIN_PASSWORD y/o MONSTER_SESSION_SECRET. El servicio no puede exponer datos financieros sin autenticación.");
  process.exit(1);
}

const db = openGymDatabase();
const isWindows = process.platform === "win32";

const app = spawn(
  isWindows ? "cmd.exe" : "npm",
  isWindows
    ? ["/d", "/s", "/c", "npm run app:start"]
    : ["run", "app:start"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(appPort),
      NODE_ENV: process.env.NODE_ENV || "production",
    },
  },
);

const uploadsRoot = resolve("uploads");
mkdirSync(resolve(uploadsRoot, "payment-qr"), { recursive: true });
mkdirSync(resolve(uploadsRoot, "vouchers"), { recursive: true });

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("Solicitud demasiado grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("JSON inválido."); }
}

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

const sign = (value) => createHmac("sha256", sessionSecret || "development-only").update(value).digest("hex");

function createSessionCookie() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${expires}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return [decodeURIComponent(index >= 0 ? part.slice(0, index) : part), decodeURIComponent(index >= 0 ? part.slice(index + 1) : "")];
    }),
  );
}

function isAuthenticated(req) {
  if (!adminPassword || !sessionSecret) return process.env.NODE_ENV !== "production";
  const token = parseCookies(req).monster_session;
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload))) return false;
  return Number(parts[0]) > Date.now();
}

function cookieHeader(token) {
  return `monster_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12 * 60 * 60}`;
}

function clearCookieHeader() {
  return "monster_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function imageFromDataUrl(dataUrl, folder, prefix) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("Imagen inválida.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("La imagen no puede superar 8 MB.");
  const extension = match[1] === "png" ? "png" : match[1] === "webp" ? "webp" : "jpg";
  const filename = `${prefix}-${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  const absoluteFolder = resolve(uploadsRoot, folder);
  mkdirSync(absoluteFolder, { recursive: true });
  const absolutePath = resolve(absoluteFolder, filename);
  writeFileSync(absolutePath, bytes);
  return `/uploads/${folder}/${filename}`;
}

function serveUpload(req, res, pathname) {
  if (!isAuthenticated(req)) return json(res, 401, { error: "No autorizado." });
  const relative = decodeURIComponent(pathname.slice("/uploads/".length));
  const absolute = resolve(uploadsRoot, relative);
  if (!absolute.startsWith(`${uploadsRoot}${sep}`) || !existsSync(absolute)) return json(res, 404, { error: "Imagen no encontrada." });
  const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[extname(absolute).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=86400" });
  createReadStream(absolute).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, database: "sqlite", auth: Boolean(adminPassword && sessionSecret) });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    return json(res, 200, { authenticated: isAuthenticated(req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const body = await readJson(req);
      if (!adminPassword || !sessionSecret) {
        if (process.env.NODE_ENV === "production") return json(res, 503, { error: "Autenticación no configurada en el servidor." });
        return json(res, 200, { authenticated: true });
      }
      if (!safeEqual(body.password || "", adminPassword)) return json(res, 401, { error: "Contraseña incorrecta." });
      return json(res, 200, { authenticated: true }, { "Set-Cookie": cookieHeader(createSessionCookie()) });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo iniciar sesión." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    return json(res, 200, { ok: true }, { "Set-Cookie": clearCookieHeader() });
  }

  if (!isAuthenticated(req)) return json(res, 401, { error: "Sesión requerida." });

  if (req.method === "GET" && url.pathname === "/api/state") return sendState(req, res, getState(db));
  const photoMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/photo$/);
  if (req.method === "GET" && photoMatch) {
    const client = db.prepare("SELECT photo FROM clients WHERE id=?").get(decodeURIComponent(photoMatch[1]));
    return sendPhoto(req, res, client?.photo);
  }
  const qrMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/qr$/);
  if (req.method === "GET" && qrMatch) {
    const client = db.prepare("SELECT token FROM clients WHERE id=?").get(decodeURIComponent(qrMatch[1]));
    return sendQr(req,res,client?.token);
  }

  if (req.method === "GET" && url.pathname === "/api/store/products") return json(res, 200, { products: getProducts(db) });
  const productMatch = url.pathname.match(/^\/api\/store\/products\/([^/]+)$/);
  if ((url.pathname === "/api/store/products" && req.method === "POST") || (productMatch && req.method === "PUT")) {
    try { return json(res, 200, { product: saveProduct(db, await readJson(req), productMatch ? decodeURIComponent(productMatch[1]) : null) }); }
    catch(error) { return json(res, 400, { error:error.message }); }
  }
  if (url.pathname === "/api/cash/receipts" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const voucherPath = body.voucherImage ? imageFromDataUrl(body.voucherImage, "vouchers", "cash") : "";
      return json(res, 201, { receipt:createCashReceipt(db, {...body,voucherPath}) });
    } catch(error) { return json(res, 400, {error:error.message}); }
  }
  if (url.pathname === "/api/reports/daily" && req.method === "GET") {
    try { return json(res, 200, getDailyReport(db,url.searchParams.get("date"))); }
    catch(error) { return json(res, 400, {error:error.message}); }
  }

  if (req.method === "GET" && url.pathname === "/api/plans") return json(res, 200, { plans: getPlans(db) });
  if (req.method === "POST" && url.pathname === "/api/plans") {
    try { return json(res, 201, { plan: createPlan(db, await readJson(req)) }); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo crear el plan." }); }
  }
  const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
  if (planMatch && req.method === "PUT") {
    try {
      const plan = updatePlan(db, decodeURIComponent(planMatch[1]), await readJson(req));
      return plan ? json(res, 200, { plan }) : json(res, 404, { error: "Plan no encontrado." });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo actualizar el plan." }); }
  }

  if (req.method === "GET" && url.pathname === "/api/settings/payment-qr") {
    return json(res, 200, getSettings(db));
  }
  if (req.method === "PUT" && url.pathname === "/api/settings/payment-qr") {
    try {
      const body = await readJson(req);
      const path = imageFromDataUrl(body.image, "payment-qr", "qr");
      setSetting(db, "payment_qr_url", path);
      return json(res, 200, { paymentQrUrl: path });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo guardar el QR." }); }
  }

  if (req.method === "POST" && url.pathname === "/api/clients") {
    try { return json(res, 201, createClient(db, await readJson(req))); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo crear el cliente." }); }
  }

  const renew = url.pathname.match(/^\/api\/clients\/([^/]+)\/renew$/);
  if (renew && req.method === "POST") {
    try {
      const client = renewMembership(db, decodeURIComponent(renew[1]), await readJson(req));
      return client ? json(res, 200, { client }) : json(res, 404, { error: "Cliente no encontrado." });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo renovar la membresía." }); }
  }

  const payments = url.pathname.match(/^\/api\/clients\/([^/]+)\/payments$/);
  if (payments && req.method === "GET") {
    return json(res, 200, { payments: getPayments(db, decodeURIComponent(payments[1])) });
  }
  if (payments && req.method === "POST") {
    try {
      const body = await readJson(req);
      let voucherPath = "";
      if (body.voucherImage) voucherPath = imageFromDataUrl(body.voucherImage, "vouchers", `voucher-${decodeURIComponent(payments[1])}`);
      const result = registerPayment(db, decodeURIComponent(payments[1]), { ...body, voucherPath });
      return result ? json(res, 201, result) : json(res, 404, { error: "Cliente no encontrado." });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo registrar el pago." }); }
  }

  const visit = url.pathname.match(/^\/api\/clients\/([^/]+)\/visit$/);
  if (req.method === "POST" && visit) {
    try {
      const result = registerVisit(db, decodeURIComponent(visit[1]));
      return result ? json(res, 200, result) : json(res, 404, { error: "Cliente no encontrado." });
    } catch (error) {
      if (error?.code === "ACCESS_BLOCKED") return json(res, 409, { error: error.message, code: error.code, client: error.client });
      return json(res, 500, { error: error instanceof Error ? error.message : "No se pudo registrar la visita." });
    }
  }

  const client = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (client && req.method === "PUT") {
    try {
      const result = updateClient(db, decodeURIComponent(client[1]), await readJson(req));
      return result ? json(res, 200, { client: result }) : json(res, 404, { error: "Cliente no encontrado." });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo actualizar el cliente." }); }
  }
  if (client && req.method === "DELETE") {
    try { return deleteClient(db, decodeURIComponent(client[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: "Cliente no encontrado." }); }
    catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : "No se pudo eliminar el cliente." }); }
  }

  return json(res, 404, { error: "Ruta no encontrada." });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  if (/^\/card-animals\/optimized\/(bear|lion|tiger|wolf|gorilla|bull)-v[12]\.webp$/.test(pathname) && (req.method === "GET" || req.method === "HEAD")) {
    const file = resolve(`public${pathname}`);
    if (existsSync(file)) {
      res.writeHead(200,{"Content-Type":"image/webp","Cache-Control":"public, max-age=31536000, immutable"});
      if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
      return;
    }
  }
  if (pathname === "/card-backgrounds/gym-lime-v1.webp" && (req.method === "GET" || req.method === "HEAD")) {
    const file = resolve("public/card-backgrounds/gym-lime-v1.webp");
    if (existsSync(file)) {
      res.writeHead(200,{"Content-Type":"image/webp","Cache-Control":"public, max-age=31536000, immutable"});
      if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
      return;
    }
  }
  if (pathname.startsWith("/uploads/")) { serveUpload(req, res, pathname); return; }
  if (pathname.startsWith("/api/")) { void handleApi(req, res); return; }

  const proxy = http.request({
    hostname: "127.0.0.1",
    port: appPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${appPort}` },
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on("error", () => json(res, 502, { error: "La interfaz de Monster Gym todavía está iniciando." }));
  req.pipe(proxy);
});

const shutdown = () => {
  app.kill("SIGINT");
  db.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.on("exit", (code) => { if (code && code !== 0) console.error(`vinext terminó con código ${code}`); });
server.listen(port, "127.0.0.1", () => console.log(`Monster Gym central escuchando en 127.0.0.1:${port}; app interna ${appPort}`));
