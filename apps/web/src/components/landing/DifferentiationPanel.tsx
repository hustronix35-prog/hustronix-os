"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

const rows = [
  ["Dashboards", "Decision system"],
  ["Insights", "Enforced outcomes"],
  ["Suggestions", "Structured logic"],
  ["Manual follow-up", "Built-in accountability"],
] as const;

const ease = [0.22, 1, 0.36, 1] as const;
const rowVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: 0.06 + i * 0.07, ease },
  }),
};

export function DifferentiationPanel({ className }: { className?: string }) {
  const [mode, setMode] = useState<"both" | "traditional" | "hustronix">("both");
  const reduce = useReducedMotion();

  const leftCol = mode === "hustronix" ? "opacity-[0.32]" : "opacity-100";
  const rightCol = mode === "traditional" ? "opacity-[0.32]" : "opacity-100";

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["both", "Compare"],
              ["traditional", "Traditional tools"],
              ["hustronix", "Hustronix"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-all duration-200 ease-out",
                mode === id
                  ? "border-landing-gold/60 bg-landing-gold/15 text-hx-text shadow-[0_0_20px_rgba(198,168,90,0.15)]"
                  : "border-hx-border-subtle text-hx-muted hover:border-white/15 hover:text-hx-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 border-t border-white/[0.08] pt-3 sm:border-0 sm:pt-0"
          role="group"
          aria-label="Before and after"
        >
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.28em] text-hx-muted/90 sm:inline">
            Before / After
          </span>
          <button
            type="button"
            onClick={() => setMode("traditional")}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-all duration-200",
              mode === "traditional"
                ? "border-landing-gold/50 bg-white/[0.06] text-hx-text"
                : "border-hx-border-subtle text-hx-muted hover:border-white/14 hover:text-hx-text",
            )}
          >
            Before
          </button>
          <button
            type="button"
            onClick={() => setMode("hustronix")}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-all duration-200",
              mode === "hustronix"
                ? "border-landing-gold/50 bg-landing-gold/12 text-landing-gold"
                : "border-hx-border-subtle text-hx-muted hover:border-white/14 hover:text-hx-text",
            )}
          >
            After
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div
            className={cn(
              "border-b border-white/[0.08] bg-[#050505]/90 px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-hx-muted/80 transition-opacity duration-300 md:border-b-0 md:border-r",
              leftCol,
            )}
          >
            Traditional tools
          </div>
          <div
            className={cn(
              "relative border-b border-landing-gold/35 bg-[#080808] px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-landing-gold transition-opacity duration-300",
              "shadow-[inset_0_0_0_1px_rgba(198,168,90,0.25),0_0_48px_rgba(198,168,90,0.12)]",
              rightCol,
            )}
          >
            Hustronix
          </div>
        </div>
        {rows.map(([left, right], rowIndex) =>
          reduce ? (
            <div
              key={left}
              className="landing-diff-row group grid grid-cols-1 border-b border-white/[0.05] last:border-b-0 md:grid-cols-2"
            >
              <div
                className={cn(
                  "px-6 py-5 text-sm text-hx-muted/85 transition-opacity duration-300 md:border-r md:border-white/[0.05]",
                  leftCol,
                )}
              >
                {left}
              </div>
              <div
                className={cn(
                  "bg-[#060606]/90 px-6 py-5 text-sm font-medium text-hx-text transition-opacity duration-300",
                  "group-hover:bg-white/[0.05]",
                  rightCol,
                )}
              >
                {right}
              </div>
            </div>
          ) : (
            <motion.div
              key={left}
              custom={rowIndex}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-30px", amount: 0.25 }}
              variants={rowVariants}
              className="landing-diff-row group grid grid-cols-1 border-b border-white/[0.05] last:border-b-0 md:grid-cols-2"
            >
              <div
                className={cn(
                  "px-6 py-5 text-sm text-hx-muted/85 transition-opacity duration-300 md:border-r md:border-white/[0.05]",
                  leftCol,
                )}
              >
                {left}
              </div>
              <div
                className={cn(
                  "bg-[#060606]/90 px-6 py-5 text-sm font-medium text-hx-text transition-colors duration-200",
                  "group-hover:bg-white/[0.07]",
                  "shadow-[inset_0_0_0_0_rgba(198,168,90,0)] group-hover:shadow-[inset_0_0_0_1px_rgba(198,168,90,0.28)]",
                  rightCol,
                )}
              >
                {right}
              </div>
            </motion.div>
          ),
        )}
      </div>
    </div>
  );
}
