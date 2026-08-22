/**
 * jsonwebtoken shim: a real (minimal) HS256 implementation, so a tampered or
 * expired token is genuinely rejected rather than waved through.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");

function seconds(expiresIn) {
  if (typeof expiresIn === "number") return expiresIn;
  const m = /^(\d+)([smhd])$/.exec(String(expiresIn ?? "7d"));
  if (!m) return 7 * 86400;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

function sign(payload, secret, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + seconds(opts.expiresIn) };
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token, secret) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("jwt malformed");
  const data = `${parts[0]}.${parts[1]}`;
  const want = createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("invalid signature");
  }
  const body = JSON.parse(unb64(parts[1]));
  if (body.exp && body.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("jwt expired");
  }
  return body;
}

export { sign, verify };
export default { sign, verify };
