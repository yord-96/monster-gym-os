import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renderiza la aplicación Monster Gym", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Monster Gym OS — Gestión y fidelidad<\/title>/i);
  assert.match(html, /MONSTER/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("incluye base central, CRUD, planes, deuda, QR de cobro y vouchers", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const commerce = await readFile(new URL("../app/commerce.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const database = await readFile(new URL("../server/database.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(page, /localStorage\.getItem|localStorage\.setItem/);
  assert.match(page, /\/api\/auth\/login/);
  assert.match(page, /\/api\/state/);
  assert.match(page, /\/api\/plans/);
  assert.match(page, /\/payments/);
  assert.match(page, /\/renew/);
  assert.match(page, /paymentQrUrl/);
  assert.match(commerce, /capture="environment"/);
  assert.match(page, /SUSPENDIDO POR DEUDA/);
  assert.match(page, /SESIONES AGOTADAS/);
  assert.match(page, /https:\/\/wa\.me/);
  assert.match(page, /QRCode\.toDataURL/);
  assert.match(page, /MONSTER-GYM:/);
  assert.match(page, /pixelRatio: 3/);

  assert.match(server, /MONSTER_ADMIN_PASSWORD/);
  assert.match(server, /MONSTER_SESSION_SECRET/);
  assert.match(server, /\/api\/settings\/payment-qr/);
  assert.match(server, /\/uploads\//);
  assert.match(server, /imageFromDataUrl/);

  assert.match(database, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS memberships/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS plans/);
  assert.match(database, /grace_until/);
  assert.match(database, /sessions_used/);
  assert.match(database, /ACCESS_BLOCKED/);

  assert.match(css, /\.payment-modal/);
  assert.match(css, /\.voucher-capture/);
  assert.match(css, /\.blocked-state/);
  assert.match(css, /@media\(max-width:760px\)/);
});
