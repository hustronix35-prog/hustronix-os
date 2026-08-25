"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { FilterPills, StatusPill } from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import { fetchBrainSummary } from "@/lib/api";
import { tabsFromBrainCounts } from "@/lib/live-mappers";
import { entityTabs } from "@/lib/mock-data";
import styles from "../pages.module.css";

export function BrainEntityShell({
  active,
  newLabel,
  children,
}: {
  active: string;
  newLabel: string;
  children: ReactNode;
}) {
  const [tabs, setTabs] = useState(entityTabs.map((t) => ({ ...t, count: t.label === "All" ? null : 0 })));

  useEffect(() => {
    let cancelled = false;
    fetchBrainSummary().then((s) => {
      if (cancelled || !s) return;
      setTabs(tabsFromBrainCounts(s.counts));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      topBar={
        <TopBar
          title="Company Brain"
          subtitle="What Hustronix understands: people, initiatives, dependencies, and history."
          searchPlaceholder="Search anything in your company..."
        />
      }
    >
      <div className={styles.filterBar}>
        <FilterPills items={tabs} active={active} />
      </div>
      {children}
    </AppShell>
  );
}

export function StatusCell({ value }: { value: string }) {
  return <StatusPill label={value} />;
}

export function EmptyCatalog({ label }: { label: string }) {
  return <p className={styles.emptyHint}>No {label} on the ledger yet.</p>;
}

export { DataTable, styles };
