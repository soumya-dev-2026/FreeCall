/** bcryptjs shim: real salted KDF (scrypt), same sync API surface. */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashSync(password, rounds = 10) {
  const salt = randomBytes(12).toString("hex");
  const key = scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${rounds}$${salt}$${key}`;
}

export function compareSync(password, hash) {
  const parts = String(hash).split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const [, , salt, key] = parts;
  const got = scryptSync(String(password), salt, 32);
  const want = Buffer.from(key, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export default { hashSync, compareSync };
