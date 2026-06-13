"use client";

import { Brain, GitBranch, Inbox, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

const STAGES = [
  {
    label: "Inputs",
    sub: "Signals captured",
    Icon: Inbox,
    accent: "landing-card-accent-blue",
  },
  {
    label: "Context",
    sub: "Company brain",
    Icon: Brain,
    accent: "landing-card-accent-purple",
  },
  {
    label: "Decisions",
    sub: "Structured logic",
    Icon: GitBranch,
    accent: "landing-card-accent-green",
  },
  {
    label: "Execution",
    sub: "Enforced outcomes",
    Icon: ShieldCheck,
    accent: "landing-card-accent-green-strong",
  },
] as const;

/** Structured counterpart to SignalChaosHub , one enforced loop */
export function DecisionLoopDiagram({ className }: { className?: string }) {
  return (
    <div
      className={cn("relative w-full", className)}
      aria-label="Hustronix decision loop: Inputs, Context, Decisions, and Execution in one enforced system."
    >
      <svg
        className="pointer-events-none absolute left-[8%] right-[8%] top-[28px] hidden h-px md:block"
        viewBox="0 0 400 4"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          x1="0"
          y1="2"
          x2="400"
          y2="2"
          stroke="rgba(198,168,90,0.35)"
          strokeWidth="1"
          strokeDasharray="6 4"
        />
      </svg>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-4">
        {STAGES.map((stage, i) => {
          const StageIcon = stage.Icon;
          return (
            <div
              key={stage.label}
              className={cn(
                "landing-card-solid relative rounded-2xl border border-white/[0.08] p-5 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5",
                stage.accent,
              )}
            >
              <span className="text-[10px] font-bold tabular-nums text-landing-gold/80">
                0{i + 1}
              </span>
              <div className="mt-3 flex size-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-landing-gold">
                <StageIcon className="size-5" strokeWidth={1.25} aria-hidden />
              </div>
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-hx-text">
                {stage.label}
              </p>
              <p className="mt-1.5 text-xs text-hx-muted/75">{stage.sub}</p>
              {i < STAGES.length - 1 && (
                <span
                  className="mt-4 flex items-center justify-center text-landing-gold/40 lg:hidden"
                  aria-hidden
                >
                  ↓
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs font-medium uppercase tracking-[0.28em] text-landing-gold/90">
        One loop · Ledger-backed · Enforced
      </p>
    </div>
  );
}
