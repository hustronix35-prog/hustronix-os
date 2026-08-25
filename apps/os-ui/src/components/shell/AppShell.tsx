"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HustronixMark } from "@/components/brand/HustronixMark";
import {
  MessageSquare,
  Users,
  AlertTriangle,
  Bell,
  Brain,
  BarChart3,
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Scale,
  Home,
  ListChecks,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  User,
  X,
} from "@/components/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dropdown, useToast } from "@/components/ui/Interactions";
import { AiPanel } from "./AiPanel";
import { homeAlerts, composerForPath } from "@/lib/mock-data";
import { clearAuthSession, fetchMe, fetchNotifications, markAllNotificationsRead, type MeDto } from "@/lib/api";
import type { Alert } from "@/lib/types";
import { chatUrlForQuery } from "@/lib/chat-handoff";
import { AIComposer } from "@/components/ui/Primitives";
import { cx } from "@/lib/utils";
import styles from "./shell.module.css";

const primaryNav: Array<{
  label: string;
  href: string;
  icon: typeof Home;
  subtitle?: string;
  aliases?: string[];
  splitAfter?: boolean;
}> = [
  { label: "Talk to Hustronix", href: "/chat", icon: MessageSquare },
  { label: "Home", href: "/", icon: Home },
  { label: "Signals", href: "/signals", icon: Activity, aliases: ["/brain/signals"] },
  { label: "Company Brain", href: "/brain", icon: Brain },
  { label: "Decisions", href: "/decide", icon: Scale, aliases: ["/brain/decisions"] },
  { label: "Tasks", href: "/execute", icon: ListChecks, aliases: ["/tasks"] },
  { label: "Teams", href: "/team", icon: Users },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
];

function isActive(pathname: string, href: string, aliases: string[] = []) {
  if (href === "/") return pathname === "/";
  if (href === "/brain") {
    return (
      pathname === "/brain" ||
      (pathname.startsWith("/brain/") &&
        !pathname.startsWith("/brain/signals") &&
        !pathname.startsWith("/brain/decisions"))
    );
  }
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return aliases.some((a) => pathname === a || pathname.startsWith(`${a}/`));
}

function LogoLockup({ compact = false }: { compact?: boolean }) {
  if (!compact) {
    return (
      <Link href="/" className={styles.logo} aria-label="Hustronix Home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-lockup.png"
          alt="Hustronix — Decide. Align. Execute."
          className={styles.logoLockup}
          width={204}
          height={102}
        />
      </Link>
    );
  }

  return (
    <Link href="/" className={styles.logo} aria-label="Hustronix Home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-mark.png" alt="" className={styles.logoMark} width={40} height={40} />
    </Link>
  );
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "HX";
}

function ProfileMenu({
  trigger,
  email,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  email: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  return (
    <Dropdown
      trigger={trigger}
      items={[
        { type: "header", label: email },
        { type: "item", label: "Profile", icon: <User size={14} />, onSelect: () => router.push("/settings/profile") },
        { type: "item", label: "Settings", icon: <Settings size={14} />, onSelect: () => router.push("/settings") },
        { type: "separator" },
        {
          type: "item",
          label: "Sign out",
          icon: <LogOut size={14} />,
          tone: "danger",
          onSelect: () => {
            void (async () => {
              await clearAuthSession();
              toast("Signed out", { description: "Session ended." });
              router.replace("/login");
              router.refresh();
            })();
          },
        },
      ]}
    />
  );
}

function Sidebar({
  onNavigate,
  collapsed,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const [me, setMe] = useState<MeDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((row) => {
      if (!cancelled) setMe(row);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = me?.profile.displayName || me?.user.username || "Signed in";
  const role = me?.profile.role || me?.org.role || me?.org.name || "Workspace";
  const email = me?.profile.email || me?.user.email || me?.user.username || "Account";

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed ? "true" : "false"}>
      <LogoLockup compact={collapsed} />
      <nav className={styles.nav} aria-label="Primary">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href, item.aliases);
          return (
            <div key={item.href} className={item.splitAfter ? styles.navSplit : undefined}>
              <Link
                href={item.href}
                className={cx(styles.navItem, item.subtitle && styles.navItemTall, active && styles.navActive)}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={20} />
                {!collapsed ? (
                  <span className={styles.navCopy}>
                    <strong>{item.label}</strong>
                    {item.subtitle ? <small>{item.subtitle}</small> : null}
                  </span>
                ) : null}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={styles.sidebarFoot}>
        <Link
          href="/settings"
          className={cx(styles.navItem, isActive(pathname, "/settings") && styles.navActive)}
          aria-current={isActive(pathname, "/settings") ? "page" : undefined}
          onClick={onNavigate}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings size={20} />
          {!collapsed ? <span>Settings</span> : null}
        </Link>
        <Link
          href="/help"
          className={cx(styles.navItem, isActive(pathname, "/help") && styles.navActive)}
          aria-current={isActive(pathname, "/help") ? "page" : undefined}
          onClick={onNavigate}
          title={collapsed ? "Help" : undefined}
        >
          <CircleHelp size={20} />
          {!collapsed ? <span>Help</span> : null}
        </Link>
        <ProfileMenu
          email={email}
          trigger={({ toggle }) => (
            <button type="button" className={styles.profile} onClick={toggle}>
              <span className={styles.avatar}>{initialsFrom(me?.profile.displayName || me?.user.username || "HX")}</span>
              {!collapsed ? (
                <>
                  <span className={styles.profileText}>
                    <strong>{name}</strong>
                    <small>{role}</small>
                  </span>
                  <ChevronDown size={16} />
                </>
              ) : null}
            </button>
          )}
        />
        {onToggleCollapse ? (
          <button
            type="button"
            className={styles.collapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Alert[]>(homeAlerts.slice(0, 3));
  const [unread, setUnread] = useState(3);

  useEffect(() => {
    let cancelled = false;
    fetchNotifications(20).then((notifs) => {
      if (cancelled || !notifs) return;
      setItems(notifs.slice(0, 3));
      setUnread(notifs.filter((a) => a.unread).length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button type="button" className={styles.bell} aria-label="Notifications" onClick={toggle}>
          <Bell size={18} />
          {unread > 0 ? <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
        </button>
      )}
      items={[
        { type: "header", label: "Notifications" },
        ...(items.length
          ? items.map((a) => ({
              type: "item" as const,
              label: a.title,
              description: `${a.severity} · ${a.time}`,
              icon: <AlertTriangle size={14} />,
              tone: (a.severity === "Critical" || a.severity === "High" ? "danger" : "default") as "danger" | "default",
              onSelect: () => router.push("/alerts"),
            }))
          : [
              {
                type: "item" as const,
                label: "No notifications",
                description: "Ledger is quiet",
                icon: <Bell size={14} />,
                onSelect: () => router.push("/alerts"),
              },
            ]),
        { type: "separator" },
        {
          type: "item",
          label: "Mark all as read",
          icon: <CheckCircle2 size={14} />,
          onSelect: async () => {
            setUnread(0);
            await markAllNotificationsRead();
          },
        },
        { type: "item", label: "View all alerts", icon: <Bell size={14} />, onSelect: () => router.push("/alerts") },
      ]}
    />
  );
}

export function TopBar({
  title,
  subtitle,
  breadcrumb,
  trailing,
  titleIcon,
  searchPlaceholder = "Ask Hustronix anything...",
  showAsk = true,
  showSearch = true,
  askLabel = "Ask Hustronix",
  showUser = true,
}: {
  title?: string;
  subtitle?: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  trailing?: ReactNode;
  titleIcon?: ReactNode;
  searchPlaceholder?: string;
  showAsk?: boolean;
  showSearch?: boolean;
  askLabel?: string;
  showUser?: boolean;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [me, setMe] = useState<MeDto | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!showUser) return;
    let cancelled = false;
    fetchMe().then((row) => {
      if (!cancelled) setMe(row);
    });
    return () => {
      cancelled = true;
    };
  }, [showUser]);

  return (
    <header className={styles.topBar}>
      <div className={styles.titleBlock}>
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            {breadcrumb.map((crumb, i) => {
              const last = i === breadcrumb.length - 1;
              return (
                <span key={`${crumb.label}-${i}`} className={styles.breadcrumbItem}>
                  {i > 0 ? <span className={styles.breadcrumbSep} aria-hidden>
                    ›
                  </span> : null}
                  {crumb.href && !last ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
                  )}
                </span>
              );
            })}
          </nav>
        ) : null}
        {title || titleIcon ? (
          <div className={styles.titleHeading}>
            {titleIcon ? <span className={styles.titleIcon}>{titleIcon}</span> : null}
            {title ? <h1>{title}</h1> : null}
          </div>
        ) : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        {showSearch ? (
          <form
            className={styles.search}
            onSubmit={(e) => {
              e.preventDefault();
              const q = searchRef.current?.value.trim();
              if (!q) return;
              router.push(chatUrlForQuery(q));
              if (searchRef.current) searchRef.current.value = "";
            }}
          >
            <Search size={16} aria-hidden />
            <span className="sr-only">Search</span>
            <input ref={searchRef} placeholder={searchPlaceholder} />
            <kbd>⌘K</kbd>
          </form>
        ) : null}
        {trailing}
        {showAsk ? (
          <button type="button" className={styles.askBtn} onClick={() => setAiOpen(true)}>
            <HustronixMark size={18} />
            <span>{askLabel}</span>
          </button>
        ) : null}
        <NotificationBell />
        {showUser ? (
          <ProfileMenu
            email={me?.profile.email || me?.user.email || me?.user.username || "Account"}
            trigger={({ toggle }) => (
              <button type="button" className={styles.userMenu} onClick={toggle}>
                <span className={styles.avatar}>{initialsFrom(me?.profile.displayName || me?.user.username || "HX")}</span>
                <span>
                  <strong>{me?.profile.displayName || me?.user.username || "Signed in"}</strong>
                  <small>{me?.profile.role || me?.org.role || me?.org.name || "Workspace"}</small>
                </span>
                <ChevronDown size={16} />
              </button>
            )}
          />
        ) : null}
      </div>
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </header>
  );
}

export function AppShell({
  children,
  topBar,
}: {
  children: ReactNode;
  topBar: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const composer = composerForPath(pathname);

  return (
    <div className={styles.shell} data-collapsed={collapsed ? "true" : "false"}>
      <div className={cx(styles.sidebarDesktop)}>
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
      </div>
      {open ? (
        <div className={styles.drawer}>
          <button type="button" className={styles.drawerBackdrop} aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className={styles.drawerPanel}>
            <button type="button" className={styles.drawerClose} aria-label="Close" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
      <div className={styles.main}>
        <div className={styles.mobileBar}>
          <button type="button" className={styles.menuBtn} aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <LogoLockup compact />
        </div>
        {topBar}
        <div className={styles.content}>{children}</div>
        {pathname.startsWith("/chat") || pathname.startsWith("/team") ? null : (
          <AIComposer
            key={pathname}
            placeholder={composer.placeholder}
            prompts={composer.prompts}
          />
        )}
      </div>
    </div>
  );
}

export function StatusIcon({
  tone,
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.statusIcon} data-tone={tone}>
      {children}
    </span>
  );
}

