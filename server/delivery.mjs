import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import QRCode from "qrcode";

const compress = promisify(gzip);
const digest = value => createHash("sha256").update(value).digest("hex");
const qrCache = new Map();

export async function sendQr(req, res, token) {
  if (!token) { res.writeHead(404,{"Cache-Control":"no-store"});res.end();return; }
  const etag = `"qr-v1-${digest(token)}"`;
  const headers = {"Content-Type":"image/svg+xml","Cache-Control":"private, no-cache",ETag:etag,Vary:"Cookie","X-Content-Type-Options":"nosniff"};
  if (req.headers["if-none-match"] === etag) {res.writeHead(304,headers);res.end();return;}
  let svg = qrCache.get(token);
  if (!svg) {
    svg = await QRCode.toString(`MONSTER-GYM:${token}`,{type:"svg",errorCorrectionLevel:"M",margin:4,color:{dark:"#17141f",light:"#ffffff"}});
    if (qrCache.size >= 256) qrCache.delete(qrCache.keys().next().value);
    qrCache.set(token,svg);
  }
  res.writeHead(200,{...headers,"Content-Length":Buffer.byteLength(svg)});res.end(svg);
}

export function photoUrl(id, photo = "") {
  return photo.startsWith("data:image/")
    ? `/api/clients/${encodeURIComponent(id)}/photo?v=${digest(photo).slice(0,16)}`
    : photo;
}

export async function sendState(req, res, state) {
  const body = JSON.stringify(state);
  const etag = `W/"${digest(body)}"`;
  const headers = { "Cache-Control":"private, no-cache", ETag:etag, Vary:"Accept-Encoding, Cookie" };
  if (String(req.headers["if-none-match"] || "").split(/\s*,\s*/).includes(etag)) {
    res.writeHead(304,headers); res.end(); return;
  }
  const gzipAllowed = String(req.headers["accept-encoding"] || "").split(",").some(part => {
    const [encoding, ...params] = part.trim().split(";");
    return encoding === "gzip" && !params.some(p => /^\s*q=0(?:\.0*)?\s*$/.test(p));
  });
  const bytes = gzipAllowed ? await compress(body) : Buffer.from(body);
  res.writeHead(200,{...headers,"Content-Type":"application/json; charset=utf-8","Content-Length":bytes.length,...(gzipAllowed?{"Content-Encoding":"gzip"}:{})});
  res.end(bytes);
}

export function sendPhoto(req, res, photo) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(photo || "");
  if (!match) { res.writeHead(404,{"Cache-Control":"no-store"}); res.end(); return; }
  const etag = `"${digest(photo)}"`;
  const headers = {"Cache-Control":"private, no-cache",ETag:etag,Vary:"Cookie","X-Content-Type-Options":"nosniff"};
  if (req.headers["if-none-match"] === etag) { res.writeHead(304,headers);res.end();return; }
  const bytes = Buffer.from(match[2],"base64");
  res.writeHead(200,{...headers,"Content-Type":match[1],"Content-Length":bytes.length});res.end(bytes);
}
