"use client";

import Image from "next/image";
import { cn } from "@/lib/cn";

type Props = {
  stepId: string;
  className?: string;
};

const gold = "var(--hx-accent)";
const goldDim = "color-mix(in srgb, var(--hx-accent) 35%, transparent)";
const stroke = "color-mix(in srgb, var(--hx-border) 90%, var(--hx-text))";
const fill = "color-mix(in srgb, var(--hx-surface-elevated) 70%, var(--hx-bg))";

function GridBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.35]"
      aria-hidden
      style={{
        backgroundImage: `
          linear-gradient(color-mix(in srgb, var(--hx-text) 6%, transparent) 1px, transparent 1px),
          linear-gradient(90deg, color-mix(in srgb, var(--hx-text) 6%, transparent) 1px, transparent 1px)
        `,
        backgroundSize: "24px 24px",
      }}
    />
  );
}

function Glow() {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_40%,color-mix(in_srgb,var(--hx-accent)_14%,transparent),transparent)]"
      aria-hidden
    />
  );
}

function WelcomeVisual() {
  const nodes = [
    { x: 56, y: 88, label: "Signals" },
    { x: 148, y: 44, label: "Decisions" },
    { x: 240, y: 88, label: "Execute" },
    { x: 148, y: 132, label: "Ledger" },
  ];
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <defs>
        <linearGradient id="tour-loop-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={gold} stopOpacity="0.15" />
          <stop offset="50%" stopColor={gold} stopOpacity="0.55" />
          <stop offset="100%" stopColor={gold} stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <polygon
        points="56,88 148,44 240,88 148,132"
        fill="none"
        stroke="url(#tour-loop-line)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      {nodes.map((n) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r="22" fill={fill} stroke={goldDim} strokeWidth="1.25" />
          <circle cx={n.x} cy={n.y} r="4" fill={gold} />
          <text
            x={n.x}
            y={n.y + 38}
            textAnchor="middle"
            fill="var(--hx-muted)"
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
          >
            {n.label}
          </text>
        </g>
      ))}
      <circle cx={148} cy={88} r="10" fill={gold} opacity="0.9" />
    </svg>
  );
}

function MissionControlVisual() {
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <rect x="24" y="28" width="248" height="120" rx="10" fill={fill} stroke={stroke} strokeWidth="1" />
      <rect x="36" y="40" width="72" height="8" rx="4" fill={gold} opacity="0.85" />
      <rect x="36" y="56" width="120" height="6" rx="3" fill="color-mix(in srgb, var(--hx-muted) 40%, transparent)" />
      <rect x="36" y="78" width="224" height="52" rx="6" fill="color-mix(in srgb, var(--hx-bg) 80%, transparent)" stroke={stroke} strokeWidth="0.75" />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={48 + i * 52}
          y={118}
          width={36}
          height={4 + i * 6}
          rx="2"
          fill={i === 2 ? gold : "color-mix(in srgb, var(--hx-accent) 25%, transparent)"}
        />
      ))}
      <circle cx="228" cy="52" r="18" fill="none" stroke={gold} strokeWidth="2" strokeDasharray="28 56" />
      <circle cx="228" cy="52" r="6" fill={gold} opacity="0.35" />
    </svg>
  );
}

function ExecuteVisual() {
  const cols = ["Backlog", "Active", "Done"];
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      {cols.map((label, i) => {
        const x = 28 + i * 88;
        return (
          <g key={label}>
            <rect x={x} y="32" width="72" height="112" rx="8" fill={fill} stroke={stroke} strokeWidth="0.75" />
            <text
              x={x + 36}
              y="48"
              textAnchor="middle"
              fill="var(--hx-muted)"
              className="text-[8px] font-bold uppercase tracking-wider"
            >
              {label}
            </text>
            {[0, 1, 2].slice(0, 3 - i).map((row) => (
              <rect
                key={row}
                x={x + 10}
                y={58 + row * 22}
                width="52"
                height="14"
                rx="4"
                fill={i === 1 && row === 0 ? "color-mix(in srgb, var(--hx-accent) 22%, transparent)" : "color-mix(in srgb, var(--hx-bg) 90%, transparent)"}
                stroke={i === 1 && row === 0 ? goldDim : "transparent"}
                strokeWidth="1"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function SignalsVisual() {
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <rect x="48" y="24" width="200" height="128" rx="12" fill={fill} stroke={stroke} strokeWidth="1" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x="60" y={40 + i * 22} width="176" height="14" rx="5" fill="color-mix(in srgb, var(--hx-bg) 85%, transparent)" />
          <circle cx="72" cy={47 + i * 22} r="4" fill={i < 2 ? gold : "color-mix(in srgb, var(--hx-muted) 50%, transparent)"} />
          {i === 0 && (
            <rect x="200" y={43 + i * 22} width="24" height="8" rx="4" fill="color-mix(in srgb, var(--hx-accent) 30%, transparent)" stroke={goldDim} strokeWidth="0.75" />
          )}
        </g>
      ))}
    </svg>
  );
}

function ChatVisual() {
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <rect x="40" y="48" width="140" height="36" rx="10" fill="color-mix(in srgb, var(--hx-accent) 12%, transparent)" stroke={goldDim} strokeWidth="1" />
      <rect x="72" y="92" width="160" height="44" rx="10" fill={fill} stroke={stroke} strokeWidth="0.75" />
      <rect x="84" y="104" width="100" height="6" rx="3" fill="color-mix(in srgb, var(--hx-muted) 35%, transparent)" />
      <rect x="84" y="116" width="72" height="6" rx="3" fill="color-mix(in srgb, var(--hx-muted) 25%, transparent)" />
      <circle cx="228" cy="114" r="14" fill={gold} opacity="0.2" stroke={gold} strokeWidth="1.25" />
    </svg>
  );
}

function ReportsVisual() {
  const bars = [42, 68, 52, 88, 64, 96];
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <line x1="40" y1="140" x2="256" y2="140" stroke={stroke} strokeWidth="1" />
      {bars.map((h, i) => (
        <rect
          key={i}
          x={52 + i * 32}
          y={140 - h}
          width="20"
          height={h}
          rx="3"
          fill={i === bars.length - 1 ? gold : "color-mix(in srgb, var(--hx-accent) 28%, transparent)"}
        />
      ))}
      <path
        d="M 52 98 Q 100 72, 148 82 T 244 58"
        fill="none"
        stroke={gold}
        strokeWidth="1.5"
        strokeOpacity="0.5"
        strokeDasharray="4 3"
      />
    </svg>
  );
}

function TeamsVisual() {
  const positions = [
    { cx: 148, cy: 72, r: 26 },
    { cx: 88, cy: 108, r: 20 },
    { cx: 208, cy: 108, r: 20 },
    { cx: 118, cy: 132, r: 18 },
    { cx: 178, cy: 132, r: 18 },
  ];
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      {positions.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill={i === 0 ? "color-mix(in srgb, var(--hx-accent) 18%, transparent)" : fill}
          stroke={i === 0 ? gold : goldDim}
          strokeWidth="1.25"
        />
      ))}
      <line x1="148" y1="98" x2="108" y2="118" stroke={goldDim} strokeWidth="1" />
      <line x1="148" y1="98" x2="188" y2="118" stroke={goldDim} strokeWidth="1" />
    </svg>
  );
}

function SettingsVisual() {
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <circle cx="148" cy="88" r="36" fill="none" stroke={goldDim} strokeWidth="1.5" strokeDasharray="4 6" />
      <circle cx="148" cy="88" r="10" fill={fill} stroke={gold} strokeWidth="1.25" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 148 + Math.cos(rad) * 36;
        const y = 88 + Math.sin(rad) * 36;
        return <circle key={deg} cx={x} cy={y} r="5" fill={gold} opacity="0.55" />;
      })}
      <rect x="56" y="132" width="184" height="8" rx="4" fill="color-mix(in srgb, var(--hx-muted) 30%, transparent)" />
      <rect x="56" y="132" width="112" height="8" rx="4" fill={gold} opacity="0.7" />
    </svg>
  );
}

function WrapVisual() {
  return (
    <svg viewBox="0 0 296 176" className="relative z-[1] size-full max-h-[220px] max-w-[320px]" aria-hidden>
      <circle cx="148" cy="88" r="44" fill="color-mix(in srgb, var(--hx-accent) 12%, transparent)" stroke={gold} strokeWidth="2" />
      <path
        d="M 128 88 L 142 102 L 172 72"
        fill="none"
        stroke={gold}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={148 + Math.cos(a) * 62}
            cy={88 + Math.sin(a) * 62}
            r="3"
            fill={gold}
            opacity="0.35"
          />
        );
      })}
    </svg>
  );
}

const VISUALS: Record<string, () => React.JSX.Element> = {
  welcome: WelcomeVisual,
  "mission-control": MissionControlVisual,
  execute: ExecuteVisual,
  signals: SignalsVisual,
  chat: ChatVisual,
  reports: ReportsVisual,
  teams: TeamsVisual,
  settings: SettingsVisual,
  wrap: WrapVisual,
};

export function TourStepIllustration({ stepId, className }: Props) {
  const Visual = VISUALS[stepId] ?? WelcomeVisual;
  const showMark = stepId === "welcome";

  return (
    <div
      className={cn(
        "relative flex min-h-[11rem] flex-1 items-center justify-center overflow-hidden rounded-lg border border-hx-border/50",
        "bg-gradient-to-b from-hx-surface-elevated/60 via-hx-bg/40 to-hx-bg/90",
        className,
      )}
      aria-hidden
    >
      <GridBackdrop />
      <Glow />
      {showMark && (
        <Image
          src="/brand/hustronix-mark.png"
          alt=""
          width={200}
          height={200}
          className="pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 opacity-[0.07] saturate-125"
        />
      )}
      <Visual />
    </div>
  );
}
