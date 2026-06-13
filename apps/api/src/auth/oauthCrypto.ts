import crypto from "crypto";

/**
 * AES-256-GCM at-rest encryption for OAuth bearer tokens.
 *
 * Why: OAuth access/refresh tokens are full bearer credentials for a customer's
 * Slack / GitHub / Microsoft / Google data. They must never live on disk in
 * plaintext. Same approach the existing TOTP module already uses for 2FA
 * secrets (see auth/totpCore.ts) — just generalised to any provider.
 *
 * Key material: a single env var `OAUTH_TOKEN_ENCRYPTION_KEY`. In production
 * this is sourced from Azure Key Vault; locally it lives in `.env`. Rotating
 * the key requires re-encrypting every row in `oauth_connections` — handle
 * with a controlled migration, not a silent restart.
 *
 * Wire format (base64): `nonce(12) || ciphertext || authTag(16)`. A single
 * opaque string per stored token. We do NOT mix the format key into the
 * ciphertext; if you ever need versioned encryption add a `v1:` prefix.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_N = 16384;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT = Buffer.from("hustronix-oauth-token-salt-v1", "utf8");

let cachedKey: Buffer | null = null;

/**
 * Derives the AES key once per process from `OAUTH_TOKEN_ENCRYPTION_KEY`.
 * scrypt with a static salt is intentional: we want the same env value to
 * always yield the same key so existing rows decrypt across restarts.
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = (process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` " +
        "and put it in your .env / Azure Key Vault before connecting any provider.",
    );
  }
  if (raw.length < 32) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is too short. Use 32+ random characters (recommended: 64 hex chars).",
    );
  }
  cachedKey = crypto.scryptSync(raw, SCRYPT_SALT, SCRYPT_KEY_BYTES, { N: SCRYPT_N });
  return cachedKey;
}

/** Throws if the encryption key is missing/weak; safe to call at startup. */
export function assertOAuthEncryptionConfigured(): void {
  deriveKey();
}

/** Encrypts a token string. Empty input returns empty string (allowed: no refresh token). */
export function encryptToken(plain: string | null | undefined): string {
  if (!plain) return "";
  const key = deriveKey();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

/** Decrypts a token string. Empty input returns empty string. Throws on tamper. */
export function decryptToken(stored: string | null | undefined): string {
  if (!stored) return "";
  const buf = Buffer.from(stored, "base64");
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new Error("encrypted token is malformed (too short)");
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const key = deriveKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
