import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** A fresh charger password: 20 letters and digits (no look-alikes), easy to type into a charger's setup app. */
export function newChargerPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...randomBytes(20)].map((b) => alphabet[b % alphabet.length]).join("");
}

/** Stored as "scrypt:<salt>:<hash>", both base64. The plain password is shown once and never stored. */
export function hashChargerPassword(password: string): string {
  const salt = randomBytes(16);
  return ["scrypt", salt.toString("base64"), scryptSync(password, salt, 32).toString("base64")].join(":");
}

export function checkChargerPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [kind, saltB64, hashB64] = stored.split(":");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, "base64");
  const got = scryptSync(password, Buffer.from(saltB64, "base64"), want.length);
  return timingSafeEqual(want, got);
}
