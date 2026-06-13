"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden
      fill="none"
    >
      <polygon
        points="24,2 44,14 44,34 24,46 4,34 4,14"
        stroke="#EDEDED"
        strokeWidth="1.15"
      />
      <path
        d="M15 15h5v18h-5V15zm13 0h5v18h-5V15zm-8 7h11v4H20v-4z"
        fill="#EDEDED"
      />
      <line
        x1="24"
        y1="11"
        x2="24"
        y2="37"
        stroke="#D4AF37"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="24" cy="15" r="2.25" fill="#D4AF37" />
      <circle cx="24" cy="33" r="2.25" fill="#D4AF37" />
    </svg>
  );
}

function HexBackdrop({
  parallax,
}: {
  parallax: { x: number; y: number };
}) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const layer = (mult: number, opacity: string, classExtra?: string) => (
    <div
      className={`landing-hex-layer pointer-events-none absolute inset-[-12%] ${classExtra ?? ""}`}
      style={{
        transform: reduced
          ? undefined
          : `translate3d(${parallax.x * mult}px, ${parallax.y * mult}px, 0)`,
        opacity,
      }}
      aria-hidden
    >
      <svg
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern
            id="hx-hex"
            width="56"
            height="97.98"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(0.9)"
          >
            <path
              d="M28 0L54.25 15.5v31L28 62 1.75 46.5v-31L28 0z"
              fill="none"
              stroke="rgba(212,175,55,0.12)"
              strokeWidth="0.45"
            />
            <path
              d="M28 49L54.25 64.5v31L28 111 1.75 95.5v-31L28 49z"
              fill="none"
              stroke="rgba(212,175,55,0.1)"
              strokeWidth="0.45"
            />
          </pattern>
          <radialGradient id="hx-vignette" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="rgba(10,10,10,0)" />
            <stop offset="100%" stopColor="rgba(10,10,10,0.92)" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#hx-hex)" />
        <rect width="100%" height="100%" fill="url(#hx-vignette)" />
      </svg>
    </div>
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0A0A0A]">
      {layer(0.35, "0.85")}
      {layer(0.55, "0.55", "mix-blend-screen")}
      <div
        className="pointer-events-none absolute inset-0 animate-[landing-glow-pulse_14s_ease-in-out_infinite]"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 50% 18%, rgba(212,175,55,0.09) 0%, transparent 55%)",
        }}
      />
      <svg
        className="pointer-events-none absolute right-[8%] top-[22%] h-[min(42vw,520px)] w-[min(42vw,520px)] text-[#D4AF37]/20"
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden
        style={{
          transform: reduced
            ? undefined
            : `translate3d(${parallax.x * 0.4}px, ${parallax.y * 0.35}px, 0)`,
        }}
      >
        <circle cx="200" cy="120" r="6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="120" cy="220" r="6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="280" cy="240" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M200 120 L200 200 M200 200 L120 220 M200 200 L280 240"
          stroke="currentColor"
          strokeWidth="0.8"
          opacity="0.9"
        />
        <polygon
          points="200,176 224,190 224,218 200,232 176,218 176,190"
          stroke="#EDEDED"
          strokeOpacity="0.25"
          strokeWidth="0.9"
        />
      </svg>
    </div>
  );
}

const pillarCopy = [
  {
    title: "Decision clarity",
    body: "Cut through noise with a single place to review signals, options, and commitments.",
  },
  {
    title: "System alignment",
    body: "Keep teams, policies, and execution traces pointed at the same north star.",
  },
  {
    title: "Execution excellence",
    body: "Move from intent to action with traceable transitions and accountable follow-through.",
  },
] as const;

function FlowGraphic() {
  return (
    <div className="grid gap-10 md:grid-cols-4 md:gap-6">
      {[
        {
          label: "Inputs",
          desc: "Signals converge",
          graphic: (
            <svg viewBox="0 0 120 80" className="w-full max-w-[140px]" aria-hidden>
              <path
                d="M10 40 L50 40 M110 20 L60 38 M110 60 L60 42"
                stroke="#D4AF37"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle cx="56" cy="40" r="5" stroke="#EDEDED" strokeWidth="1" fill="none" />
            </svg>
          ),
        },
        {
          label: "Intelligence",
          desc: "Context compounds",
          graphic: (
            <svg viewBox="0 0 120 80" className="w-full max-w-[140px]" aria-hidden>
              <polygon
                points="60,18 88,36 88,64 60,82 32,64 32,36"
                stroke="#EDEDED"
                strokeOpacity="0.35"
                strokeWidth="1"
                fill="none"
              />
              <path
                d="M32 50 L60 50 M88 50 L60 50 M60 32 L60 68"
                stroke="#D4AF37"
                strokeWidth="1"
              />
              <circle cx="60" cy="50" r="4" fill="#D4AF37" />
            </svg>
          ),
        },
        {
          label: "Decision",
          desc: "Branches resolve",
          graphic: (
            <svg viewBox="0 0 120 80" className="w-full max-w-[140px]" aria-hidden>
              <circle cx="60" cy="28" r="4" fill="#D4AF37" />
              <path
                d="M60 32 L36 58 M60 32 L84 58"
                stroke="#EDEDED"
                strokeOpacity="0.45"
                strokeWidth="1"
              />
              <circle cx="36" cy="62" r="3" stroke="#EDEDED" strokeWidth="1" fill="none" />
              <circle cx="84" cy="62" r="3" stroke="#EDEDED" strokeWidth="1" fill="none" />
            </svg>
          ),
        },
        {
          label: "Execution",
          desc: "Momentum ships",
          graphic: (
            <svg viewBox="0 0 120 80" className="w-full max-w-[140px]" aria-hidden>
              <path
                d="M12 44 H92"
                stroke="#D4AF37"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M12 56 H92"
                stroke="#EDEDED"
                strokeOpacity="0.25"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M84 36 L100 50 L84 64"
                stroke="#D4AF37"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>
          ),
        },
      ].map((step) => (
        <div
          key={step.label}
          className="group flex flex-col items-center text-center"
        >
          <div className="mb-4 flex min-h-[88px] items-center justify-center transition-transform duration-500 group-hover:scale-[1.03]">
            {step.graphic}
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#EDEDED]">
            {step.label}
          </h3>
          <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-[#9CA3AF]">
            {step.desc}
          </p>
        </div>
      ))}
    </div>
  );
}

function Reveal({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setShow(true);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const style: CSSProperties = {
    animationDelay: `${delay}ms`,
    animationFillMode: "both",
  };

  return (
    <div
      ref={ref}
      className={
        show
          ? "animate-[landing-fade-up_0.85s_cubic-bezier(0.22,1,0.36,1)_both]"
          : "opacity-0"
      }
      style={style}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const onMove = useCallback((e: MouseEvent) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    setParallax({
      x: (e.clientX - cx) * 0.018,
      y: (e.clientY - cy) * 0.018,
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [onMove]);

  return (
    <div className="landing-page relative min-h-dvh overflow-x-hidden bg-[#0A0A0A] text-[#EDEDED]">
      <HexBackdrop parallax={parallax} />

      <header className="relative z-20 border-b border-[rgba(237,237,237,0.06)] bg-[#0A0A0A]/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark className="h-10 w-10 shrink-0" />
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold uppercase tracking-[0.35em] text-[#EDEDED]">
                Hustronix
              </span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.42em] text-[#9CA3AF]">
                Decide. Align. Execute.
              </span>
            </div>
          </Link>
          <nav
            className="flex items-center gap-2 text-sm md:gap-6"
            aria-label="Primary"
          >
            <a
              href="#pillars"
              className="hidden rounded-md px-2 py-1.5 text-[#9CA3AF] transition-colors hover:text-[#EDEDED] md:inline"
            >
              Pillars
            </a>
            <a
              href="#flow"
              className="hidden rounded-md px-2 py-1.5 text-[#9CA3AF] transition-colors hover:text-[#EDEDED] md:inline"
            >
              Flow
            </a>
            <Link
              href="/login"
              className="rounded-md px-2 py-1.5 text-[#9CA3AF] transition-colors hover:text-[#EDEDED]"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#0A0A0A] shadow-[0_0_0_1px_rgba(212,175,55,0.35)] transition-[background-color,transform] duration-300 hover:bg-[#A88F2A] hover:shadow-[0_0_24px_rgba(212,175,55,0.25)] active:scale-[0.98]"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex max-w-6xl flex-col gap-12 px-6 pb-24 pt-20 md:flex-row md:items-center md:justify-between md:px-8 md:pb-32 md:pt-28">
          <div className="max-w-xl">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[#D4AF37]">
                Decision operating system
              </p>
              <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.08] tracking-tight text-[#EDEDED] md:text-5xl lg:text-[3.25rem]">
                One system. Clear direction. Real impact.
              </h1>
              <p className="mt-6 max-w-lg text-pretty text-lg leading-relaxed text-[#9CA3AF]">
                Hustronix unifies signals, decisions, and execution so leaders
                move with confidence—not chaos. Calm language. Precise controls.
                Authoritative outcomes.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-[#D4AF37] px-7 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#0A0A0A] transition-[background-color,transform,box-shadow] duration-300 hover:bg-[#A88F2A] hover:shadow-[0_0_32px_rgba(212,175,55,0.28)] active:scale-[0.98]"
                >
                  Start free
                </Link>
                <Link
                  href="/mission-control"
                  className="inline-flex items-center justify-center rounded-full border border-[rgba(237,237,237,0.14)] bg-[#1A1A1A]/80 px-7 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#EDEDED] backdrop-blur-sm transition-[border-color,background-color] duration-300 hover:border-[rgba(212,175,55,0.45)] hover:bg-[#1A1A1A]"
                >
                  Open app
                </Link>
              </div>
            </Reveal>
          </div>
          <Reveal delay={120}>
            <div className="relative mx-auto w-full max-w-md md:mx-0">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-[#D4AF37]/12 via-transparent to-transparent blur-2xl" />
              <div className="relative overflow-hidden rounded-3xl border border-[rgba(237,237,237,0.08)] bg-[#1A1A1A]/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#9CA3AF]">
                      Live posture
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-[#EDEDED]">
                      Aligned
                    </p>
                  </div>
                  <span className="rounded-full border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.08)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
                    Stable
                  </span>
                </div>
                <div className="mt-8 space-y-3">
                  {["Signals reconciled", "Decision captured", "Execution linked"].map(
                    (row, i) => (
                      <div
                        key={row}
                        className="flex items-center justify-between rounded-xl border border-[rgba(237,237,237,0.06)] bg-[#0A0A0A]/60 px-4 py-3 text-sm text-[#EDEDED]"
                      >
                        <span>{row}</span>
                        <span className="text-[#3FAD6C]">
                          {i === 0 ? "●" : i === 1 ? "●" : "○"}
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <p className="mt-6 text-xs leading-relaxed text-[#9CA3AF]">
                  The ledger stays the source of truth—chat and automation plug
                  in, they do not replace policy.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        <section
          id="pillars"
          className="scroll-mt-24 border-t border-[rgba(237,237,237,0.06)] bg-[#0A0A0A]/80 py-20 md:py-28"
        >
          <div className="mx-auto max-w-6xl px-6 md:px-8">
            <Reveal>
              <div className="max-w-2xl">
                <h2 className="text-xs font-semibold uppercase tracking-[0.35em] text-[#D4AF37]">
                  Core pillars
                </h2>
                <p className="mt-4 text-3xl font-bold tracking-tight text-[#EDEDED] md:text-4xl">
                  Built for leaders who value clarity over hype.
                </p>
              </div>
            </Reveal>
            <div className="mt-14 grid gap-8 md:grid-cols-3 md:gap-10">
              {pillarCopy.map((p, i) => (
                <Reveal key={p.title} delay={i * 80}>
                  <article className="group h-full rounded-2xl border border-[rgba(237,237,237,0.07)] bg-[#1A1A1A]/70 p-8 shadow-[0_16px_48px_rgba(0,0,0,0.35)] transition-[border-color,transform] duration-500 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.25)]">
                    <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] text-[#D4AF37]">
                      <span className="text-xs font-bold tabular-nums">
                        0{i + 1}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold uppercase tracking-[0.18em] text-[#EDEDED]">
                      {p.title}
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-[#9CA3AF]">
                      {p.body}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section
          id="flow"
          className="scroll-mt-24 border-t border-[rgba(237,237,237,0.06)] py-20 md:py-28"
        >
          <div className="mx-auto max-w-6xl px-6 md:px-8">
            <Reveal>
              <h2 className="text-xs font-semibold uppercase tracking-[0.35em] text-[#D4AF37]">
                From inputs to outcomes
              </h2>
              <p className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-[#EDEDED] md:text-4xl">
                A single visual language for how work actually moves.
              </p>
            </Reveal>
            <div className="mt-16">
              <FlowGraphic />
            </div>
          </div>
        </section>

        <section
          id="cta"
          className="scroll-mt-24 border-t border-[rgba(237,237,237,0.06)] bg-gradient-to-b from-[#0A0A0A] to-[#111]/90 py-20 md:py-28"
        >
          <div className="mx-auto max-w-4xl px-6 text-center md:px-8">
            <Reveal>
              <h2 className="text-balance text-3xl font-bold tracking-tight text-[#EDEDED] md:text-4xl">
                Ready for direction you can defend?
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-[#9CA3AF]">
                Start with the Mission Control view—summaries, decisions, and
                commitments in one calm surface.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-[#D4AF37] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-[#0A0A0A] transition-[background-color,transform,box-shadow] duration-300 hover:bg-[#A88F2A] hover:shadow-[0_0_36px_rgba(212,175,55,0.3)] active:scale-[0.98]"
                >
                  Create account
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full border border-[rgba(237,237,237,0.16)] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-[#EDEDED] transition-[border-color,color] duration-300 hover:border-[rgba(212,175,55,0.5)] hover:text-[#D4AF37]"
                >
                  I already have access
                </Link>
              </div>
              <p className="mt-14 text-[11px] font-semibold uppercase tracking-[0.55em] text-[#9CA3AF]">
                Decide. Align. Execute.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[rgba(237,237,237,0.06)] bg-[#0A0A0A] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 text-sm text-[#9CA3AF] md:flex-row md:px-8">
          <div className="flex items-center gap-3">
            <LogoMark className="h-8 w-8 opacity-90" />
            <span className="font-semibold uppercase tracking-[0.28em] text-[#EDEDED]">
              Hustronix
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Link href="/mission-control" className="hover:text-[#EDEDED]">
              Mission Control
            </Link>
            <Link href="/chat" className="hover:text-[#EDEDED]">
              Chat
            </Link>
            <Link href="/settings" className="hover:text-[#EDEDED]">
              Settings
            </Link>
          </div>
          <p className="text-xs text-[#9CA3AF]/90">
            © {new Date().getFullYear()} Hustronix. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
