/**
 * Claim-ready ingest metadata — provider structure only, not organizational claims.
 * Adapters fill this; reconciliation reads it to bind entities + extract claims.
 */

export type ClaimReadyMeta = {
  entity_type?: string;
  entity_id?: string;
  event?: string;
  previous?: string | null;
  current?: string | null;
  owner?: string;
  occurred_at?: string;
  aliases?: string[];
  /** Human label used to alias provider ids onto one feature/launch entity. */
  feature_hint?: string;
};

const FEATURE_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(payment\s+integration|pay-?\d+|payments?\s*v?\d*|oauth|customer\s+configuration)\b/i, label: "Payment Integration" },
  { re: /\b(product\s+launch|go[\s-]?live)\b/i, label: "Product Launch" },
  { re: /\blaunch\b/i, label: "Product Launch" },
];

export function slugFeature(label: string): string {
  return (
    String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "unknown"
  );
}

export function featureRefId(label: string): string {
  return `feature:${slugFeature(label)}`;
}

export function guessFeatureHint(...texts: Array<string | null | undefined>): string | undefined {
  const blob = texts.filter(Boolean).join(" ");
  if (!blob.trim()) return undefined;
  for (const h of FEATURE_HINTS) {
    if (h.re.test(blob)) return h.label;
  }
  const jira = blob.match(/\b([A-Z]{2,10}-\d+)\b/);
  if (jira) return jira[1];
  return undefined;
}

export function parseClaimReady(raw: unknown): ClaimReadyMeta {
  if (!raw) return {};
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const aliases = Array.isArray(obj.aliases) ? obj.aliases.map(String).filter(Boolean) : undefined;
  return {
    entity_type: typeof obj.entity_type === "string" ? obj.entity_type : undefined,
    entity_id: typeof obj.entity_id === "string" ? obj.entity_id : undefined,
    event: typeof obj.event === "string" ? obj.event : undefined,
    previous: obj.previous == null ? null : String(obj.previous),
    current: obj.current == null ? null : String(obj.current),
    owner: typeof obj.owner === "string" ? obj.owner : undefined,
    occurred_at: typeof obj.occurred_at === "string" ? obj.occurred_at : undefined,
    aliases,
    feature_hint: typeof obj.feature_hint === "string" ? obj.feature_hint : undefined,
  };
}

/** Merge claim-ready fields into existing ingest meta without dropping provider context. */
export function withClaimReady(
  meta: Record<string, unknown>,
  ready: ClaimReadyMeta,
): Record<string, unknown> {
  return { ...meta, ...ready };
}
