"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Dense padding for hero preview panels (fits 16/10 frame). */
export function HeroPanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5 sm:p-2 md:p-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

type HeroPageHeaderProps = {
  title: string;
  subtitle: string;
  /** Visual variant aligned with each dashboard route. */
  variant?: "mission" | "execute" | "signals" | "chat";
  trailing?: ReactNode;
};

export function HeroPageHeader({
  title,
  subtitle,
  variant = "mission",
  trailing,
}: HeroPageHeaderProps) {
  const isChat = variant === "chat";

  return (
    <div
      data-hero-page-header
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-hx-border",
        variant === "execute" && "bg-hx-surface-elevated/15",
        variant === "signals" && "bg-[#0d0d0d]/80",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-[1]",
          isChat
            ? "bg-gradient-to-b from-hx-bg/90 to-hx-bg"
            : "bg-gradient-to-r from-hx-bg via-hx-bg/95 to-hx-bg/70",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "relative z-[2] flex flex-wrap items-start justify-between gap-2",
          isChat ? "px-2.5 py-2 md:px-3" : "px-2.5 py-2 md:px-3 md:py-2.5",
        )}
      >
        <div className="min-w-0 flex-1">
          <p
            data-hero-page-title
            className={cn(
              "font-semibold uppercase tracking-[0.22em] text-hx-accent md:tracking-[0.28em]",
              isChat
                ? "text-[10px] normal-case tracking-wide text-hx-text md:text-[11px]"
                : "text-[8px] md:text-[9px]",
            )}
          >
            {title}
          </p>
          <p
            data-hero-page-subtitle
            className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-hx-muted md:text-[9px]"
          >
            {subtitle}
          </p>
        </div>
        {trailing ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
}
