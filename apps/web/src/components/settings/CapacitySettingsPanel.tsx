"use client";

import { ChevronDown, Gauge, Info } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { cn } from "@/lib/cn";

export type CapacitySummary = {
  configured: boolean;
  teamConfigured: boolean;
  systemTotal: number | null;
  currentLoad: number;
  usagePct: number | null;
};

const TEAM_KEYS = [
  ["Leadership", "Leadership"],
  ["Growth", "Growth"],
  ["Product", "Product"],
  ["Operations", "Operations"],
] as const;

type TeamKey = (typeof TEAM_KEYS)[number][1];

type TeamCaps = Record<TeamKey, number | null>;

type Props = {
  capTotal: number | null;
  setCapTotal: (v: number | null) => void;
  teamCaps: TeamCaps;
  setTeamCaps: Dispatch<SetStateAction<TeamCaps>>;
  capacitySummary: CapacitySummary | null;
};

function usageTone(pct: number | null | undefined): "muted" | "ok" | "warn" | "danger" {
  if (pct == null) return "muted";
  if (pct > 100) return "danger";
  if (pct >= 85) return "warn";
  return "ok";
}

function ringStroke(tone: ReturnType<typeof usageTone>): string {
  if (tone === "danger") return "stroke-hx-danger";
  if (tone === "warn") return "stroke-hx-warning";
  if (tone === "ok") return "stroke-hx-accent";
  return "stroke-hx-border/60";
}

const RING_C = 2 * Math.PI * 52;

export function CapacitySettingsPanel({
  capTotal,
  setCapTotal,
  teamCaps,
  setTeamCaps,
  capacitySummary,
}: Props) {
  const configured = capacitySummary?.configured ?? false;
  const pct = capacitySummary?.usagePct ?? null;
  const tone = usageTone(pct);
  const ringPct = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
  const showGauge = configured && pct != null;
  const load = capacitySummary?.currentLoad ?? 0;
  const budget = capacitySummary?.systemTotal ?? capTotal;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-hx-border/80 bg-gradient-to-br from-hx-accent/[0.07] via-hx-surface-elevated/40 to-hx-bg p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full bg-hx-accent/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3 sm:items-start">
            <div
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                tone === "danger"
                  ? "border-hx-danger/30 bg-hx-danger/15 text-hx-danger"
                  : tone === "warn"
                    ? "border-hx-warning/30 bg-hx-warning/15 text-hx-warning"
                    : "border-hx-accent/25 bg-hx-accent/15 text-hx-accent",
              )}
            >
              <Gauge className="size-6" strokeWidth={1.75} />
            </div>
            <div className="text-center sm:text-left">
              <h3 className="text-xl font-semibold tracking-tight text-hx-text">Capacity</h3>
              {showGauge && budget != null ? (
                <p className="mt-1 text-sm tabular-nums text-hx-muted">
                  <span className="font-semibold text-hx-text">{load.toFixed(1)}</span>
                  <span className="text-hx-muted"> / {budget} pts</span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-hx-muted">
                  {capTotal != null ? `${capTotal} pts draft` : "No budget yet"}
                </p>
              )}
            </div>
          </div>

          <UsageRing showGauge={showGauge} pct={pct} ringPct={ringPct} tone={tone} />
        </div>

        {showGauge && pct! > 100 && (
          <p className="relative mt-4 text-center text-xs font-semibold text-hx-danger sm:text-left">
            Over capacity
          </p>
        )}
        {!capacitySummary && (
          <p className="relative mt-3 text-center text-[11px] text-hx-muted sm:text-left">
            Live usage offline
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <label
          htmlFor="hx-cap-total"
          className="group flex flex-col justify-between rounded-2xl border border-hx-border bg-hx-surface-elevated/25 p-5 transition-all focus-within:border-hx-accent/45 focus-within:shadow-[0_0_0_1px_rgba(212,175,55,0.15)] lg:col-span-2"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-hx-muted">
            System budget
          </span>
          <p className="mt-1 text-[11px] leading-snug text-hx-muted">
            Org-wide points cap for utilization and Teams.
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <input
              id="hx-cap-total"
              type="number"
              min={1}
              placeholder=","
              value={capTotal === null ? "" : capTotal}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") setCapTotal(null);
                else setCapTotal(Math.max(1, parseInt(v, 10) || 1));
              }}
              className="w-full min-w-0 border-0 bg-transparent p-0 text-5xl font-bold leading-none tabular-nums text-hx-text placeholder:text-hx-muted/25 focus:outline-none"
            />
            <span className="pb-2 text-sm font-medium text-hx-muted">pts</span>
          </div>
        </label>

        <div className="rounded-2xl border border-hx-border bg-hx-surface-elevated/20 p-4 lg:col-span-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-hx-muted">
            Team caps
          </span>
          <p className="mt-1 text-[11px] leading-snug text-hx-muted">
            Optional planning limits per squad (empty = unlimited).
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TEAM_KEYS.map(([label, k]) => (
              <li key={k}>
                <label className="flex flex-col rounded-xl border border-hx-border/70 bg-hx-bg/40 p-3 transition-colors hover:border-hx-border focus-within:border-hx-accent/40">
                  <span className="truncate text-[10px] font-medium uppercase tracking-wide text-hx-muted">
                    {label}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder=","
                    aria-label={`${label} cap`}
                    value={teamCaps[k] === null ? "" : teamCaps[k] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTeamCaps((tc) => ({
                        ...tc,
                        [k]: v === "" ? null : Math.max(0, Number(v) || 0),
                      }));
                    }}
                    className="mt-1 w-full border-0 bg-transparent p-0 text-xl font-bold tabular-nums text-hx-text placeholder:text-hx-muted/30 focus:outline-none"
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <CapacityExplainer configured={configured} capTotal={capTotal} />
    </div>
  );
}

function CapacityExplainer({
  configured,
  capTotal,
}: {
  configured: boolean;
  capTotal: number | null;
}) {
  return (
    <details className="group rounded-xl border border-hx-border/80 bg-hx-bg/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-hx-text marker:content-none [&::-webkit-details-marker]:hidden">
        <Info className="size-4 shrink-0 text-hx-accent" aria-hidden />
        <span>What are capacity points?</span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-hx-muted transition group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-hx-border/60 px-4 pb-4 pt-3 text-sm leading-relaxed text-hx-muted">
        <p>
          <span className="font-medium text-hx-text">Points</span> are workload units on the execution
          ledger. Each active task has a <span className="font-medium text-hx-text">weight</span> (often
          1.0; can be higher for heavier work). Your ring shows how much of your system budget is consumed
          by those weights right now.
        </p>

        <ul className="grid gap-2 sm:grid-cols-2">
          <ExplainerTile
            title="What counts as load"
            body="Sum of weights for ACTIVE executions on decisions you own , not completed or killed tasks."
          />
          <ExplainerTile
            title="System budget basis"
            body={
              configured || capTotal != null
                ? "You define the org total here. Usage % = active load ÷ system budget (same on Teams when saved)."
                : "Unset until you enter a number and save. Teams may fall back to per-owner reputation caps."
            }
          />
          <ExplainerTile
            title="Per-owner enforcement"
            body="Separately, each execution owner has a reputation-based cap (~3 pts × modifier). New work can be blocked if that owner is over their cap."
          />
          <ExplainerTile
            title="Team caps"
            body="Optional squad-level ceilings (Leadership, Growth, Product, Operations) for planning , leave blank if you do not split budget by team."
          />
        </ul>

        <p className="text-xs text-hx-muted">
          Save with <span className="font-medium text-hx-text">Save Changes</span> in the header. The gauge
          refreshes from the server after save.
        </p>
      </div>
    </details>
  );
}

function ExplainerTile({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-lg border border-hx-border/60 bg-hx-surface-elevated/20 px-3 py-2.5">
      <p className="text-xs font-semibold text-hx-text">{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-hx-muted">{body}</p>
    </li>
  );
}

function UsageRing({
  showGauge,
  pct,
  ringPct,
  tone,
}: {
  showGauge: boolean;
  pct: number | null;
  ringPct: number;
  tone: ReturnType<typeof usageTone>;
}) {
  const dash = showGauge ? (ringPct / 100) * RING_C : 0;

  return (
    <div
      className="relative flex size-[7.5rem] shrink-0 items-center justify-center"
      aria-label={showGauge ? `Capacity ${Math.round(pct!)} percent used` : "Capacity not set"}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          strokeWidth="7"
          className="stroke-hx-surface-elevated"
        />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={cn(ringStroke(tone), "transition-all duration-700 ease-out")}
          strokeDasharray={`${dash} ${RING_C}`}
        />
      </svg>
      <div className="relative text-center">
        {showGauge ? (
          <>
            <p className="text-3xl font-bold tabular-nums leading-none text-hx-text">
              {Math.round(pct!)}
              <span className="text-base font-semibold text-hx-muted">%</span>
            </p>
          </>
        ) : (
          <Gauge className="mx-auto size-6 text-hx-muted/50" strokeWidth={1.5} />
        )}
      </div>
    </div>
  );
}

