"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Reveal } from "@/components/landing/ScrollReveal";

const BEFORE = [
  "Disconnected tools and duplicate work",
  "Fragmented communication across teams",
  "Invisible blockers until deadlines slip",
  "Meeting chaos without shared context",
  "Execution drift against stated priorities",
] as const;

const AFTER = [
  "Unified execution context across the company",
  "Aligned priorities tied to live signals",
  "Clear ownership and escalation paths",
  "Operational visibility for leadership",
  "Faster decisions with audit-ready follow-through",
] as const;

export function BeforeAfterTransform({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-stretch md:gap-6", className)}>
      <Reveal>
        <div className="landing-card-solid landing-card-accent-purple h-full rounded-2xl border border-white/[0.08] p-6 md:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.42em] text-hx-muted">
            Before
          </p>
          <h3 className="mt-4 text-lg font-semibold text-hx-text">
            Execution fragments across tools
          </h3>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-hx-muted/85">
            {BEFORE.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-400/70" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
      <Reveal delay={0.05} className="flex items-center justify-center py-2 md:py-0">
        <div
          className="flex size-11 items-center justify-center rounded-full border border-landing-gold/35 bg-landing-gold/10 text-landing-gold"
          aria-hidden
        >
          <ArrowRight className="size-5" />
        </div>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="landing-glass-card landing-card-accent-green h-full rounded-2xl border border-landing-gold/20 p-6 md:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.42em] text-landing-gold/90">
            After Hustronix
          </p>
          <h3 className="mt-4 text-lg font-semibold text-hx-text">
            One operational intelligence layer
          </h3>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-hx-muted/85">
            {AFTER.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--landing-accent-green)]" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
}
