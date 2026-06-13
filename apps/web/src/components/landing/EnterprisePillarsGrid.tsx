"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Box, Eye, GitBranch, Users } from "lucide-react";
import { cn } from "@/lib/cn";

const PILLARS = [
  {
    title: "Decisions",
    body: "Capture and retain the context behind every strategic decision.",
    Icon: GitBranch,
    accent: "landing-card-accent-blue",
  },
  {
    title: "Execution",
    body: "Connect work, workflows, and systems to drive aligned execution.",
    Icon: Box,
    accent: "landing-card-accent-green",
  },
  {
    title: "Organizational context",
    body: "Model relationships, priorities, and operational signals across the enterprise.",
    Icon: Users,
    accent: "landing-card-accent-purple",
  },
  {
    title: "Operational visibility",
    body: "Deliver real-time visibility, insights, and continuous alignment.",
    Icon: Eye,
    accent: "landing-card-accent-green-strong",
  },
] as const;

export function EnterprisePillarsGrid({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("grid gap-5 sm:grid-cols-2 lg:gap-6", className)}>
      {PILLARS.map((p, i) => {
        const Icon = p.Icon;
        const card = (
          <article
            className={cn(
              "landing-glass-card group rounded-2xl p-6 transition-all duration-300 md:p-7",
              p.accent,
            )}
          >
            <div className="flex size-11 items-center justify-center rounded-full border border-landing-gold/25 bg-black/40 text-landing-gold">
              <Icon className="size-5" strokeWidth={1.25} aria-hidden />
            </div>
            <h3 className="mt-5 text-base font-semibold uppercase tracking-[0.12em] text-hx-text">
              {p.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-hx-muted/80">{p.body}</p>
          </article>
        );

        if (reduce) {
          return <div key={p.title}>{card}</div>;
        }

        return (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            whileHover={{ y: -4 }}
          >
            {card}
          </motion.div>
        );
      })}
    </div>
  );
}
