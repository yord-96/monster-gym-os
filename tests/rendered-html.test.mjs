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
  assert.match(html, /Registra una visita/);
  assert.match(html, /Nuevo cliente/);
  assert.match(html, /MODO LOCAL/);
  assert.match(html, /Clientes/);
  assert.match(html, /Fidelidad/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("incluye persistencia, QR y descarga PNG reales", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /localStorage\.getItem\(STORE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(STORE_KEY/);
  assert.match(page, /crypto\.randomUUID\(\)/);
  assert.match(page, /QRCode\.toDataURL/);
  assert.match(page, /MEMBER_QUERY_KEY = "checkin"/);
  assert.match(page, /memberQrUrl\(client\.token\)/);
  assert.match(page, /tokenFromQr\(decoded\)/);
  assert.match(page, /visitHistory:/);
  assert.match(page, /formatStampDateTime/);
  assert.match(page, /toPng\(cardRef\.current/);
  assert.match(page, /new Html5Qrcode\("qr-reader"\)/);
  assert.match(page, /setClients\(\(current\) => \[record, \.\.\.current\]\)/);
  assert.match(page, /visits: scannedClient\.visits \+ 1/);
  assert.match(css, /\.clients-table/);
  assert.match(css, /\.real-camera/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.top-actions \.primary-button/);
  assert.match(css, /\.card-last-stamp/);
});
