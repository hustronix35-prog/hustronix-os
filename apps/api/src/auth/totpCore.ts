import { randomBytes } from "crypto";
import { generateSecret, generateURI, verifySync } from "otplib";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildTotpKeyUri(params: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  return generateURI({
    issuer: params.issuer,
    label: params.accountName,
    secret: params.secret,
  });
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const t = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  try {
    const r = verifySync({
      secret,
      token: t,
      epochTolerance: 30,
    });
    return r.valid === true;
  } catch {
    return false;
  }
}

function formatBackupSegment(): string {
  return randomBytes(4).toString("hex").slice(0, 8).toUpperCase();
}

/** Human-readable backup codes like `A1B2-C3D4`. */
export function generateBackupCodesPlain(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = formatBackupSegment();
    out.push(`${a.slice(0, 4)}-${a.slice(4, 8)}`);
  }
  return out;
}

export function normalizeBackupCode(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}
