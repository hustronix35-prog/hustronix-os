"use client";

import { cn } from "@/lib/cn";
import { RevealStaggerItem, RevealStaggerList } from "@/components/landing/ScrollReveal";

const METRICS = [
  {
    label: "Operational drift",
    direction: "Reduce",
    detail: "Surface misalignment before it compounds across teams.",
  },
  {
    label: "Cross-functional visibility",
    direction: "Improve",
    detail: "Shared context from signals—not another siloed dashboard.",
  },
  {
    label: "Blocker detection",
    direction: "Earlier",
    detail: "Ownership gaps and conflicts flagged while there is still runway.",
  },
  {
    label: "Strategic alignment velocity",
    direction: "Increase",
    detail: "Decisions propagate with execution follow-through, not slide decks.",
  },
] as const;

export function OperationalOutcomes({ className }: { className?: string }) {
  return (
    <RevealStaggerList
      className={cn("grid list-none gap-5 sm:grid-cols-2", className)}
    >
      {METRICS.map((m) => (
        <RevealStaggerItem
          key={m.label}
          className="landing-card-solid landing-card-accent-blue rounded-2xl p-6 md:p-7"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hx-muted">
            {m.direction}
          </p>
          <p className="mt-2 font-sans text-xl font-bold tracking-tight text-hx-text md:text-2xl">
            {m.label}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-hx-muted/80">{m.detail}</p>
        </RevealStaggerItem>
      ))}
    </RevealStaggerList>
  );
}
