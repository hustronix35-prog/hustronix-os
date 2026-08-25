"use client";

import Link from "next/link";
import { ChevronLeft } from "@/components/icons";
import type { ReactNode } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import pageStyles from "@/app/pages.module.css";
import styles from "../settings.module.css";

export function SettingsShell({
  title,
  subtitle,
  children,
  action,
  showBack = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  showBack?: boolean;
}) {
  return (
    <AppShell topBar={<TopBar title={title} subtitle={subtitle} />}>
      <div className={styles.page}>
        {(showBack || action) && (
          <div className={styles.sectionToolbar}>
            {showBack ? (
              <Link href="/settings" className={styles.backLink}>
                <ChevronLeft size={16} />
                Settings
              </Link>
            ) : (
              <span />
            )}
            {action ? <div className={styles.toolbarRight}>{action}</div> : null}
          </div>
        )}
        {children}
      </div>
    </AppShell>
  );
}

export function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      data-on={on ? "true" : "false"}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
    >
      <i />
    </button>
  );
}

export function SaveButton({
  onClick,
  label = "Save changes",
  disabled,
  busy,
}: {
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button type="button" className={pageStyles.primaryBtn} onClick={onClick} disabled={disabled || busy}>
      {busy ? "Saving…" : label}
    </button>
  );
}

export function PrimaryAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={pageStyles.primaryBtn} onClick={onClick}>
      {children}
    </button>
  );
}
