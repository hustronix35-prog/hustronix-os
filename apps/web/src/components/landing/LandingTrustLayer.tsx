"use client";

import { cn } from "@/lib/cn";
import { LandingIntegrations } from "@/components/landing/LandingIntegrations";
import { LandingSecurity } from "@/components/landing/LandingSecurity";
import { SystemArchitectureFlow } from "@/components/landing/SystemArchitectureFlow";
import { Reveal } from "@/components/landing/ScrollReveal";

export function LandingTrustLayer({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-10 md:space-y-12", className)}>
      <Reveal>
        <div className="rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/90 p-6 md:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hx-muted">
            System architecture
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-hx-muted/85 md:text-base">
            Signals enter a context layer where relationships and decision
            dependencies are modeled. The intelligence engine reasons over that
            graph; the execution layer commits outcomes to a ledger your teams
            can audit—not a black-box summary.
          </p>
          <SystemArchitectureFlow className="mt-8" />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/90 p-6 md:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hx-muted">
            Integrations
          </p>
          <p className="mt-3 text-sm text-hx-muted/85">
            Connect where work already happens. Hustronix ingests; it does not
            ask teams to migrate.
          </p>
          <LandingIntegrations className="mt-6 justify-start" />
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hx-muted">
          Security &amp; infrastructure
        </p>
        <LandingSecurity className="mt-6" />
      </Reveal>

      <Reveal delay={0.1}>
        <blockquote className="border-l-2 border-landing-gold/40 pl-5 text-base leading-relaxed text-hx-text/90 md:text-lg">
          Most systems capture data but lose operational understanding between
          channels. Hustronix preserves that understanding as a durable,
          queryable layer—built for operators who need defensible execution, not
          another AI demo.
        </blockquote>
      </Reveal>
    </div>
  );
}
