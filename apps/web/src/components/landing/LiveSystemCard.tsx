"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

const ROWS = [
  { label: "Signals reconciled", state: "Nothing missed" },
  { label: "Decisions captured", state: "Nothing lost" },
  { label: "Execution linked", state: "Nothing breaks" },
] as const;

const ease = [0.22, 1, 0.36, 1] as const;

export function LiveSystemCard() {
  const reduce = useReducedMotion();

  return (
    <div className="relative rounded-3xl border border-white/[0.1] bg-[rgba(255,255,255,0.03)] p-8 shadow-[0_0_60px_rgba(198,168,90,0.08),0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div
        className="pointer-events-none absolute -inset-px rounded-3xl opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(198,168,90,0.18), transparent 65%)",
        }}
        aria-hidden
      />
      <div className="absolute right-6 top-6 flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="hx-activity-dot size-1.5 rounded-full bg-landing-gold/80"
          />
        ))}
      </div>
      <ul className="relative space-y-5 text-sm leading-relaxed md:text-base">
        {ROWS.map((row, i) => (
          <motion.li
            key={row.label}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45, delay: 0.15 + i * 0.18, ease }}
            className="flex justify-between gap-4 border-b border-white/[0.07] pb-5 last:border-b-0 last:pb-0"
          >
            <span className="flex items-start gap-3 text-hx-text">
              <motion.span
                initial={reduce ? false : { scale: 0 }}
                whileInView={reduce ? undefined : { scale: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 400, damping: 22, delay: 0.2 + i * 0.15 }}
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-landing-gold/40 bg-landing-gold/10 text-landing-gold"
              >
                <Check className="size-3" strokeWidth={2.5} aria-hidden />
              </motion.span>
              {row.label}
            </span>
            <span className="text-right text-hx-muted/75">{row.state}</span>
          </motion.li>
        ))}
      </ul>
      <p className="relative mt-8 text-sm font-medium leading-relaxed text-hx-text">
        You don&apos;t rely on alignment.
        <br />
        You <span className="text-landing-gold">verify</span> it.
      </p>
    </div>
  );
}
