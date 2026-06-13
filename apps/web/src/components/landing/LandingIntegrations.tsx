"use client";

import { cn } from "@/lib/cn";

const INTEGRATIONS = [
  "Slack",
  "Linear",
  "Notion",
  "Jira",
  "GitHub",
  "Google Meet",
  "Gmail",
  "HubSpot",
] as const;

export function LandingIntegrations({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap justify-center gap-2.5 md:gap-3", className)}>
      {INTEGRATIONS.map((name) => (
        <span
          key={name}
          className="rounded-full border border-white/[0.1] bg-black/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-hx-muted/90 transition-colors hover:border-landing-gold/30 hover:text-hx-text"
        >
          {name}
        </span>
      ))}
    </div>
  );
}
