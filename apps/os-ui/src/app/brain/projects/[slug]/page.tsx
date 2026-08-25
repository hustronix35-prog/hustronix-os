"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ChevronDown,
  Circle,
  MoreHorizontal,
  Rocket,
  Share2,
  Star,
} from "@/components/icons";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import { buttonStyles, Dropdown, Modal, modalStyles, useToast } from "@/components/ui/Interactions";
import { KnowledgeGraph } from "@/components/viz/Visualizations";
import {
  HealthRing,
  Panel,
  PanelHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/Primitives";
import { fetchDecisionDetail, type DecisionDetailView } from "@/lib/api";
import type { KGEdge, KGNode } from "@/lib/types";
import shellStyles from "@/components/shell/shell.module.css";
import styles from "./project-detail.module.css";

function ProjectActions() {
  const { toast } = useToast();

  return (
    <>
      <button
        type="button"
        className={shellStyles.iconBtn}
        aria-label="Star project"
        disabled
        title="Project starring is not live yet — Brain catalogs are still fixture-backed"
      >
        <Star size={16} />
      </button>
      <button
        type="button"
        className={shellStyles.iconBtn}
        aria-label="Share project"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            toast("Link copied", { description: window.location.href, tone: "success" });
          } catch {
            toast("Copy failed", { description: "Could not copy this URL.", tone: "danger" });
          }
        }}
      >
        <Share2 size={16} />
      </button>
      <Dropdown
        trigger={({ toggle }) => (
          <button type="button" className={shellStyles.iconBtn} aria-label="More actions" onClick={toggle}>
            <MoreHorizontal size={16} />
          </button>
        )}
        items={[
          {
            type: "item",
            label: "Edit project (not live)",
            onSelect: () => toast("Not available", { description: "Brain project edit is still fixture-backed." }),
          },
          {
            type: "item",
            label: "Duplicate (not live)",
            onSelect: () => toast("Not available", { description: "Brain project duplicate is still fixture-backed." }),
          },
          { type: "separator" },
          {
            type: "item",
            label: "Archive (not live)",
            tone: "danger",
            onSelect: () => toast("Not available", { description: "Brain project archive is still fixture-backed.", tone: "danger" }),
          },
        ]}
      />
    </>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : params.slug?.[0] ?? "";
  const [project, setProject] = useState<DecisionDetailView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [descOpen, setDescOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<DecisionDetailView["signals"][number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setProject(null);
    setTab("Overview");
    setSelectedSignal(null);
    fetchDecisionDetail(slug).then((d) => {
      if (cancelled) return;
      setProject(d);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!loaded) {
    return (
      <AppShell
        topBar={
          <TopBar
            breadcrumb={[
              { label: "Brain", href: "/brain" },
              { label: "Projects", href: "/brain/projects" },
              { label: "Loading" },
            ]}
            searchPlaceholder="Search anything..."
            showAsk={false}
          />
        }
      >
        <div className={styles.missing}>
          <p>Loading decision…</p>
        </div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell
        topBar={
          <TopBar
            breadcrumb={[
              { label: "Brain", href: "/brain" },
              { label: "Projects", href: "/brain/projects" },
              { label: "Not found" },
            ]}
            searchPlaceholder="Search anything..."
            showAsk={false}
          />
        }
      >
        <div className={styles.missing}>
          <p>Decision not found on the ledger.</p>
          <p>
            <Link href="/brain/decisions">Back to decisions</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  const monthCount = Math.max(1, project.timelineMonths.length);
  const todayLeft = `${(project.todayIndex / monthCount) * 100}%`;

  return (
    <AppShell
      topBar={
        <TopBar
          breadcrumb={[
            { label: "Brain", href: "/brain" },
            { label: "Projects", href: "/brain/projects" },
            { label: project.title },
          ]}
          searchPlaceholder="Search anything..."
          showAsk={false}
          trailing={<ProjectActions />}
        />
      }
    >
      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <header className={styles.hero}>
            <div className={styles.heroTop}>
              <div className={styles.heroIdentity}>
                <div className={styles.heroIcon} aria-hidden>
                  <Rocket size={20} />
                </div>
                <div>
                  <div className={styles.heroTitleRow}>
                    <h2>{project.title}</h2>
                    <span className={styles.typePill}>{project.type}</span>
                  </div>
                  <p className={styles.heroSubtitle}>{project.subtitle}</p>
                </div>
              </div>
            </div>

            <div className={styles.metaRow}>
              <div className={styles.metaItem}>
                <span>Owner</span>
                <div className={styles.ownerChip}>
                  <span className={styles.avatar}>{project.owner.initials}</span>
                  <strong>{project.owner.name}</strong>
                </div>
              </div>
              <div className={styles.metaItem}>
                <span>Team</span>
                <Building2 size={13} aria-hidden />
                <strong>{project.team}</strong>
              </div>
              <div className={styles.metaItem}>
                <span>Priority</span>
                <span className={styles.priorityMark} aria-hidden>
                  <ArrowUpRight size={13} />
                </span>
                <strong>{project.priority}</strong>
              </div>
              <div className={styles.metaItem}>
                <span>Status</span>
                <span className={styles.statusMark} aria-hidden>
                  <Circle size={12} />
                </span>
                <StatusPill label={project.status} />
              </div>
              <div className={styles.metaItem}>
                <span>Health</span>
                <div className={styles.miniRing}>
                  <strong>{project.health}%</strong>
                </div>
              </div>
              <div className={styles.metaItem}>
                <span>Updated</span>
                <strong>{project.lastUpdated}</strong>
              </div>
            </div>
          </header>

          <div className={styles.tabs} role="tablist" aria-label="Project sections">
            {project.tabs.map((t) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                className={styles.tab}
                data-active={tab === t.label ? "true" : "false"}
                aria-selected={tab === t.label}
                onClick={() => setTab(t.label)}
              >
                {t.label}
                {t.count != null ? <span className={styles.tabCount}>{t.count}</span> : null}
              </button>
            ))}
          </div>

          {tab === "Overview" ? (
            <>
              <div className={styles.kpiRow}>
                <Panel className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Overall Progress</div>
                  <div className={styles.kpiValue}>{project.progress}%</div>
                  <ProgressBar value={project.progress} tone="gold" />
                  <div className={styles.kpiFoot}>
                    <strong className={styles.kpiOk}>{project.progressLabel}</strong>
                    <span>Target: {project.targetDate}</span>
                  </div>
                </Panel>

                <Panel className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Health Score</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <HealthRing
                      value={project.health}
                      max={100}
                      label={project.health >= 70 ? "Good" : "At Risk"}
                      tone={project.health >= 70 ? "good" : "at-risk"}
                      size="md"
                    />
                    <div className={styles.kpiFoot}>
                      <span className={styles.kpiDecline}>
                        <ArrowDownRight size={12} />
                        {project.healthTrend}
                      </span>
                    </div>
                  </div>
                </Panel>

                <Panel className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>{project.impactLabel}</div>
                  <div className={styles.kpiValue}>{project.impact}</div>
                  <div className={styles.kpiFoot}>
                    <StatusPill label={project.impactTone} tone="low" />
                    <span>Confidence: {project.impactConfidence}%</span>
                  </div>
                </Panel>

                <Panel className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Age</div>
                  <div className={styles.kpiValue}>{project.daysToTarget} days</div>
                  <div className={styles.kpiFoot}>
                    <span>{project.targetDate}</span>
                    <span className={styles.kpiWarn}>{project.daysRisk}</span>
                  </div>
                </Panel>

                <Panel className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Execution weight</div>
                  <div className={styles.kpiValue}>
                    {project.budgetTotal ? `${project.budgetUsed}/${project.budgetTotal}` : "—"}
                  </div>
                  <ProgressBar value={project.budgetPct} tone="gold" />
                  <div className={styles.kpiFoot}>
                    <span>{project.budgetPct}% used</span>
                    <span className={styles.kpiWarn} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i className={styles.dot} aria-hidden />
                      {project.budgetStatus}
                    </span>
                  </div>
                </Panel>
              </div>

              <div className={styles.midGrid}>
                <Panel>
                  <PanelHeader title="Description" />
                  {(() => {
                    const narrative = project.narrative ?? {
                      reasoning: project.description,
                      outcomes: [] as Array<{ metric: string; target: string }>,
                      constraints: [] as string[],
                      reversal: [] as string[],
                    };
                    const hasMore = Boolean(narrative.outcomes.length || narrative.constraints.length || narrative.reversal.length);
                    return (
                      <>
                        {narrative.reasoning ? <p className={styles.descBody}>{narrative.reasoning}</p> : null}
                        {!narrative.reasoning && !hasMore ? <p className={styles.descBody}>{project.description}</p> : null}
                        {descOpen || !narrative.reasoning ? (
                          <div className={styles.descStack}>
                            {narrative.outcomes.length ? (
                              <section className={styles.descSection}>
                                <h3>Expected outcomes</h3>
                                <ul>
                                  {narrative.outcomes.map((o) => (
                                    <li key={`${o.metric}-${o.target}`}>
                                      <strong>{o.metric}</strong>
                                      {o.target ? <span>{o.target}</span> : null}
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            ) : null}
                            {narrative.constraints.length ? (
                              <section className={styles.descSection}>
                                <h3>Constraints</h3>
                                <ul>
                                  {narrative.constraints.map((c) => (
                                    <li key={c}>{c}</li>
                                  ))}
                                </ul>
                              </section>
                            ) : null}
                            {narrative.reversal.length ? (
                              <section className={styles.descSection}>
                                <h3>Reversal conditions</h3>
                                <ul>
                                  {narrative.reversal.map((c) => (
                                    <li key={c}>{c}</li>
                                  ))}
                                </ul>
                              </section>
                            ) : null}
                          </div>
                        ) : null}
                        {hasMore && narrative.reasoning ? (
                          <button type="button" className={styles.showMore} onClick={() => setDescOpen((v) => !v)}>
                            {descOpen ? "Show less" : "Show more"}
                            <ChevronDown
                              size={14}
                              style={{ transform: descOpen ? "rotate(180deg)" : undefined, transition: "transform 160ms ease" }}
                            />
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                </Panel>

                <Panel>
                  <PanelHeader title="Timeline" />
                  <div className={styles.timeline}>
                    <div className={styles.monthRow}>
                      {project.timelineMonths.map((m) => (
                        <span key={m}>{m}</span>
                      ))}
                    </div>
                    <div className={styles.gantt}>
                      <div className={styles.todayLine} style={{ left: todayLeft }}>
                        <span className={styles.todayLabel}>Today</span>
                      </div>
                      {project.phases.map((phase) => {
                        const left = (phase.start / monthCount) * 100;
                        const width = ((phase.end - phase.start) / monthCount) * 100;
                        return (
                          <div key={phase.name} className={styles.phaseRow}>
                            <div className={styles.phaseName}>{phase.name}</div>
                            <div className={styles.phaseTrack}>
                              <div
                                className={styles.phaseBar}
                                style={{ left: `${left}%`, width: `${Math.max(width, 8)}%` }}
                              >
                                <span>{phase.progress}%</span>
                              </div>
                            </div>
                            <div className={styles.phasePct}>{phase.progress}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Panel>
              </div>

              {project.graph?.nodes?.length ? (
                <KnowledgeGraph
                  nodes={project.graph.nodes as KGNode[]}
                  edges={project.graph.edges as KGEdge[]}
                  onSelect={(node) => {
                    if (node.kind !== "signal" || !node.id.startsWith("s:")) return;
                    const sig = project.signals.find((s) => s.id === node.id.slice(2));
                    if (sig) setSelectedSignal(sig);
                  }}
                />
              ) : null}

              <div className={styles.bottomGrid}>
                <Panel>
                  <PanelHeader title="Upcoming Meetings" />
                  <div className={styles.list}>
                    {project.meetings.length ? (
                      project.meetings.map((m) => (
                        <div key={m.title} className={styles.listItem}>
                          <div>
                            <strong>{m.title}</strong>
                            <span>{m.when}</span>
                          </div>
                          <div className={styles.avatars}>
                            {m.avatars.map((a) => (
                              <span key={a} className={styles.avatar}>
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className={styles.stub}>No linked meetings on this decision.</p>
                    )}
                  </div>
                </Panel>

                <Panel>
                  <PanelHeader title="Recent Activity" />
                  <div className={styles.list}>
                    {project.activity.map((a) => (
                      <div key={`${a.text}-${a.when}`} className={styles.activityItem}>
                        <i className={styles.activityDot} data-tone={a.tone} aria-hidden />
                        <div>
                          <p>{a.text}</p>
                          <div className={styles.activityMeta}>
                            {a.who} · {a.when}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          ) : tab === "Tasks" ? (
            <Panel>
              <PanelHeader title="Executions" subtitle={`${project.executions.length} on ledger`} />
              <div className={styles.list}>
                {project.executions.length ? (
                  project.executions.map((e) => (
                    <div key={e.task_id} className={styles.listItem}>
                      <div>
                        <strong>{e.success_condition || e.type || e.task_id}</strong>
                        <span>
                          {e.owner} · {e.type} · wt {e.weight}
                          {e.last_update ? ` · ${e.last_update}` : ""}
                        </span>
                      </div>
                      <StatusPill label={e.status} tone={e.status === "BLOCKED" ? "critical" : e.status === "DONE" ? "low" : "info"} />
                    </div>
                  ))
                ) : (
                  <p className={styles.stub}>No executions linked yet.</p>
                )}
              </div>
            </Panel>
          ) : tab === "Signals" ? (
            <Panel>
              <PanelHeader title="Signals" subtitle={`${project.signals.length} linked`} />
              <div className={styles.list}>
                {project.signals.length ? (
                  project.signals.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={styles.signalRow}
                      onClick={() => setSelectedSignal(s)}
                    >
                      <div>
                        <strong>{s.content || s.source}</strong>
                        <span>
                          {s.source}
                          {s.openTargets?.[0] ? ` · ${s.openTargets[0].label}` : ""}
                          {s.detected_at ? ` · ${s.detected_at}` : ""}
                        </span>
                      </div>
                      <StatusPill label={s.state} tone={s.state === "UNVERIFIED" ? "medium" : "info"} />
                    </button>
                  ))
                ) : (
                  <p className={styles.stub}>No signals linked to this decision’s executions.</p>
                )}
              </div>
            </Panel>
          ) : tab === "Activity" ? (
            <Panel>
              <PanelHeader title="Activity" />
              <div className={styles.list}>
                {project.activity.map((a) => (
                  <div key={`${a.text}-${a.when}`} className={styles.activityItem}>
                    <i className={styles.activityDot} data-tone={a.tone} aria-hidden />
                    <div>
                      <p>{a.text}</p>
                      <div className={styles.activityMeta}>
                        {a.who} · {a.when}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className={styles.stub}>
                <strong>{tab}</strong>
                No extra {tab.toLowerCase()} on this decision.
              </div>
            </Panel>
          )}
        </div>

        <aside className={styles.rail}>
          <Panel>
            <PanelHeader title="Project Health" subtitle={`${project.health}% from ledger`} />
            <div className={styles.healthBlock}>
              <HealthRing
                value={project.health}
                max={100}
                label={project.health >= 70 ? "Good" : "At Risk"}
                tone={project.health >= 70 ? "good" : "at-risk"}
                size="md"
              />
              <div className={styles.healthAxes}>
                {(project.radar?.length
                  ? project.radar
                  : [
                      { label: "Confidence", value: project.impactConfidence },
                      { label: "Progress", value: project.progress },
                    ]
                ).map((axis) => (
                  <div key={axis.label} className={styles.healthAxis}>
                    <span>{axis.label}</span>
                    <ProgressBar value={Number(axis.value) || 0} tone="gold" />
                    <strong className="tabular">{Math.round(Number(axis.value) || 0)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Key Risks" />
            <div className={styles.riskList}>
              {project.risks.length ? (
                project.risks.map((r) => (
                  <div key={r.title} className={styles.riskItem}>
                    <div>
                      <strong>{r.title}</strong>
                      <span>{r.meta}</span>
                    </div>
                    <StatusPill label={r.priority} />
                  </div>
                ))
              ) : (
                <p className={styles.stub}>No blocked executions or unverified signals.</p>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Stakeholders" />
            <div className={styles.stakeList}>
              {project.stakeholders.map((s) => (
                <div key={s.name} className={styles.stakeItem}>
                  <span className={styles.avatar}>{s.initials}</span>
                  <div>
                    <strong>{s.name}</strong>
                    <span>{s.role}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>

      <Modal
        open={selectedSignal != null}
        onClose={() => setSelectedSignal(null)}
        title={selectedSignal?.source ?? "Signal"}
        subtitle={selectedSignal ? `${selectedSignal.state}${selectedSignal.source_subtype ? ` · ${selectedSignal.source_subtype}` : ""}` : undefined}
        footer={
          <>
            <button type="button" className={buttonStyles.ghost} onClick={() => setSelectedSignal(null)}>
              Close
            </button>
            {selectedSignal?.openTargets?.[0] ? (
              <a
                href={selectedSignal.openTargets[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles.primary}
              >
                {selectedSignal.openTargets[0].label}
              </a>
            ) : (
              <a href="/settings/integrations" className={buttonStyles.ghost}>
                Open integrations
              </a>
            )}
          </>
        }
      >
        <p className={modalStyles.text}>{selectedSignal?.content}</p>
        {selectedSignal?.openTargets?.length ? (
          <div className={styles.openList}>
            {selectedSignal.openTargets.map((t) => (
              <a key={`${t.section}-${t.url}`} href={t.url} target="_blank" rel="noopener noreferrer" className={styles.openBtn}>
                <strong>{t.label}</strong>
                <span>{t.section}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.stub}>No deep link on this signal yet. Connect the source in Integrations to jump into the ticket, PR, or thread.</p>
        )}
      </Modal>
    </AppShell>
  );
}
