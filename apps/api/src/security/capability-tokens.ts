import crypto from "crypto";
import { config } from "../config.js";
import { db } from "../database.js";
import type { Permission } from "./authorization.js";

export interface CapabilityTokenPayload {
  jti: string;
  userId: string;
  tenantId: string;
  toolName: string;
  permission: Permission;
  issuedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function signingKey(): string {
  const key = config.server.ledgerSigningKey || config.server.apiKey;
  if (!key) {
    if (config.server.isProduction) {
      throw new Error("LEDGER_SIGNING_KEY or MISSION_CONTROL_API_KEY required in production.");
    }
    return "hustronix-dev-capability-key-v9";
  }
  return key;
}

function sign(payload: CapabilityTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function recordIssuedJti(payload: CapabilityTokenPayload): void {
  db.rawRun(
    `INSERT OR IGNORE INTO capability_jti_log (
      jti, user_id, tenant_id, tool_name, permission, issued_at, expires_at, consumed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      payload.jti,
      payload.userId,
      payload.tenantId,
      payload.toolName,
      payload.permission,
      new Date(payload.issuedAt).toISOString(),
      new Date(payload.expiresAt).toISOString(),
    ],
  );
}

function consumeJti(jti: string): void {
  const row = db
    .rawGet(`SELECT consumed FROM capability_jti_log WHERE jti = ?`, [jti])
    .at(0) as { consumed: number } | undefined;
  if (!row) throw new Error("Capability token not registered.");
  if (row.consumed) throw new Error("Capability token already consumed (replay detected).");
  db.rawRun(
    `UPDATE capability_jti_log SET consumed = 1, consumed_at = CURRENT_TIMESTAMP WHERE jti = ?`,
    [jti],
  );
}

export function issueCapabilityToken(params: {
  userId: string;
  tenantId: string;
  toolName: string;
  permission: Permission;
  ttlMs?: number;
}): { token: string; payload: CapabilityTokenPayload } {
  const now = Date.now();
  const payload: CapabilityTokenPayload = {
    jti: crypto.randomUUID(),
    userId: params.userId,
    tenantId: params.tenantId,
    toolName: params.toolName,
    permission: params.permission,
    issuedAt: now,
    expiresAt: now + (params.ttlMs ?? DEFAULT_TTL_MS),
  };
  recordIssuedJti(payload);
  return { token: sign(payload), payload };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyCapabilityToken(
  token: string,
  expected: {
    userId: string;
    tenantId: string;
    toolName: string;
    permission: Permission;
  },
  options?: { consume?: boolean },
): CapabilityTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid capability token format.");
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  if (!timingSafeEqualStr(sig, expectedSig)) {
    throw new Error("Invalid capability token signature.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CapabilityTokenPayload;
  if (Date.now() > payload.expiresAt) throw new Error("Capability token expired.");
  if (payload.userId !== expected.userId) throw new Error("Capability token user mismatch.");
  if (payload.tenantId !== expected.tenantId) throw new Error("Capability token tenant mismatch.");
  if (payload.toolName !== expected.toolName) throw new Error("Capability token tool mismatch.");
  if (payload.permission !== expected.permission) throw new Error("Capability token permission mismatch.");
  if (options?.consume !== false) {
    consumeJti(payload.jti);
  }
  return payload;
}

/** High-risk tools require an explicit capability token per invocation. */
export const HIGH_RISK_TOOLS = new Set([
  "log_strategic_decision",
  "commit_decision",
  "complete_decision",
  "reverse_decision",
  "transition_execution",
  "remember_fact",
]);
