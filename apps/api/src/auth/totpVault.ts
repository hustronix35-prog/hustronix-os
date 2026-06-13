import crypto from "crypto";

const SCRYPT_SALT = Buffer.from("hustronix-totp-aes-v1", "utf8");

export function totpMasterKeyBytes(masterPassword: string): Buffer {
  return crypto.scryptSync(masterPassword, SCRYPT_SALT, 32);
}

/** iv(12) + tag(16) + ciphertext — base64url */
export function encryptTotpPayload(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptTotpPayload(b64: string, key: Buffer): string {
  const buf = Buffer.from(b64, "base64url");
  if (buf.length < 28) throw new Error("invalid_payload");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
