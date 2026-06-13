"use client";

import { useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Brain, GitBranch, Inbox, Zap } from "lucide-react";

const NODES = [
  { label: "Inputs", Icon: Inbox },
  { label: "Intelligence", Icon: Brain },
  { label: "Decision", Icon: GitBranch },
  { label: "Execution", Icon: Zap },
] as const;

export function FlowPulse() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const lineInView = useInView(rootRef, { once: true, margin: "-12% 0px" });
  const active = reduce || lineInView;

  return (
    <div>
      <div
        ref={rootRef}
        className={cn(
          "landing-flow-root relative flex flex-col items-stretch gap-0 md:flex-row md:items-center md:justify-between md:gap-0",
          active && "landing-flow-root--in",
        )}
      >
        <div className="absolute left-[10%] right-[10%] top-[22px] hidden h-px md:block" aria-hidden>
          <div className="relative size-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className={cn(
                "absolute inset-0 opacity-60 transition-opacity duration-700",
                active ? "landing-line-pulse" : "opacity-0",
              )}
            />
          </div>
        </div>
        {NODES.map(({ label, Icon }, i) => (
          <div
            key={label}
            className="landing-flow-node group relative z-[1] flex flex-1 flex-col items-center"
            style={{
              transitionDelay: reduce ? "0ms" : `${i * 80}ms`,
            }}
          >
            {i > 0 && (
              <div
                className="my-2 h-6 w-px bg-gradient-to-b from-landing-gold/50 to-transparent md:hidden"
                aria-hidden
              />
            )}
            <div
              className={cn(
                "landing-flow-icon flex size-11 items-center justify-center rounded-full border border-white/10 bg-[rgba(255,255,255,0.04)] text-landing-gold/90 transition-all duration-200 ease-out",
                "group-hover:scale-105 group-hover:border-landing-gold/45 group-hover:text-landing-gold group-hover:shadow-[0_0_28px_rgba(198,168,90,0.2)]",
              )}
            >
              <Icon className="size-5" strokeWidth={1.25} aria-hidden />
            </div>
            <span className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-hx-muted/80 transition-colors group-hover:text-hx-text">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
