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
