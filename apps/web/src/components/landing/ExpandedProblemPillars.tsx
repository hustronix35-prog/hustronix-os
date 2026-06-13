"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Gauge, Network, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

const PILLARS = [
  {
    n: "01",
    title: "Invisible inefficiency",
    body: "Misalignment creates duplicated work, delays, and coordination overhead. Teams unknowingly solve the same problems in parallel.",
    Icon: Gauge,
    accent: "landing-card-accent-blue",
  },
  {
    n: "02",
    title: "Governance risk",
    body: "Critical workflows lose traceability and execution visibility. Compliance risks multiply when leadership cannot audit operational integrity.",
    Icon: ShieldCheck,
    accent: "landing-card-accent-purple",
  },
  {
    n: "03",
    title: "Signal fragmentation",
    body: "Signals live everywhere,but no system continuously aligns execution with strategic intent. The gap widens every day.",
    Icon: Network,
    accent: "landing-card-accent-green",
  },
] as const;

export function ExpandedProblemPillars({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("grid gap-6 md:grid-cols-3 md:gap-8", className)}>
      {PILLARS.map((p, i) => {
        const Icon = p.Icon;
        const card = (
          <article
            className={cn(
              "landing-card-solid group relative overflow-hidden rounded-2xl p-7 md:p-8",
              p.accent,
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full border border-landing-gold/30 bg-black/40 text-xs font-bold text-landing-gold">
              {p.n}
            </span>
            <div className="mt-5 flex size-11 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-landing-gold transition-transform duration-300 group-hover:scale-105">
              <Icon className="size-5" strokeWidth={1.25} aria-hidden />
            </div>
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-hx-text">{p.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-hx-muted/80">{p.body}</p>
          </article>
        );

        if (reduce) return <div key={p.n}>{card}</div>;

        return (
          <motion.div
            key={p.n}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: 0.55, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            {card}
          </motion.div>
        );
      })}
    </div>
  );
}
