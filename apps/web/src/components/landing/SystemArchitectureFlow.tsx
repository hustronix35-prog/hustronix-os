"use client";

import { cn } from "@/lib/cn";

const STAGES = [
  "Signals",
  "Context layer",
  "Causal mapping",
  "Intelligence engine",
  "Execution layer",
] as const;

export function SystemArchitectureFlow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-2 md:gap-3",
        className,
      )}
      role="img"
      aria-label="System flow: Signals to Context layer to Causal mapping to Intelligence engine to Execution layer"
    >
      {STAGES.map((stage, i) => (
        <span key={stage} className="flex items-center gap-2 md:gap-3">
          <span className="rounded-lg border border-white/[0.1] bg-black/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-hx-text md:px-4 md:text-[11px]">
            {stage}
          </span>
          {i < STAGES.length - 1 && (
            <span className="text-landing-gold/50" aria-hidden>
              →
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
