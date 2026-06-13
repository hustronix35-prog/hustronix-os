"use client";

import type { ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Calendar, Mail, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/cn";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.12-1.5-1.12-1.5-.92-.64.07-.63.07-.63 1.02.07 1.55 1.06 1.55 1.06.9 1.56 2.36 1.11 2.94.85.09-.67.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.32.1-2.74 0 0 .84-.27 2.75 1.02A9.3 9.3 0 0 1 12 6.84c.85.004 1.71.12 2.51.35 1.91-1.29 2.75-1.02 2.75-1.02.55 1.42.2 2.48.1 2.74.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  );
}

function JiraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 3 21 12l-9 9-9-9 9-9Z" fill="#2684FF" />
    </svg>
  );
}

type ToolNode = {
  id: string;
  title: string;
  Icon: ComponentType<{ className?: string }>;
  iconClass?: string;
  lines: readonly string[];
  highlightLine?: number;
  mono?: boolean;
  gridArea: string;
};

const TOOLS: ToolNode[] = [
  {
    id: "slack",
    title: "Slack",
    Icon: MessageSquare,
    iconClass: "text-[#E01E5A]",
    lines: ["#product-updates", "Can we ship Friday?"],
    gridArea: "slack",
  },
  {
    id: "jira",
    title: "Jira",
    Icon: JiraMark,
    lines: ["TASK-1287", "TASK-1288", "TASK-1289"],
    highlightLine: 1,
    gridArea: "jira",
  },
  {
    id: "github",
    title: "GitHub",
    Icon: GitHubMark,
    iconClass: "text-hx-text",
    lines: ["git commit", "a1b2c3d", "d4e5f6g"],
    mono: true,
    gridArea: "github",
  },
  {
    id: "crm",
    title: "CRM",
    Icon: User,
    iconClass: "text-landing-accent-blue",
    lines: ["Deal Update", "Stage: Negotiation"],
    gridArea: "crm",
  },
  {
    id: "meetings",
    title: "Meetings",
    Icon: Calendar,
    iconClass: "text-landing-accent-blue",
    lines: ["Q2 Planning", "Strategy Update"],
    gridArea: "meetings",
  },
  {
    id: "email",
    title: "Email",
    Icon: Mail,
    iconClass: "text-hx-muted",
    lines: ["Re: Update", "Following up…"],
    gridArea: "email",
  },
];

const ARROW_PATHS = [
  { d: "M 52 28 Q 100 48 140 72", delay: 0 },
  { d: "M 248 28 Q 200 48 160 72", delay: 0.12 },
  { d: "M 28 100 Q 80 88 140 72", delay: 0.24 },
  { d: "M 272 100 Q 220 88 160 72", delay: 0.36 },
  { d: "M 52 172 Q 100 152 140 128", delay: 0.48 },
  { d: "M 248 172 Q 200 152 160 128", delay: 0.6 },
] as const;

function ToolCard({
  title,
  Icon,
  iconClass,
  lines,
  highlightLine,
  mono,
  delay = 0,
}: {
  title: string;
  Icon: ComponentType<{ className?: string }>;
  iconClass?: string;
  lines: readonly string[];
  highlightLine?: number;
  mono?: boolean;
  delay?: number;
}) {
  const reduce = useReducedMotion();

  const inner = (
    <div className="w-full max-w-[156px] justify-self-center rounded-xl border border-white/[0.09] bg-[#141414]/95 px-3 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:px-3.5 sm:py-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", iconClass)} />
        <span className="text-[11px] font-semibold text-hx-text/90">{title}</span>
      </div>
      <div className="mt-2 space-y-1">
        {lines.map((line, i) => (
          <div
            key={line}
            className={cn(
              "flex items-center gap-1.5 text-[9px] leading-tight sm:text-[10px]",
              mono ? "font-mono text-hx-muted/75" : "text-hx-muted/65",
            )}
          >
            {highlightLine === i && (
              <span
                className="h-1.5 w-1 shrink-0 rounded-full bg-landing-gold"
                aria-hidden
              />
            )}
            <span className="truncate">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (reduce) return inner;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
    >
      {inner}
    </motion.div>
  );
}

function ChaosCore({ animated }: { animated?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex h-[96px] w-[96px] items-center justify-center rounded-full border border-dashed border-white/35 sm:h-[108px] sm:w-[108px]",
        animated && "landing-hub-pulse",
      )}
    >
      <svg
        viewBox="0 0 100 100"
        className="size-[72%] text-white/75"
        aria-hidden
      >
        <path
          d="M12 48 C28 18 42 82 58 38 S78 72 88 52"
          stroke="currentColor"
          strokeWidth="1.1"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M18 62 C34 42 48 78 64 48 S82 58 90 68"
          stroke="currentColor"
          strokeWidth="0.9"
          fill="none"
          opacity="0.55"
        />
        <path
          d="M22 28 C38 58 52 22 68 58 S86 32 92 42"
          stroke="currentColor"
          strokeWidth="0.85"
          fill="none"
          opacity="0.45"
        />
        <path
          d="M8 72 C24 88 40 52 56 78 S76 62 94 82"
          stroke="currentColor"
          strokeWidth="0.75"
          fill="none"
          opacity="0.4"
        />
      </svg>
    </div>
  );
}

/** Hub-and-spoke: tools feed a tangled center → decisions lost */
export function SignalChaosHub({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div
      className={cn("relative mx-auto w-full max-w-[520px]", className)}
      aria-label="Signals from Slack, Jira, GitHub, CRM, meetings, and email converge into noise. Decisions get lost and execution drifts."
    >
      <div className="relative min-h-[220px] w-full sm:min-h-[240px]">
        <svg
          className="pointer-events-none absolute inset-0 z-0 size-full"
          viewBox="0 0 300 200"
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          aria-hidden
        >
          <defs>
            <marker
              id="chaos-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0 0 L6 3 L0 6 Z" fill="rgba(255,255,255,0.35)" />
            </marker>
          </defs>
          {ARROW_PATHS.map(({ d, delay }) => (
            <path
              key={d}
              d={d}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="1.2"
              strokeDasharray="5 5"
              markerEnd="url(#chaos-arrow)"
              className={reduce ? undefined : "landing-chaos-arrow"}
              style={reduce ? undefined : { animationDelay: `${delay}s` }}
            />
          ))}
          <path
            d="M 150 100 L 150 138"
            stroke="rgba(255,255,255,0.32)"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            markerEnd="url(#chaos-arrow)"
            className={reduce ? undefined : "landing-chaos-arrow"}
            style={reduce ? undefined : { animationDelay: "0.72s" }}
          />
        </svg>

        <div
          className="relative z-10 grid w-full gap-3 sm:gap-4"
          style={{
            gridTemplateColumns: "1fr auto 1fr",
            gridTemplateRows: "auto auto auto",
            gridTemplateAreas: `
              "slack . jira"
              "github hub crm"
              "meetings . email"
            `,
          }}
        >
          {TOOLS.map((tool, i) => (
            <div
              key={tool.id}
              style={{ gridArea: tool.gridArea }}
              className="flex items-center justify-center"
            >
              <ToolCard
                title={tool.title}
                Icon={tool.Icon}
                iconClass={tool.iconClass}
                lines={tool.lines}
                highlightLine={tool.highlightLine}
                mono={tool.mono}
                delay={i * 0.07}
              />
            </div>
          ))}

          <div className="flex items-center justify-center" style={{ gridArea: "hub" }}>
            {reduce ? (
              <ChaosCore />
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: 0.2 }}
              >
                <ChaosCore animated />
              </motion.div>
            )}
          </div>
        </div>
      </div>

      <motion.div
        className={cn(
          "relative z-20 mx-auto mt-8 max-w-md px-2 text-center",
          !reduce && "landing-chaos-outcome",
        )}
        initial={reduce ? false : { opacity: 0, y: 16 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.35 }}
      >
        <div className="mx-auto mb-3 flex size-9 items-center justify-center" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-8">
            <path
              d="M12 3 22 21H2L12 3Z"
              fill="#E8C547"
              stroke="#E8C547"
              strokeWidth="0.5"
            />
            <path
              d="M12 9v5M12 17h.01"
              stroke="#0A0A0A"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="rounded-xl border border-landing-gold/55 bg-[#0A0A0A]/90 px-5 py-4 shadow-[0_0_48px_rgba(198,168,90,0.12)] sm:px-6 sm:py-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-landing-gold sm:text-base">
            Decisions get lost. Execution drifts.
          </p>
          <p className="mt-2 text-xs text-hx-muted/85 sm:text-sm">
            Alignment gap widens every day.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
