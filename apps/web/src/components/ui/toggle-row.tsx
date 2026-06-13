"use client";

import { cn } from "@/lib/cn";
import { useState } from "react";

export function ToggleRow({
  title,
  description,
  defaultOn = true,
  on,
  onChange,
}: {
  title: string;
  description?: string;
  defaultOn?: boolean;
  on?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const [internal, setInternal] = useState(defaultOn);
  const controlled = on !== undefined;
  const isOn = controlled ? Boolean(on) : internal;

  function toggle() {
    const next = !isOn;
    if (controlled) onChange?.(next);
    else setInternal(next);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-hx-border py-4 last:border-0">
      <div>
        <div className="font-medium text-hx-text">{title}</div>
        {description && (
          <p className="mt-0.5 text-sm text-hx-muted">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        onClick={toggle}
        className={cn(
          "hx-switch group relative h-7 w-11 shrink-0 rounded-full border p-0.5",
          "transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hx-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-hx-bg",
          "active:scale-[0.97]",
          isOn
            ? "border-hx-accent/45 bg-gradient-to-b from-hx-accent/28 via-hx-accent/14 to-hx-accent/6"
            : "border-hx-border/90 bg-gradient-to-b from-hx-surface-elevated to-hx-surface hover:border-hx-border",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "hx-switch-thumb pointer-events-none block h-[1.125rem] w-[1.125rem] rounded-full",
            "transition-[transform,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.35,0.64,1)]",
            "group-active:scale-95",
            isOn
              ? "hx-switch-thumb-on translate-x-[1.375rem] bg-gradient-to-b from-hx-accent-bright via-hx-accent to-hx-accent-muted"
              : "translate-x-0 bg-gradient-to-b from-white/90 to-hx-muted/90",
          )}
        />
      </button>
    </div>
  );
}