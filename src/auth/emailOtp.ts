import crypto from "crypto";
import { hashOpaqueToken } from "./tokens.js";

export function randomOtpDigits(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashEmailOtpCode(challengeToken: string, code: string): string {
  return hashOpaqueToken(`${challengeToken}:${code.trim()}`);
}

export function verifyEmailOtpCode(storedHash: string, challengeToken: string, code: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashEmailOtpCode(challengeToken, code), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
