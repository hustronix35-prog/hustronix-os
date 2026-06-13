/** Parse API/SQLite datetimes (UTC, often without `Z`). */
export function parseApiDate(raw?: string | null): number {
  if (!raw) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const utc = new Date(`${iso}Z`).getTime();
  if (!Number.isNaN(utc)) return utc;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? NaN : t;
}

export type RelativeAgoTone = "ok" | "soon" | "overdue";

/** Human-readable age since `raw` (e.g. "5m ago", "2h ago"). */
export function formatRelativeAgo(raw?: string | null): {
  label: string;
  tone: RelativeAgoTone;
} {
  const t = parseApiDate(raw);
  if (Number.isNaN(t)) return { label: raw ? String(raw) : "—", tone: "ok" };

  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 45) return { label: "Just now", tone: "ok" };
  if (sec < 90) return { label: "1m ago", tone: "ok" };
  const m = Math.floor(sec / 60);
  if (m < 60) return { label: `${m}m ago`, tone: "ok" };
  const h = Math.floor(m / 60);
  if (h < 48) return { label: `${h}h ago`, tone: h < 8 ? "soon" : "overdue" };
  const d = Math.floor(h / 24);
  return { label: `${d}d ago`, tone: "overdue" };
}
