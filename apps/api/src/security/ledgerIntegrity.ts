import crypto from "crypto";

export type LedgerActorType = "user" | "agent" | "service" | "system";
export type LedgerAggregateType = "decision" | "execution" | "signal" | "capability";

export interface LedgerEventInput {
  orgId: string;
  aggregateType: LedgerAggregateType;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  actorType: LedgerActorType;
  actorId: string;
  policyVersion: string;
  capabilityId?: string | null;
  causationEventId?: string | null;
  correlationId: string;
  previousHash?: string | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, stableValue(val)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashLedgerEvent(input: LedgerEventInput): string {
  return crypto.createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

export function signLedgerEvent(eventHash: string, signingKey: string | undefined): string | null {
  const key = String(signingKey || "").trim();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(eventHash, "utf8").digest("base64url");
}

export function verifyLedgerEventSignature(
  eventHash: string,
  signature: string | null | undefined,
  signingKey: string | undefined,
): boolean {
  const expected = signLedgerEvent(eventHash, signingKey);
  if (!expected || !signature) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}
