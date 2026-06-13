"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SegmentTabItem<T extends string = string> = {
  value: T;
  label: ReactNode;
};

type SegmentTabsProps<T extends string> = {
  items: readonly SegmentTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** compact = Execute-style max width; wide = full-width wrapping row (Settings / Profile). */
  layout?: "compact" | "wide";
  className?: string;
  "data-tour"?: string;
  ariaLabel?: string;
};

export function SegmentTabs<T extends string>({
  items,
  value,
  onChange,
  layout = "compact",
  className,
  "data-tour": dataTour,
  ariaLabel,
}: SegmentTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-tour={dataTour}
      className={cn(
        "hx-segment-track inline-flex gap-1 rounded-2xl border border-hx-border/80 bg-hx-surface/40 p-1",
        layout === "compact"
          ? "w-full max-w-xl flex-wrap sm:flex-nowrap"
          : "w-full flex-wrap",
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "rounded-xl px-3 py-2.5 text-center text-xs font-bold uppercase tracking-[0.08em] transition",
              layout === "compact"
                ? "min-w-[5.5rem] flex-1 sm:flex-initial sm:px-4"
                : "min-w-[4.5rem] flex-1 sm:min-w-0 sm:flex-initial sm:px-4",
              active
                ? "hx-segment-tab-active bg-gradient-to-b from-hx-surface-elevated to-hx-surface text-hx-accent"
                : "text-hx-muted hover:bg-hx-surface-elevated/50 hover:text-hx-text",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
