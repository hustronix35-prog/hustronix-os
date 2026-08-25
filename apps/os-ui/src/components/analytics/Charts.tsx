"use client";

import type { AnalyticsSlice } from "@/lib/analytics-types";

const COLOR: Record<string, string> = {
  green: "var(--status-low)",
  red: "var(--status-critical)",
  yellow: "var(--status-medium)",
  orange: "var(--status-high)",
  blue: "var(--status-info)",
  cyan: "var(--status-cyan)",
  gold: "var(--signal-gold)",
  purple: "var(--status-purple)",
};

function resolveColor(key: string) {
  return COLOR[key] || COLOR.gold;
}

export function Sparkline({
  values,
  tone = "gold",
  width = 72,
  height = 28,
}: {
  values: number[];
  tone?: string;
  width?: number;
  height?: number;
}) {
  const pts = values.length ? values : [0];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const path = pts
    .map((v, i) => {
      const x = pts.length === 1 ? width / 2 : (i / (pts.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={resolveColor(tone)} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function LineChart({
  points,
  height = 180,
  color = "green",
  showDots = true,
}: {
  points: { label: string; value: number }[];
  height?: number;
  color?: string;
  showDots?: boolean;
}) {
  const w = 560;
  const pad = 28;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = pad + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (w - pad * 2));
    const y = pad + (1 - (p.value - min) / span) * (height - pad * 2);
    return { ...p, x, y };
  });
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const area =
    coords.length > 1
      ? `${line} L${coords[coords.length - 1].x} ${height - pad} L${coords[0].x} ${height - pad} Z`
      : "";
  const last = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Trend chart">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad + t * (height - pad * 2);
        return (
          <line
            key={t}
            x1={pad}
            x2={w - pad}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        );
      })}
      {area ? <path d={area} fill={resolveColor(color)} opacity="0.12" /> : null}
      <path d={line} fill="none" stroke={resolveColor(color)} strokeWidth="2.2" strokeLinecap="round" />
      {showDots
        ? coords.map((c) => (
            <circle key={c.label} cx={c.x} cy={c.y} r="3.2" fill={resolveColor(color)} />
          ))
        : null}
      {last ? (
        <g>
          <rect
            x={Math.min(last.x - 22, w - 56)}
            y={last.y - 28}
            width="44"
            height="20"
            rx="6"
            fill="var(--surface-raised)"
            stroke="var(--border-subtle)"
          />
          <text
            x={Math.min(last.x, w - 34)}
            y={last.y - 14}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="11"
            fontWeight="700"
          >
            {Math.round(last.value)}
            {max <= 100 && min >= 0 ? "%" : ""}
          </text>
        </g>
      ) : null}
      {coords.map((c, i) =>
        i === 0 || i === coords.length - 1 || i % Math.ceil(coords.length / 4) === 0 ? (
          <text
            key={`lbl-${c.label}`}
            x={c.x}
            y={height - 8}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="10"
          >
            {c.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function DonutChart({
  slices,
  total,
  centerLabel = "Total",
  size = 180,
}: {
  slices: AnalyticsSlice[];
  total: number;
  centerLabel?: string;
  size?: number;
}) {
  const r = 62;
  const stroke = 18;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const parts = slices.filter((s) => s.count > 0);
  const denom = parts.reduce((a, s) => a + s.count, 0) || 1;

  return (
    <div style={{ display: "grid", placeItems: "center", position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden>
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        {parts.map((s) => {
          const len = (s.count / denom) * c;
          const el = (
            <circle
              key={s.key}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={resolveColor(s.color)}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 80 80)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeContent: "center",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <strong style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{total}</strong>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{centerLabel}</span>
      </div>
    </div>
  );
}

export function Gauge({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 54;
  const c = Math.PI * r;
  const filled = (v / 100) * c;
  const tone = v >= 70 ? "green" : v >= 45 ? "orange" : "red";
  return (
    <div style={{ display: "grid", placeItems: "center", gap: 6 }}>
      <svg width="160" height="96" viewBox="0 0 160 96" aria-label={label}>
        <path
          d="M 20 80 A 54 54 0 0 1 140 80"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 20 80 A 54 54 0 0 1 140 80"
          fill="none"
          stroke={resolveColor(tone)}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
        />
        <text x="80" y="72" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
          {v}%
        </text>
      </svg>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
