"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SectionTitle } from "./section-title";

export function InspectorPanel({
  label,
  children,
  onClose,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex w-full max-w-md shrink-0 flex-col border-l border-hx-border bg-hx-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hx-border px-4 py-2.5">
        <SectionTitle>{label}</SectionTitle>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-hx-muted hover:bg-hx-surface-elevated hover:text-hx-text"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  );
}
