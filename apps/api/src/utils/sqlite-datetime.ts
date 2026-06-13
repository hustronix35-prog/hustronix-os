/**
 * SQLite `CURRENT_TIMESTAMP` / `datetime('now')` values are UTC but omit a `Z` suffix.
 * Normalize for JSON clients so browsers do not treat them as local time.
 */
export function sqliteDatetimeToIso(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? s : t.toISOString();
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const t = new Date(`${iso}Z`);
  if (!Number.isNaN(t.getTime())) return t.toISOString();
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? s : fallback.toISOString();
}

export function mapRowDatetimes<T extends Record<string, unknown>>(
  row: T,
  keys: (keyof T)[],
): T {
  const out = { ...row };
  for (const key of keys) {
    const v = out[key];
    if (typeof v === "string" || v == null) {
      (out as Record<string, unknown>)[key as string] = sqliteDatetimeToIso(v) ?? v;
    }
  }
  return out;
}
