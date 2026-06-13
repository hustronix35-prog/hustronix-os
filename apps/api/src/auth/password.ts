import crypto from "crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyBcrypt(plain: string, hash: string): boolean {
  if (!hash || !hash.startsWith("$2")) return false;
  return bcrypt.compareSync(plain, hash);
}

export function verifyLegacySha256(plain: string, hexHash: string): boolean {
  const h = crypto.createHash("sha256").update(plain, "utf8").digest("hex");
  return h === hexHash;
}

/** Minimum length for new passwords (SaaS baseline). */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Normalize an email address for storage and lookup.
 * Trims whitespace and lowercases; safe to call on null/undefined-ish input.
 */
export function normalizeEmail(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

// Pragmatic RFC-5322-lite regex: local@domain.tld, no spaces, at least one dot in domain.
// Intentionally strict enough to catch typos but permissive of plus-addressing and dashes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns true when `value` looks like a syntactically valid email address.
 * Does not perform DNS or deliverability checks.
 */
export function isValidEmailFormat(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 254) return false;
  return EMAIL_RE.test(v);
}
