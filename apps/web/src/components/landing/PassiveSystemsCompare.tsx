"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Brain,
  ClipboardCheck,
  Eye,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";

const EXISTING = [
  { name: "Slack", color: "text-[#E01E5A]" },
  { name: "Jira", color: "text-[#2684FF]" },
  { name: "Notion", color: "text-hx-text" },
  { name: "AI Copilots", Icon: Sparkles, color: "text-landing-accent-purple" },
  { name: "BI Dashboards", Icon: BarChart3, color: "text-landing-accent-blue" },
] as const;

const MISSING = [
  { label: "Strategic memory", Icon: Brain },
  { label: "Decision context", Icon: Target },
  { label: "Execution verification", Icon: ClipboardCheck },
  { label: "Persistent operational awareness", Icon: Eye },
  { label: "Real-time operational reasoning", Icon: Zap },
] as const;

export function PassiveSystemsCompare({ className }: { className?: string }) {
  const [activeMissing, setActiveMissing] = useState(0);
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-6", className)}
      initial={reduce ? false : { opacity: 0 }}
      whileInView={reduce ? undefined : { opacity: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6 }}
    >
      <div className="rounded-2xl border border-white/[0.08] bg-[#080808]/90 p-5 md:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hx-muted">
          Existing systems
        </p>
        <p className="mt-2 text-sm text-hx-muted/80">Passive tools , data in, no alignment out.</p>
        <ul className="mt-5 space-y-2.5">
          {EXISTING.map((item) => {
            const Icon = "Icon" in item ? item.Icon : null;
            return (
              <li
                key={item.name}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2.5 text-sm text-hx-text/90"
              >
                {Icon ? (
                  <Icon className={cn("size-4 shrink-0", item.color)} aria-hidden />
                ) : (
                  <span className={cn("text-xs font-bold", item.color)} aria-hidden>
                    ●
                  </span>
                )}
                {item.name}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="hidden items-center justify-center lg:flex" aria-hidden>
        <motion.span
          className="text-3xl text-landing-gold"
          animate={reduce ? undefined : { x: [0, 6, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          →
        </motion.span>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[#080808]/90 p-5 md:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-landing-gold">
          Missing layer
        </p>
        <p className="mt-2 text-sm text-hx-muted/80">What enterprises need but no tool provides.</p>
        <ul className="mt-5 space-y-2">
          {MISSING.map((item, i) => {
            const ItemIcon = item.Icon;
            const active = activeMissing === i;
            return (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => setActiveMissing(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-200",
                    active
                      ? "border-landing-gold/50 bg-landing-gold/10 text-hx-text shadow-[0_0_24px_rgba(198,168,90,0.12)]"
                      : "border-white/[0.06] bg-black/20 text-hx-muted/85 hover:border-white/12 hover:text-hx-text",
                  )}
                >
                  <ItemIcon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-landing-gold" : "text-landing-gold/60",
                    )}
                    strokeWidth={1.25}
                    aria-hidden
                  />
                  <span className="leading-snug">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="lg:col-span-3">
        <div className="landing-card-highlight rounded-2xl p-6 md:flex md:items-center md:justify-between md:gap-8 md:p-8">
          <motion.div
            className="flex size-14 shrink-0 items-center justify-center rounded-full border border-landing-gold/40 bg-black/50"
            animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Target className="size-7 text-landing-gold" strokeWidth={1.25} aria-hidden />
          </motion.div>
          <div className="mt-5 md:mt-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-landing-gold">
              Hustronix
            </p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-hx-text md:text-2xl">
              Operational Intelligence Layer
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-hx-muted/85 md:text-base">
              Continuously connects decisions, context, and execution across systems.
            </p>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-hx-muted/90 md:mt-0 md:max-w-xs md:text-right">
            The moat is not information.{" "}
            <strong className="text-landing-gold">It is operational alignment.</strong>
          </p>
        </div>
      </div>
    </motion.div>
  );
}
