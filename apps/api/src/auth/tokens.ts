import crypto from "crypto";

export function randomHex(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** User-facing API token; shown once on create. */
export function newApiAccessTokenPlain(): string {
  return `hx_live_${crypto.randomBytes(24).toString("base64url")}`;
}
