import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { photoUrl, sendPhoto, sendState, sendQr } from "../server/delivery.mjs";

function response() {
  return {status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
}
test("el servidor genera QR reutilizable y rechaza miembros inexistentes",async()=>{
  const first=response();await sendQr({headers:{}},first,"member-token");
  assert.equal(first.status,200);assert.match(first.body,/<svg/);
  const next=response();await sendQr({headers:{"if-none-match":first.headers.ETag}},next,"member-token");
  assert.equal(next.status,304);assert.equal(next.body,undefined);
  const missing=response();await sendQr({headers:{}},missing,undefined);assert.equal(missing.status,404);
});
test("sincroniza cambios comprimidos y devuelve 304 sin cuerpo cuando no cambian",async()=>{
  const state={clients:[{id:"a",visits:12}],activities:[]};
  const first=response(); await sendState({headers:{"accept-encoding":"gzip"}},first,state);
  assert.equal(first.status,200);assert.deepEqual(JSON.parse(gunzipSync(first.body)),state);
  const next=response();await sendState({headers:{"if-none-match":first.headers.ETag}},next,state);
  assert.equal(next.status,304);assert.equal(next.body,undefined);
  const changed=response();await sendState({headers:{"if-none-match":first.headers.ETag,"accept-encoding":"gzip;q=0"}},changed,{clients:[{id:"a",visits:13}]});
  assert.equal(changed.status,200);assert.notEqual(changed.headers.ETag,first.headers.ETag);
  assert.equal(changed.headers["Content-Encoding"],undefined);
  assert.equal(JSON.parse(changed.body).clients[0].visits,13);
});
test("fotos versionadas conservan contenido y revalidan sin reenviar imagen",()=>{
  const photo="data:image/png;base64,aGVsbG8=";
  assert.equal(photoUrl("a",photo),photoUrl("a",photo));
  assert.notEqual(photoUrl("a",photo),photoUrl("a","data:image/png;base64,d29ybGQ="));
  const first=response();sendPhoto({headers:{}},first,photo);
  assert.equal(first.status,200);assert.equal(first.body.toString(),"hello");
  const next=response();sendPhoto({headers:{"if-none-match":first.headers.ETag}},next,photo);
  assert.equal(next.status,304);assert.equal(next.body,undefined);
  const missing=response();sendPhoto({headers:{}},missing,undefined);assert.equal(missing.status,404);
});
