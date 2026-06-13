"use client";

import { BookOpen, ChevronDown, Map, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { AssistantDrawerTab } from "@/components/assistant/assistant-drawer-types";
import { cn } from "@/lib/cn";

type Props = {
  assistantOpen: boolean;
  onOpenDrawer: (tab: AssistantDrawerTab) => void;
};

export function AssistantLaunchControl({ assistantOpen, onOpenDrawer }: Props) {
  const { push } = useRouter();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const shellClass = cn(
    "hx-assistant-shell inline-flex h-8 shrink-0 overflow-hidden rounded-md border border-hx-accent/50 bg-gradient-to-b from-hx-accent/15 to-transparent",
    "focus-within:ring-2 focus-within:ring-hx-accent/40 focus-within:ring-offset-2 focus-within:ring-offset-[var(--hx-bg)]",
  );

  return (
    <div ref={wrapRef} className={cn("relative", shellClass)} data-tour="assistant-button">
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-hx-accent transition",
          "hover:from-hx-accent/25 hover:text-hx-accent",
        )}
        onClick={() => onOpenDrawer("assistant")}
        aria-expanded={assistantOpen}
        aria-haspopup="dialog"
      >
        <Sparkles className="size-3.5" aria-hidden />
        AI Assistant
      </button>
      <span className="w-px self-stretch bg-hx-accent/25" aria-hidden />
      <button
        type="button"
        className={cn(
          "inline-flex items-center justify-center px-2 py-1.5 text-hx-accent transition",
          "hover:bg-hx-accent/10",
          menuOpen && "bg-hx-accent/15",
        )}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label="Help menu: tour and guide"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <ChevronDown
          className={cn("size-3.5 opacity-80 transition", menuOpen && "rotate-180")}
          aria-hidden
        />
      </button>

      {menuOpen && (
        <div
          id={menuId}
          role="menu"
          className="hx-surface-popover absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[13.5rem] overflow-hidden rounded-xl border border-hx-border bg-hx-surface p-1 ring-1 ring-[var(--hx-card-ring)]"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-hx-text transition hover:bg-hx-surface-elevated"
            onClick={() => {
              setMenuOpen(false);
              onOpenDrawer("tour");
            }}
          >
            <Map className="size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <span className="block font-medium">Interactive tour</span>
              <span className="block text-[11px] text-hx-muted">Step through each screen</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-hx-text transition hover:bg-hx-surface-elevated"
            onClick={() => {
              setMenuOpen(false);
              push("/guide");
            }}
          >
            <BookOpen className="size-4 shrink-0 text-hx-accent" aria-hidden />
            <span>
              <span className="block font-medium">Full guide page</span>
              <span className="block text-[11px] text-hx-muted">Chapters, workflows & tips</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-hx-text transition hover:bg-hx-surface-elevated"
            onClick={() => {
              setMenuOpen(false);
              onOpenDrawer("guide");
            }}
          >
            <BookOpen className="size-4 shrink-0 text-hx-muted" aria-hidden />
            <span>
              <span className="block font-medium">Guide in panel</span>
              <span className="block text-[11px] text-hx-muted">Browse without leaving the page</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
