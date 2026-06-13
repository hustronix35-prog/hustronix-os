"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function formatHms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Stable clock for SSR + first client paint so SVG/text match hydration (no Date.now()). */
function hydrationClockMs(
  liveNow: number | null,
  startMs: number | null,
  endMs: number,
): number {
  if (liveNow != null) return liveNow;
  if (startMs != null && endMs > startMs) return startMs;
  return endMs - 6 * 3600 * 1000;
}

export function GraceCountdownRing({
  detectedAt,
  graceEndsAt,
  fallbackLabel,
  urgent,
  className,
}: {
  detectedAt?: string | null;
  graceEndsAt?: string | null;
  fallbackLabel: string;
  urgent?: boolean;
  className?: string;
}) {
  const startMs = parseMs(detectedAt);
  const endMs = parseMs(graceEndsAt);
  const [liveNow, setLiveNow] = useState<number | null>(null);

  useEffect(() => {
    setLiveNow(Date.now());
    const id = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const accent = urgent ? "var(--hx-danger)" : "var(--hx-accent)";
  const accentMuted = urgent ? "rgba(232,93,93,0.25)" : "rgba(212,175,55,0.22)";

  if (!endMs) {
    return (
      <div
        className={cn(
          "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 bg-[#0d0d0d] text-[10px] font-bold tabular-nums leading-tight",
          urgent ? "border-hx-danger text-hx-danger" : "border-hx-accent text-hx-accent",
          className,
        )}
      >
        <span className="max-w-[44px] text-center">{fallbackLabel}</span>
      </div>
    );
  }

  const now = hydrationClockMs(liveNow, startMs, endMs);
  const remainingSec = Math.max(0, Math.floor((endMs - now) / 1000));
  const label = formatHms(remainingSec);

  let pctRemaining = 0.5;
  if (startMs && endMs > startMs) {
    const windowMs = endMs - startMs;
    pctRemaining = Math.min(1, Math.max(0, (endMs - now) / windowMs));
  } else {
    pctRemaining = remainingSec > 0 ? Math.min(1, remainingSec / (6 * 3600)) : 0;
  }

  const r = 20;
  const c = 2 * Math.PI * r;
  const offset = Number((c * (1 - pctRemaining)).toFixed(4));

  return (
    <div
      className={cn(
        "relative flex h-[52px] w-[52px] shrink-0 items-center justify-center",
        className,
      )}
    >
      <svg
        className="absolute inset-0 -rotate-90"
        width={52}
        height={52}
        viewBox="0 0 52 52"
        aria-hidden
      >
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={accentMuted}
          strokeWidth="3"
        />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={Number(c.toFixed(4))}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 linear"
        />
      </svg>
      <span
        className="relative max-w-[40px] text-center text-[9px] font-bold tabular-nums leading-tight"
        style={{ color: accent }}
      >
        {label}
      </span>
    </div>
  );
}

/** Same countdown as gold monospace text (detail metadata rows). */
export function GraceCountdownText({
  detectedAt,
  graceEndsAt,
  fallbackLabel,
  urgent,
  className,
}: {
  detectedAt?: string | null;
  graceEndsAt?: string | null;
  fallbackLabel: string;
  urgent?: boolean;
  className?: string;
}) {
  const startMs = parseMs(detectedAt);
  const endMs = parseMs(graceEndsAt);
  const [liveNow, setLiveNow] = useState<number | null>(null);

  useEffect(() => {
    setLiveNow(Date.now());
    const id = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const color = urgent ? "var(--hx-danger)" : "var(--hx-accent)";

  if (!endMs) {
    return (
      <span className={cn("font-mono text-sm font-semibold", className)} style={{ color }}>
        {fallbackLabel}
      </span>
    );
  }

  const now = hydrationClockMs(liveNow, startMs, endMs);
  const remainingSec = Math.max(0, Math.floor((endMs - now) / 1000));
  return (
    <span className={cn("font-mono text-sm font-semibold", className)} style={{ color }}>
      {formatHms(remainingSec)}
    </span>
  );
}
