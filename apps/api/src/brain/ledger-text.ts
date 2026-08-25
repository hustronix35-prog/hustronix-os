/** Parse ledger JSON blobs (outcomes / constraints) into readable structures. */

export type OutcomeRow = { metric: string; target: string };

export function parseLedgerJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function formatOutcomes(raw: unknown): OutcomeRow[] {
  const v = parseLedgerJson(raw);
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [{ metric: v.trim(), target: "" }] : [];
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return {
            metric: String(o.metric ?? o.name ?? o.label ?? o.title ?? "").trim(),
            target: String(o.target ?? o.value ?? o.goal ?? "").trim(),
          };
        }
        return { metric: String(item).trim(), target: "" };
      })
      .filter((r) => r.metric || r.target);
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(([k, val]) => ({
      metric: k,
      target: typeof val === "string" || typeof val === "number" ? String(val) : JSON.stringify(val),
    }));
  }
  return [];
}

export function formatStringList(raw: unknown): string[] {
  const v = parseLedgerJson(raw);
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item && typeof item === "object") return String((item as Record<string, unknown>).text ?? (item as Record<string, unknown>).value ?? JSON.stringify(item));
        return String(item);
      })
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(v)];
}

export function outcomeHeadline(rows: OutcomeRow[], fallback: string): string {
  if (!rows.length) return fallback;
  const first = rows[0];
  if (first.target) return `${first.metric}: ${first.target}`.slice(0, 72);
  return first.metric.slice(0, 72);
}
