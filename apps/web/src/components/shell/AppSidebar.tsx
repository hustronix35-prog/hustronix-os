"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart2,
  LayoutDashboard,
  MessageSquare,
  Settings,
  User,
  Users,
  Zap,
} from "lucide-react";
import { BroadcastIcon } from "@/components/icons/brand-icons";
import { cn } from "@/lib/cn";
import { apiGet } from "@/lib/api";
import { HustrionixSidebarLockup } from "./HustrionixSidebarLockup";
import { SidebarUserMenu } from "./SidebarUserMenu";

const nav = [
  { href: "/mission-control", label: "Mission Control", icon: LayoutDashboard, tour: "nav-mission-control" },
  { href: "/execute", label: "Execute", icon: Zap, tour: "nav-execute" },
  { href: "/signals", label: "Signals", icon: BroadcastIcon, tour: "nav-signals" },
  { href: "/chat", label: "Chat", icon: MessageSquare, tour: "nav-chat" },
  { href: "/reports", label: "Reports", icon: BarChart2, tour: "nav-reports" },
  { href: "/teams", label: "Teams", icon: Users, tour: "nav-teams" },
  { href: "/settings", label: "Settings", icon: Settings, tour: "nav-settings" },
  { href: "/profile", label: "Profile", icon: User, tour: "nav-profile" },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOrg() {
      try {
        const data = await apiGet<{ settings: Record<string, string> }>("/api/settings");
        if (cancelled) return;
        const name = data.settings?.["org.name"]?.trim();
        setWorkspaceLabel(name || null);
      } catch {
        if (!cancelled) setWorkspaceLabel(null);
      }
    }
    void loadOrg();
    const onSaved = () => void loadOrg();
    window.addEventListener("hx-settings-saved", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("hx-settings-saved", onSaved);
    };
  }, []);

  return (
    <aside className="hx-sidebar-panel sticky top-0 flex h-dvh w-[240px] shrink-0 flex-col border-r border-hx-border/90 bg-gradient-to-b from-hx-sidebar via-hx-sidebar to-hx-bg/90">
      <div className="shrink-0 border-b border-hx-border/80 p-3">
        <Link
          href="/mission-control"
          className="group block rounded-xl outline-none ring-hx-accent/30 transition hover:bg-hx-surface-elevated/35 focus-visible:ring-2"
        >
          <HustrionixSidebarLockup />
        </Link>

        {workspaceLabel ? (
          <div className="mt-3 border-t border-hx-border/60 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-hx-muted">
              Workspace
            </p>
            <p
              className="mt-1.5 truncate text-sm font-semibold leading-snug text-hx-text"
              title={workspaceLabel}
            >
              {workspaceLabel}
            </p>
          </div>
        ) : null}
      </div>

      <nav
        className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2.5 py-3"
        aria-label="Main"
      >
        {nav.map(({ href, label, icon: Icon, tour }) => {
          const active =
            pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              data-tour={tour}
              className={cn(
                "group relative flex min-h-11 shrink-0 items-center gap-3 rounded-xl border border-transparent px-3 text-sm font-medium transition duration-200",
                active
                  ? "hx-nav-active border-l-[3px] border-l-hx-accent bg-gradient-to-r from-hx-accent/14 to-hx-accent/[0.04] text-hx-text shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "text-hx-muted hover:border-hx-border/80 hover:bg-hx-surface-elevated/50 hover:text-hx-text",
              )}
            >
              <Icon
                className={cn(
                  "size-5 shrink-0 transition-colors",
                  active ? "text-hx-accent" : "text-hx-muted group-hover:text-hx-text",
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-hx-border/80 bg-hx-sidebar/80 p-3 backdrop-blur-sm">
        <SidebarUserMenu />
      </div>
    </aside>
  );
}
