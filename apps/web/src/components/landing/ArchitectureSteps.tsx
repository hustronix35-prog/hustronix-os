"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Brain,
  Cloud,
  LayoutDashboard,
  Radio,
  Unplug,
} from "lucide-react";
import { cn } from "@/lib/cn";

const AUTO_MS = 5500;

const STEPS = [
  {
    step: "01",
    title: "Data ingestion",
    body: "Connect Slack, Jira, GitHub, meetings, CRM, and email as unified signal sources.",
    Icon: Unplug,
  },
  {
    step: "02",
    title: "Signal capture",
    body: "Continuous real-time capture from all connected systems,without disrupting workflows.",
    Icon: Radio,
  },
  {
    step: "03",
    title: "Context engine",
    body: "Real-time context modeling builds a live operational graph of enterprise activity.",
    Icon: Activity,
  },
  {
    step: "04",
    title: "Analytics & reasoning",
    body: "Alignment and drift detection surfaces execution conflicts before they compound.",
    Icon: Brain,
  },
  {
    step: "05",
    title: "APIs & dashboards",
    body: "Expose operational intelligence through APIs and visual surfaces your teams already use.",
    Icon: LayoutDashboard,
  },
  {
    step: "06",
    title: "Cloud-native scale",
    body: "Enterprise-grade reliability, security, and elastic performance at any scale.",
    Icon: Cloud,
  },
] as const;

function SkipControl({
  onSkip,
  className,
}: {
  onSkip: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      className={cn(
        "z-20 rounded-md border border-white/[0.08] bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-hx-muted/75 backdrop-blur-md transition hover:border-landing-gold/40 hover:bg-landing-gold/10 hover:text-landing-gold",
        className,
      )}
    >
      Skip
    </button>
  );
}

function StepIconTile({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex size-9 items-center justify-center rounded-xl border transition-colors duration-300",
        active
          ? "border-landing-gold/35 bg-landing-gold/15 text-landing-gold"
          : "border-white/[0.08] bg-black/30 text-hx-muted/75 group-hover:border-white/12 group-hover:text-hx-text",
      )}
    >
      {children}
    </div>
  );
}

function CardGlow() {
  return (
    <div
      className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-landing-gold/[0.07] blur-3xl"
      aria-hidden
    />
  );
}

export function ArchitectureSteps({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [autoOff, setAutoOff] = useState(false);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const current = STEPS[active];
  const CurrentIcon = current.Icon;
  const autoPlay = !reduce && !paused && !autoOff && inView;

  const goTo = useCallback((index: number) => {
    setActive(index % STEPS.length);
  }, []);

  const advance = useCallback(() => {
    setActive((i) => (i + 1) % STEPS.length);
  }, []);

  const skipFrom = useCallback(
    (index: number) => {
      if (index >= STEPS.length - 1) {
        setAutoOff(true);
        return;
      }
      goTo(index + 1);
    },
    [goTo],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el || reduce) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  useEffect(() => {
    if (!autoPlay) return;
    const id = window.setInterval(advance, AUTO_MS);
    return () => window.clearInterval(id);
  }, [autoPlay, advance]);

  return (
    <div
      ref={rootRef}
      className={cn("mt-14", className)}
      data-mechanism-carousel=""
      role="region"
      aria-roledescription="carousel"
      aria-label="How the platform works"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <motion.div
        className="relative mb-8 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#161616] via-[#0c0c0c] to-[#050505] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] md:p-8"
        key={active}
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        aria-live="polite"
      >
        <CardGlow />
        <SkipControl
          className="absolute right-4 top-4 md:right-6 md:top-6"
          onSkip={() => skipFrom(active)}
        />

        <div className="relative flex flex-wrap items-start gap-4 md:gap-6">
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-landing-gold/25 bg-landing-gold/10 px-2.5 py-1 text-xs font-bold tabular-nums text-landing-gold">
              {current.step}
            </span>
            <div className="flex size-12 items-center justify-center rounded-xl border border-landing-gold/30 bg-gradient-to-br from-landing-gold/20 to-landing-gold/5 text-landing-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <CurrentIcon className="size-6" strokeWidth={1.25} aria-hidden />
            </div>
          </div>
          <div className="min-w-0 flex-1 pr-12 md:pr-14">
            <h3 className="text-lg font-semibold tracking-tight text-hx-text md:text-xl">
              {current.title}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-hx-muted/90 md:text-base">
              {current.body}
            </p>
          </div>
        </div>

        <div
          className="relative mt-6 h-1 overflow-hidden rounded-full bg-white/[0.06]"
          aria-hidden
        >
          {autoPlay ? (
            <motion.div
              key={`progress-${active}`}
              className="h-full origin-left rounded-full bg-gradient-to-r from-landing-gold/60 via-landing-gold to-landing-gold/80"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: AUTO_MS / 1000, ease: "linear" }}
            />
          ) : (
            <div
              className="h-full rounded-full bg-gradient-to-r from-landing-gold/40 to-landing-gold/70 transition-[width] duration-300"
              style={{ width: `${((active + 1) / STEPS.length) * 100}%` }}
            />
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
        {STEPS.map((s, i) => {
          const StepIcon = s.Icon;
          const isActive = active === i;
          return (
            <div key={s.step} className="relative">
              <SkipControl
                className="absolute right-2 top-2"
                onSkip={() => skipFrom(i)}
              />
              <button
                type="button"
                aria-current={isActive ? "step" : undefined}
                aria-label={`${s.step}: ${s.title}`}
                onClick={() => goTo(i)}
                className={cn(
                  "group relative w-full overflow-hidden rounded-2xl border px-3 pb-3.5 pt-9 text-left transition-all duration-300 sm:px-3.5",
                  isActive
                    ? "border-landing-gold/45 bg-gradient-to-b from-landing-gold/[0.14] to-[#0a0a0a]/90 shadow-[0_0_36px_rgba(198,168,90,0.14),inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-[#0a0a0a]/80 hover:border-white/14 hover:from-white/[0.06] hover:shadow-[0_12px_32px_rgba(0,0,0,0.35)]",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-landing-gold/50 to-transparent opacity-0 transition-opacity duration-300",
                    isActive && "opacity-100",
                  )}
                  aria-hidden
                />
                <StepIconTile active={isActive}>
                  <StepIcon className="size-4" strokeWidth={1.35} aria-hidden />
                </StepIconTile>
                <p
                  className={cn(
                    "mt-3 text-[10px] font-bold uppercase tracking-[0.16em]",
                    isActive ? "text-landing-gold" : "text-hx-muted",
                  )}
                >
                  {s.step}
                </p>
                <p
                  className={cn(
                    "mt-1 hidden text-[11px] leading-snug sm:block",
                    isActive ? "font-medium text-hx-text" : "text-hx-muted/75",
                  )}
                >
                  {s.title}
                </p>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
