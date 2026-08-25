"use client";

import { Search, Users } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { FilterPills, Panel, PanelHeader, ProgressBar, StatusPill } from "@/components/ui/Primitives";
import { buttonStyles } from "@/components/ui/Interactions";
import {
  createOrgDependency,
  fetchOrgIntelligence,
  type OrgIntelligence,
  type OrgPersonCard,
} from "@/lib/api";
import { formatWhen } from "@/lib/live-mappers";
import styles from "../pages.module.css";

const TABS = ["Overview", "People", "Teams", "Dependencies", "Workload", "Ownership", "Directory"] as const;
type Tab = (typeof TABS)[number];

function riskTone(p: OrgPersonCard): { label: string; tone: string } {
  if (p.workload === "High" || p.criticalPath || p.blocked >= 2) return { label: "High", tone: "critical" };
  if (p.status !== "Healthy" || p.blocked > 0) return { label: "Medium", tone: "high" };
  return { label: "Low", tone: "low" };
}

function depTone(status: string): "low" | "high" | "critical" {
  if (status === "ON_TRACK") return "low";
  if (status === "DELAYED") return "critical";
  return "high";
}

function depLabel(status: string) {
  if (status === "ON_TRACK") return "On Track";
  if (status === "DELAYED") return "Delayed";
  return "At Risk";
}

function workloadTone(band: string): string {
  if (band === "High") return "critical";
  if (band === "Medium") return "high";
  if (band === "Low") return "medium";
  return "low";
}

function healthBarTone(pct: number): "green" | "orange" | "red" {
  if (pct >= 80) return "green";
  if (pct >= 60) return "orange";
  return "red";
}

function deltaCopy(n: number, vs: string) {
  if (!n) return "No change";
  return `${n > 0 ? "Up" : "Down"} ${Math.abs(n)}% ${vs}`;
}

function matchesQuery(hay: string, q: string) {
  return !q || hay.toLowerCase().includes(q);
}

function OrgTree({
  nodes,
  critical,
  root = true,
}: {
  nodes: OrgIntelligence["tree"];
  critical: Set<string>;
  root?: boolean;
}) {
  if (!nodes.length) return <p className={styles.emptyHint}>No org structure yet.</p>;
  return (
    <ul className={styles.orgTree} data-root={root ? "true" : "false"}>
      {nodes.map((n) => (
        <li key={n.id}>
          <div className={styles.orgTreeNode} data-dep={critical.has(n.name) ? "critical" : undefined}>
            <strong>{n.name}</strong>
            <span>{n.peopleCount} people</span>
          </div>
          {n.children.length ? <OrgTree nodes={n.children} critical={critical} root={false} /> : null}
        </li>
      ))}
    </ul>
  );
}

function WorkloadDonut({
  high,
  medium,
  optimal,
  low,
}: {
  high: number;
  medium: number;
  optimal: number;
  low: number;
}) {
  const total = Math.max(1, high + medium + optimal + low);
  const r = 52;
  const c = 2 * Math.PI * r;
  const segs = [
    { n: high, color: "var(--status-critical)" },
    { n: medium, color: "var(--status-high)" },
    { n: optimal, color: "var(--status-low)" },
    { n: low, color: "var(--status-medium)" },
  ];
  let offset = 0;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Workload distribution">
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
      {segs.map((s, i) => {
        const len = (s.n / total) * c;
        const el = (
          <circle
            key={i}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
            strokeLinecap="butt"
          />
        );
        offset += len;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
        {high + medium + optimal + low}
      </text>
      <text x="70" y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
        people
      </text>
    </svg>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgIntelligence | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [query, setQuery] = useState("");
  const [fromTeam, setFromTeam] = useState("Finance");
  const [fromWork, setFromWork] = useState("");
  const [toTeam, setToTeam] = useState("Engineering");
  const [toWork, setToWork] = useState("");

  useEffect(() => {
    fetchOrgIntelligence().then((o) => {
      if (o) setOrg(o);
    });
  }, []);

  const q = query.trim().toLowerCase();
  const criticalTeams = useMemo(() => {
    const set = new Set<string>();
    for (const d of org?.dependencies ?? []) {
      if (d.status !== "ON_TRACK") {
        set.add(d.fromTeam);
        set.add(d.toTeam);
      }
    }
    return set;
  }, [org]);

  const people = useMemo(
    () =>
      (org?.people ?? []).filter((p) =>
        matchesQuery(`${p.name} ${p.team} ${p.role} ${p.email} ${p.focus.join(" ")}`, q),
      ),
    [org, q],
  );

  const addDep = async () => {
    if (!fromTeam.trim() || !toTeam.trim()) return;
    const next = await createOrgDependency({
      fromTeam: fromTeam.trim(),
      fromWork: fromWork.trim() || undefined,
      toTeam: toTeam.trim(),
      toWork: toWork.trim() || undefined,
      status: "ON_TRACK",
    });
    if (next) {
      setOrg(next);
      setFromWork("");
      setToWork("");
    }
  };

  const snap = org?.snapshot;
  const teamNames = (org?.teams ?? []).map((t) => t.name);

  return (
    <AppShell
      topBar={
        <TopBar
          title="Team"
          subtitle="Understand your organization. People, teams, ownership and dependencies."
          searchPlaceholder="Search people, teams, roles..."
        />
      }
    >
      <div className={styles.filterBar}>
        <FilterPills
          items={TABS.map((label) => ({ label }))}
          active={tab}
          onChange={(label) => setTab(label as Tab)}
        />
        <label className={styles.orgSearch}>
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, teams, roles..."
            aria-label="Search people, teams, roles"
          />
        </label>
      </div>

      {tab === "Overview" ? (
        <>
          <div className={styles.orgSnap}>
            <Panel className={styles.orgSnapTile}>
              <span>People</span>
              <strong>{snap?.people ?? 0}</strong>
              <small>On the roster and ledger</small>
            </Panel>
            <Panel className={styles.orgSnapTile}>
              <span>Teams</span>
              <strong>{snap?.teams ?? 0}</strong>
              <small>Named groups in the org map</small>
            </Panel>
            <Panel className={styles.orgSnapTile}>
              <span>Active initiatives</span>
              <strong>{snap?.initiatives ?? 0}</strong>
              <small>Decisions still in flight</small>
            </Panel>
            <Panel className={styles.orgSnapTile}>
              <span>Execution health</span>
              <strong>{snap?.healthPct ?? 0}%</strong>
              <small>{deltaCopy(snap?.healthDelta ?? 0, "vs last week")}</small>
            </Panel>
            <Panel className={`${styles.orgSnapTile} ${styles.orgSnapAlert}`}>
              <span>Alerts</span>
              <strong>{snap?.overloaded ?? 0} people overloaded</strong>
              <small>{snap?.depsAtRisk ?? 0} dependencies at risk</small>
            </Panel>
          </div>

          <div className={styles.orgMid}>
            <Panel>
              <PanelHeader title="Team health" subtitle="Workload and risk by group" />
              <table className={styles.orgHealthTable}>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Health</th>
                    <th>Workload</th>
                    <th>At risk</th>
                    <th>People</th>
                  </tr>
                </thead>
                <tbody>
                  {(org?.teams ?? [])
                    .filter((t) => t.peopleCount > 0 || ["Engineering", "Product", "Marketing", "Design", "Sales", "Finance", "Operations"].includes(t.name))
                    .map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>
                          <div className={styles.orgHealthMeter}>
                            <ProgressBar value={t.healthPct} tone={healthBarTone(t.healthPct)} />
                            <em>{t.healthPct}%</em>
                          </div>
                        </td>
                        <td>
                          <StatusPill label={t.workload} tone={workloadTone(t.workload)} />
                        </td>
                        <td>{t.atRisk}</td>
                        <td>
                          <div className={styles.orgAvatars}>
                            {t.members.map((m) => (
                              <span key={m.owner} className={styles.orgAvatar} title={m.name}>
                                {m.initials}
                              </span>
                            ))}
                            {!t.members.length ? <span className={styles.emptyHint}>None</span> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Panel>

            <Panel>
              <PanelHeader title="Org structure map" subtitle="Reporting lines, with execution dependencies overlaid" />
              <OrgTree nodes={org?.tree ?? []} critical={criticalTeams} />
              <ul className={styles.orgLegend}>
                <li>
                  <i data-kind="report" /> Direct reporting
                </li>
                <li>
                  <i data-kind="collab" /> Collaboration
                </li>
                <li>
                  <i data-kind="critical" /> Critical dependency
                </li>
              </ul>
            </Panel>

            <Panel>
              <PanelHeader title="People at risk" />
              <ul className={styles.orgRiskList}>
                {(org?.peopleAtRisk ?? []).length ? (
                  (org?.peopleAtRisk ?? []).map((p) => {
                    const risk = riskTone(p);
                    return (
                      <li key={p.owner}>
                        <Link href={`/team/${encodeURIComponent(p.owner)}`}>
                          <span className={styles.orgRiskHead}>
                            <strong>{p.name}</strong>
                            <StatusPill label={risk.label} tone={risk.tone} />
                          </span>
                          <span>
                            {p.role} · {p.team}
                          </span>
                          <span>
                            {p.workload} workload
                            {p.blocked ? ` · ${p.blocked} blockers` : ""}
                            {p.waitingOn[0] ? ` · ${p.waitingOn[0]}` : ""}
                            {p.criticalPath ? " · critical path" : ""}
                          </span>
                        </Link>
                      </li>
                    );
                  })
                ) : (
                  <p className={styles.emptyHint}>No overloaded or blocked owners.</p>
                )}
              </ul>
            </Panel>
          </div>

          <div className={styles.triple}>
            <Panel>
              <PanelHeader title="Critical dependencies" subtitle="Who waits on whom" />
              <ul className={styles.orgDepList}>
                {(org?.dependencies ?? []).length ? (
                  (org?.dependencies ?? []).slice(0, 6).map((d) => (
                    <li key={d.id}>
                      <strong>
                        {d.fromTeam}
                        {d.fromWork ? ` (${d.fromWork})` : ""} → {d.toTeam}
                        {d.toWork ? ` (${d.toWork})` : ""}
                      </strong>
                      <span>
                        <StatusPill label={depLabel(d.status)} tone={depTone(d.status)} /> {d.source}
                      </span>
                    </li>
                  ))
                ) : (
                  <p className={styles.emptyHint}>No cross-team dependencies on the ledger yet.</p>
                )}
              </ul>
            </Panel>
            <Panel>
              <PanelHeader title="Workload distribution" />
              <div className={styles.orgDonutWrap}>
                <WorkloadDonut
                  high={org?.workload.high ?? 0}
                  medium={org?.workload.medium ?? 0}
                  optimal={org?.workload.optimal ?? 0}
                  low={org?.workload.low ?? 0}
                />
                <div className={styles.orgDonutLegend}>
                  <div>
                    <b style={{ background: "var(--status-critical)" }} />
                    High {org?.workload.high ?? 0}
                  </div>
                  <div>
                    <b style={{ background: "var(--status-high)" }} />
                    Medium {org?.workload.medium ?? 0}
                  </div>
                  <div>
                    <b style={{ background: "var(--status-low)" }} />
                    Optimal {org?.workload.optimal ?? 0}
                  </div>
                  <div>
                    <b style={{ background: "var(--status-medium)" }} />
                    Low {org?.workload.low ?? 0}
                  </div>
                </div>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Recent changes" />
              <ul className={styles.orgChangeList}>
                {(org?.recentChanges ?? []).length ? (
                  (org?.recentChanges ?? []).map((e) => (
                    <li key={e.id}>
                      <strong>{e.summary}</strong>
                      <span>
                        {e.kind} · {formatWhen(e.createdAt)}
                      </span>
                    </li>
                  ))
                ) : (
                  <p className={styles.emptyHint}>No org movements recorded yet.</p>
                )}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}

      {tab === "People" ? (
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "team", label: "Team" },
            { key: "role", label: "Role" },
            { key: "load", label: "Load" },
            { key: "status", label: "Status" },
            { key: "blocked", label: "Blocked" },
          ]}
          rows={people.map((p) => ({
            name: p.name,
            team: p.team,
            role: p.role,
            load: `${p.loadPct}%`,
            status: p.status,
            blocked: String(p.blocked),
            href: `/team/${encodeURIComponent(p.owner)}`,
          }))}
          onRowClick={(row) => {
            if (row.href) router.push(row.href);
          }}
        />
      ) : null}

      {tab === "Teams" ? (
        <div className={styles.triple}>
          {(org?.teams ?? []).map((t) => (
            <Panel key={t.id}>
              <PanelHeader title={t.name} subtitle={`${t.peopleCount} people`} />
              <ProgressBar value={t.healthPct} tone={healthBarTone(t.healthPct)} />
              <p className={styles.mutedLabel}>
                Health {t.healthPct}% · {t.workload} load · {t.atRisk} at risk
              </p>
              <div className={styles.orgAvatars}>
                {t.members.map((m) => (
                  <Link key={m.owner} href={`/team/${encodeURIComponent(m.owner)}`} className={styles.orgAvatar} title={m.name}>
                    {m.initials}
                  </Link>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      {tab === "Dependencies" ? (
        <Panel>
          <PanelHeader title="Dependencies" subtitle="Ledger-synced plus manual execution links" />
          <form
            className={styles.orgDepForm}
            onSubmit={(e) => {
              e.preventDefault();
              void addDep();
            }}
          >
            <select value={fromTeam} onChange={(e) => setFromTeam(e.target.value)} aria-label="From team">
              {teamNames.map((n) => (
                <option key={`from-${n}`}>{n}</option>
              ))}
            </select>
            <input value={fromWork} onChange={(e) => setFromWork(e.target.value)} placeholder="From work" />
            <select value={toTeam} onChange={(e) => setToTeam(e.target.value)} aria-label="To team">
              {teamNames.map((n) => (
                <option key={`to-${n}`}>{n}</option>
              ))}
            </select>
            <input value={toWork} onChange={(e) => setToWork(e.target.value)} placeholder="To work" />
            <button type="submit" className={buttonStyles.primary}>
              Add link
            </button>
          </form>
          <ul className={styles.orgDepList}>
            {(org?.dependencies ?? []).map((d) => (
              <li key={d.id}>
                <strong>
                  {d.fromTeam}
                  {d.fromWork ? ` (${d.fromWork})` : ""} → {d.toTeam}
                  {d.toWork ? ` (${d.toWork})` : ""}
                </strong>
                <span>
                  <StatusPill label={depLabel(d.status)} tone={depTone(d.status)} /> {d.source}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tab === "Workload" ? (
        <div className={styles.consoleGrid}>
          <Panel>
            <PanelHeader title="Workload distribution" />
            <div className={styles.orgDonutWrap}>
              <WorkloadDonut
                high={org?.workload.high ?? 0}
                medium={org?.workload.medium ?? 0}
                optimal={org?.workload.optimal ?? 0}
                low={org?.workload.low ?? 0}
              />
              <div className={styles.orgDonutLegend}>
                <div>
                  <b style={{ background: "var(--status-critical)" }} />
                  High {org?.workload.high ?? 0} ({snap?.people ? Math.round(((org?.workload.high ?? 0) / snap.people) * 100) : 0}%)
                </div>
                <div>
                  <b style={{ background: "var(--status-high)" }} />
                  Medium {org?.workload.medium ?? 0}
                </div>
                <div>
                  <b style={{ background: "var(--status-low)" }} />
                  Optimal {org?.workload.optimal ?? 0}
                </div>
                <div>
                  <b style={{ background: "var(--status-medium)" }} />
                  Low {org?.workload.low ?? 0}
                </div>
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="People by load" action={<Users size={14} />} />
            <ul className={styles.orgRiskList}>
              {people
                .slice()
                .sort((a, b) => b.loadPct - a.loadPct)
                .map((p) => (
                  <li key={p.owner}>
                    <Link href={`/team/${encodeURIComponent(p.owner)}`}>
                      <span className={styles.orgRiskHead}>
                        <strong>{p.name}</strong>
                        <StatusPill label={p.workload} tone={workloadTone(p.workload)} />
                      </span>
                      <span>
                        {p.team} · {p.loadPct}%
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {tab === "Ownership" ? (
        <DataTable
          columns={[
            { key: "name", label: "Owner" },
            { key: "team", label: "Team" },
            { key: "work", label: "Work" },
            { key: "status", label: "Status" },
            { key: "path", label: "Critical path" },
          ]}
          rows={(org?.ownership ?? [])
            .filter((o) => matchesQuery(`${o.name} ${o.team} ${o.work}`, q))
            .map((o) => ({
              name: o.name,
              team: o.team,
              work: o.work,
              status: o.status,
              path: o.criticalPath ? "Yes" : "No",
              href: `/team/${encodeURIComponent(o.owner)}`,
            }))}
          onRowClick={(row) => {
            if (row.href) router.push(row.href);
          }}
        />
      ) : null}

      {tab === "Directory" ? (
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "team", label: "Team" },
            { key: "email", label: "Email" },
          ]}
          rows={people.map((p) => ({
            name: p.name,
            role: p.role,
            team: p.team,
            email: p.email,
            href: `/team/${encodeURIComponent(p.owner)}`,
          }))}
          onRowClick={(row) => {
            if (row.href) router.push(row.href);
          }}
        />
      ) : null}
    </AppShell>
  );
}
