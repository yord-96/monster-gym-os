import http from "node:http";
import { spawn } from "node:child_process";
import { openGymDatabase, getState, createClient, updateClient, deleteClient, registerVisit } from "./server/database.mjs";

const port = Number(process.env.PORT || 4100);
const appPort = Number(process.env.MONSTER_APP_PORT || port + 1);
const db = openGymDatabase();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const app = spawn(npm, ["run", "app:start"], {
  cwd: process.cwd(), stdio: "inherit",
  env: { ...process.env, PORT: String(appPort), NODE_ENV: process.env.NODE_ENV || "production" },
});

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error("Solicitud demasiado grande."); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("JSON inválido."); }
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, database: "sqlite" });
  if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, getState(db));
  if (req.method === "POST" && url.pathname === "/api/clients") {
    try { return json(res, 201, createClient(db, await readJson(req))); } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo crear el cliente." }); }
  }
  const visit = url.pathname.match(/^\/api\/clients\/([^/]+)\/visit$/);
  if (req.method === "POST" && visit) {
    try { const result = registerVisit(db, decodeURIComponent(visit[1])); return result ? json(res, 200, result) : json(res, 404, { error: "Cliente no encontrado." }); }
    catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : "No se pudo registrar la visita." }); }
  }
  const client = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (client && req.method === "PUT") {
    try { const result = updateClient(db, decodeURIComponent(client[1]), await readJson(req)); return result ? json(res, 200, { client: result }) : json(res, 404, { error: "Cliente no encontrado." }); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "No se pudo actualizar el cliente." }); }
  }
  if (client && req.method === "DELETE") {
    try { return deleteClient(db, decodeURIComponent(client[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: "Cliente no encontrado." }); }
    catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : "No se pudo eliminar el cliente." }); }
  }
  return json(res, 404, { error: "Ruta no encontrada." });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/")) { void handleApi(req, res); return; }
  const proxy = http.request({ hostname: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${appPort}` } }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res);
  });
  proxy.on("error", () => json(res, 502, { error: "La interfaz de Monster Gym todavía está iniciando." }));
  req.pipe(proxy);
});

const shutdown = () => { app.kill("SIGINT"); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
app.on("exit", (code) => { if (code && code !== 0) console.error(`vinext terminó con código ${code}`); });
server.listen(port, "127.0.0.1", () => console.log(`Monster Gym central escuchando en 127.0.0.1:${port}; app interna ${appPort}`));
