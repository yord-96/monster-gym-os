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
  assert.match(html, /BASE CENTRAL/);
  assert.match(html, /Clientes/);
  assert.match(html, /Fidelidad/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("incluye base central, CRUD, QR y descarga PNG", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(page, /localStorage\.getItem|localStorage\.setItem/);
  assert.match(page, /apiJson<.*>\("\/api\/state"/s);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /\/visit`/);
  assert.match(page, /openEditClient/);
  assert.match(page, /deleteClientRecord/);
  assert.match(page, /BASE CENTRAL/);
  assert.match(page, /QRCode\.toDataURL/);
  assert.match(page, /MONSTER-GYM:/);
  assert.match(page, /pixelRatio: 3/);
  assert.match(server, /node:http/);
  assert.match(server, /\/api\/state/);
  assert.match(css, /\.danger-action/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.row-actions/);
});
