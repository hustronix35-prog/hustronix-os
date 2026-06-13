"use client";

import { Check, ChevronDown, LogOut, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { apiGet, apiPost } from "@/lib/api";

function initialsFrom(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 3);
  return name.slice(0, 2).toUpperCase() || "?";
}

export function SidebarUserMenu() {
  const { replace, refresh } = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const [label, setLabel] = useState<string>("Account");
  const [sub, setSub] = useState<string>("Signed in");
  const [initials, setInitials] = useState<string>("HX");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<{
          user?: { username?: string };
          profile?: { displayName?: string };
        }>("/api/me");
        if (cancelled) return;
        const dn = data.profile?.displayName || data.user?.username || "Account";
        const un = data.user?.username || "";
        setLabel(dn);
        setSub(un && un !== dn ? `@${un}` : "Signed in");
        setInitials(initialsFrom(dn));
      } catch {
        if (!cancelled) {
          setLabel("Account");
          setSub("Session");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Match SSR: undefined until ThemeProvider reads `data-theme` after mount. */
  const themeReady = resolvedTheme !== undefined;
  const isLight = themeReady && resolvedTheme === "light";

  return (
    <div className="relative" ref={rootRef} suppressHydrationWarning>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-md p-2 text-left text-sm transition hover:bg-hx-surface-elevated"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-hx-accent/20 text-xs font-bold text-hx-accent">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-hx-text">{label}</div>
          <div className="truncate text-xs text-hx-muted">{sub}</div>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-hx-muted transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute bottom-full left-0 right-0 z-[100] mb-2 rounded-lg border border-hx-border bg-hx-surface py-1 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
        >
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-hx-muted">
            Appearance
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={!themeReady}
            onClick={() => setTheme("light")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-hx-surface-elevated",
              isLight && "text-hx-accent",
            )}
          >
            <Sun className="size-4 shrink-0" />
            <span className="flex-1">Light mode</span>
            {isLight && <Check className="size-4 shrink-0 text-hx-accent" />}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!themeReady}
            onClick={() => setTheme("dark")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-hx-surface-elevated",
              themeReady && !isLight && "text-hx-accent",
            )}
          >
            <Moon className="size-4 shrink-0" />
            <span className="flex-1">Dark mode</span>
            {themeReady && !isLight && (
              <Check className="size-4 shrink-0 text-hx-accent" />
            )}
          </button>

          <div className="my-1 border-t border-hx-border" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void (async () => {
                try {
                  await apiPost("/api/auth/logout", {});
                } catch {
                  /* still navigate */
                }
                replace("/login");
                refresh();
              })();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-hx-danger transition hover:bg-hx-danger/10"
          >
            <LogOut className="size-4 shrink-0" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
