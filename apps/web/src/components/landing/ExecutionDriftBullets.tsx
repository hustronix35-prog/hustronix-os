"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Compass, Network, Target } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  {
    title: "Fragmented systems",
    body: "Tools operate without shared operational context.",
    Icon: Network,
  },
  {
    title: "Strategic drift",
    body: "Teams execute outdated priorities after leadership shifts direction.",
    Icon: Compass,
  },
  {
    title: "Alignment gap",
    body: "Signals everywhere,but no system that continuously aligns execution.",
    Icon: Target,
  },
] as const;

const itemClass =
  "flex gap-4 rounded-xl border border-white/[0.07] bg-black/25 p-4 backdrop-blur-sm";

export function ExecutionDriftBullets({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <ul className={cn("mt-8 space-y-4", className)}>
      {ITEMS.map((item, i) => {
        const Icon = item.Icon;
        const body = (
          <>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-landing-gold/25 bg-landing-gold/10 text-landing-gold">
              <Icon className="size-5" strokeWidth={1.25} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.1em] text-hx-text">
                {item.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-hx-muted/80">{item.body}</p>
            </div>
          </>
        );

        if (reduce) {
          return (
            <li key={item.title} className={itemClass}>
              {body}
            </li>
          );
        }

        return (
          <motion.li
            key={item.title}
            className={itemClass}
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: 0.15 + i * 0.08 }}
          >
            {body}
          </motion.li>
        );
      })}
    </ul>
  );
}
