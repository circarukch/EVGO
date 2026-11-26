import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Stored as "scrypt:<salt>:<hash>", both base64. Plain passwords are never stored. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return ["scrypt", salt.toString("base64"), scryptSync(password, salt, 32).toString("base64")].join(":");
}

export function checkPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [kind, saltB64, hashB64] = stored.split(":");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, "base64");
  const got = scryptSync(password, Buffer.from(saltB64, "base64"), want.length);
  return timingSafeEqual(want, got);
}

/** Random password from letters and digits without look-alikes (no 0/O, 1/l/I). */
export function randomPassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...randomBytes(length)].map((b) => alphabet[b % alphabet.length]).join("");
}
