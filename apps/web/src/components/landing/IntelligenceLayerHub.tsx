"use client";

import type { ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Calendar,
  FileSearch,
  LineChart,
  Mail,
  MessageSquare,
  ShieldCheck,
  TriangleAlert,
  User,
} from "lucide-react";
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

const INPUTS: { label: string; Icon: ComponentType<{ className?: string }>; color?: string }[] =
  [
    { label: "Slack", Icon: MessageSquare, color: "text-[#E01E5A]" },
    { label: "Jira", Icon: JiraMark },
    { label: "GitHub", Icon: GitHubMark, color: "text-hx-text" },
    { label: "Meetings", Icon: Calendar, color: "text-landing-accent-blue" },
    { label: "CRM", Icon: User, color: "text-landing-accent-blue" },
    { label: "Email", Icon: Mail, color: "text-hx-muted" },
  ];

const OUTPUTS = [
  { label: "Strategic alignment", Icon: ShieldCheck },
  { label: "Execution drift", Icon: TriangleAlert },
  { label: "Operational insights", Icon: LineChart },
  { label: "Audit & traceability", Icon: FileSearch },
] as const;

function NodePill({
  label,
  Icon,
  color,
  side,
  delay,
}: {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  color?: string;
  side: "in" | "out";
  delay: number;
}) {
  const reduce = useReducedMotion();
  const content = (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#0c0c0c]/95 px-3 py-2.5 text-xs font-medium text-hx-text/90 shadow-lg backdrop-blur-sm",
        side === "out" && "border-landing-gold/20",
      )}
    >
      <Icon className={cn("size-4 shrink-0", color ?? "text-landing-gold/90")} />
      <span className="leading-tight">{label}</span>
    </div>
  );

  if (reduce) return content;

  return (
    <motion.div
      initial={{ opacity: 0, x: side === "in" ? -16 : 16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.03 }}
    >
      {content}
    </motion.div>
  );
}

export function IntelligenceLayerHub({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("relative w-full", className)}
      aria-label="Operational intelligence layer: enterprise signals flow in; alignment intelligence flows out."
    >
      <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4 lg:gap-6">
        <motion.div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-landing-gold">
            Inputs
          </p>
          <p className="mb-4 text-xs text-hx-muted/75">Signals from across enterprise systems</p>
          {INPUTS.map((node, i) => (
            <NodePill key={node.label} {...node} side="in" delay={i * 0.06} />
          ))}
        </motion.div>

        <div className="relative flex justify-center py-4 md:py-0">
          <svg
            className="pointer-events-none absolute inset-0 hidden size-full md:block"
            viewBox="0 0 120 320"
            preserveAspectRatio="none"
            aria-hidden
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <line
                key={`in-${i}`}
                x1="0"
                y1={28 + i * 52}
                x2="60"
                y2="160"
                stroke="rgba(198,168,90,0.25)"
                strokeWidth="1"
                strokeDasharray="4 4"
                className={reduce ? undefined : "landing-hub-line-in"}
                style={reduce ? undefined : { animationDelay: `${i * 0.15}s` }}
              />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <line
                key={`out-${i}`}
                x1="60"
                y1="160"
                x2="120"
                y2={48 + i * 68}
                stroke="rgba(198,168,90,0.35)"
                strokeWidth="1"
                strokeDasharray="4 4"
                className={reduce ? undefined : "landing-hub-line-out"}
                style={reduce ? undefined : { animationDelay: `${0.4 + i * 0.12}s` }}
              />
            ))}
          </svg>

          <motion.div
            className={cn(
              "relative z-10 flex size-36 flex-col items-center justify-center rounded-full border border-dashed border-landing-gold/50 bg-[#0A0A0A]/95 px-4 text-center shadow-[0_0_64px_rgba(198,168,90,0.15)] sm:h-40 sm:w-40",
              !reduce && "landing-hub-pulse",
            )}
            initial={reduce ? false : { scale: 0.9, opacity: 0 }}
            whileInView={reduce ? undefined : { scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.15 }}
          >
            <div className="mb-2 size-8 rounded-lg border border-landing-gold/30 bg-landing-gold/10" aria-hidden>
              <div className="mx-auto mt-1.5 size-4 rotate-45 border border-landing-gold/60" />
            </div>
            <p className="text-[11px] font-semibold leading-tight text-hx-text sm:text-xs">
              Operational
              <br />
              Intelligence Layer
            </p>
          </motion.div>
        </div>

        <motion.div className="space-y-2.5 md:text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-landing-gold">
            Outputs
          </p>
          <p className="mb-4 text-xs text-hx-muted/75">Live intelligence for aligned execution</p>
          {OUTPUTS.map((node, i) => (
            <div key={node.label} className="md:flex md:justify-end">
              <NodePill {...node} side="out" delay={0.2 + i * 0.06} />
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
