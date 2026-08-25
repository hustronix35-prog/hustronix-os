"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { Panel, PanelHeader, ProgressBar, StatusPill } from "@/components/ui/Primitives";
import { fetchOrgIntelligence, type OrgPersonCard } from "@/lib/api";
import styles from "../../pages.module.css";

export default function TeamMemberPage() {
  const params = useParams<{ owner: string }>();
  const owner = decodeURIComponent(String(params.owner || ""));
  const [person, setPerson] = useState<OrgPersonCard | null | undefined>(undefined);

  useEffect(() => {
    fetchOrgIntelligence().then((org) => {
      const hit = org?.people.find((p) => p.owner === owner || p.name === owner) ?? null;
      setPerson(hit);
    });
  }, [owner]);

  return (
    <AppShell
      topBar={
        <TopBar
          title={person?.name || owner}
          subtitle={person ? `${person.team} · ${person.role}` : "Execution owner"}
        />
      }
    >
      {person === undefined ? (
        <p className={styles.emptyHint}>Loading owner…</p>
      ) : !person ? (
        <p className={styles.emptyHint}>No roster or ledger row for this owner yet.</p>
      ) : (
        <div className={styles.consoleGrid}>
          <div className={styles.stack}>
            <Panel>
              <PanelHeader title="Hustronix assessment" />
              <p className={styles.consoleVow}>
                {person.blocked
                  ? `${person.name} is on the critical path: ${person.blocked} blocked item${person.blocked === 1 ? "" : "s"} and load at ${person.loadPct}%.`
                  : person.loadPct >= 85
                    ? `${person.name} is near capacity (${person.loadPct}%). Watch new assignments.`
                    : `${person.name} is healthy at ${person.loadPct}% load.`}
              </p>
              <ProgressBar
                value={person.loadPct}
                tone={person.loadPct >= 100 ? "red" : person.loadPct >= 85 ? "orange" : "green"}
              />
              <p className={styles.mutedLabel}>Current load</p>
            </Panel>
            <Panel>
              <PanelHeader title="Current work" />
              <ul className={styles.listPlain}>
                {person.focus.length ? (
                  person.focus.map((f) => (
                    <li key={f}>
                      <strong>{f}</strong>
                    </li>
                  ))
                ) : (
                  <p className={styles.emptyHint}>No active decision linked.</p>
                )}
              </ul>
            </Panel>
          </div>
          <aside className={styles.consoleRail}>
            <Panel>
              <PanelHeader title="Dependencies" />
              <p className={styles.mutedLabel}>Waiting on</p>
              {person.waitingOn.length ? (
                <ul className={styles.listPlain}>
                  {person.waitingOn.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p>Nothing recorded.</p>
              )}
              <p className={styles.mutedLabel}>Blocking</p>
              {person.blocking.length ? (
                <ul className={styles.listPlain}>
                  {person.blocking.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p>Not blocking downstream work.</p>
              )}
            </Panel>
            <Panel>
              <PanelHeader title="Decisions" />
              <p>
                {person.focus.length} linked item{person.focus.length === 1 ? "" : "s"}
              </p>
              <Link href="/chat" className={styles.link}>
                Ask Chat to resolve
              </Link>
              <Link href="/execute" className={styles.link}>
                Open Tasks
              </Link>
            </Panel>
            <Panel>
              <PanelHeader title="Load mix" />
              <p>
                <StatusPill label={person.status} /> {person.active} active · {person.pending} pending ·{" "}
                {person.blocked} blocked
              </p>
            </Panel>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
