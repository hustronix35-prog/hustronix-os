"use client";

import { CheckCircle2, Clock, Phone, Target, Users, XCircle } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, TopBar } from "@/components/shell/AppShell";
import {
  HealthRing,
  Panel,
  PanelHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/Primitives";
import { DataTable } from "@/components/ui/DataTable";
import {
  buttonStyles,
  Modal,
  modalStyles,
  useToast,
} from "@/components/ui/Interactions";
import {
  commitDecision,
  fetchDecisionRequired,
  fetchDecisions,
  fetchExecutionPlan,
  fetchMe,
  fetchMissionSummary,
  type DecisionVerdict,
  type ExecutionPlan,
  type LedgerDecision,
} from "@/lib/api";
import {
  confidencePct,
  decisionHealth,
  founderDecisionBrief,
  openDecisionRows,
  readableLedgerText,
  recsFromLedgerDecisions,
  recentFromDecisions,
  splitDecisionPanels,
  stageBarsFromDecisions,
  type FounderDecisionBrief,
} from "@/lib/live-mappers";
import styles from "../pages.module.css";
import detailStyles from "../brain/projects/[slug]/project-detail.module.css";

const recIcons = [Target, Users, Phone, Clock] as const;

const KIND_LABEL: Record<ExecutionPlan["actions"][number]["kind"], string> = {
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  needs_clarification: "Clarify",
  done: "Done",
  killed: "Killed",
};

function ExecutionReadiness({ plan }: { plan: ExecutionPlan }) {
  const c = plan.counts;
  const open = c.ready + c.inProgress + c.blocked + c.needsClarification;
  return (
    <>
      <p className={modalStyles.readyLead}>
        Your decision is now an active organizational commitment.
        {c.total
          ? ` ${c.total} action${c.total === 1 ? "" : "s"} ${c.total === 1 ? "is" : "are"} associated with this decision.`
          : " No execution items are linked yet."}
      </p>
      <div className={modalStyles.readyBar} aria-label={`Readiness ${plan.readinessPct}%`}>
        <span style={{ width: `${plan.readinessPct}%` }} />
      </div>
      <div className={modalStyles.statStrip}>
        <div>
          <span>Ready</span>
          <strong>{c.ready}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{c.blocked}</strong>
        </div>
        <div>
          <span>Clarify</span>
          <strong>{c.needsClarification}</strong>
        </div>
        <div>
          <span>Readiness</span>
          <strong>{plan.readinessPct}%</strong>
        </div>
      </div>
      <p className={modalStyles.readyNext}>
        <small>Recommended next</small>
        {plan.recommendedNext}
        {open && c.existingWork ? ` · ${c.existingWork} existing ticket${c.existingWork === 1 ? "" : "s"} linked.` : null}
        {c.ownerConflicts ? ` · ${c.ownerConflicts} owner capacity conflict${c.ownerConflicts === 1 ? "" : "s"}.` : null}
        {" "}
        Orchestration runs after commit: reconcile existing work, then policy-gated Jira/meetings/assignment.
      </p>
      {plan.actions.length ? (
        <ul className={modalStyles.readyActions}>
          {plan.actions
            .filter((a) => a.kind !== "killed")
            .slice(0, 8)
            .map((a) => (
              <li key={a.taskId} data-kind={a.kind}>
                <span>
                  <strong>{a.label}</strong>
                  <em>
                    {" "}
                    · {a.owner}
                    {a.existingWork[0]?.externalId ? ` · ${a.existingWork[0].externalId}` : ""}
                  </em>
                </span>
                <em>{KIND_LABEL[a.kind]}</em>
              </li>
            ))}
        </ul>
      ) : null}
    </>
  );
}

type ReviewTarget = {
  title: string;
  detail: string;
  confidence?: number;
  impact?: string;
  effort?: string;
  deadline?: string;
  owner?: string;
  decisionId?: string | null;
  brief?: FounderDecisionBrief;
};

function DecisionReviewBrief({ brief, fallback }: { brief?: FounderDecisionBrief; fallback?: string }) {
  const happening = brief?.happening || fallback;
  if (!happening) return null;
  return (
    <div className={modalStyles.brief}>
      <section>
        <h4>What’s happening</h4>
        <p>{happening}</p>
      </section>
      {brief?.why.length ? (
        <section>
          <h4>Why this is on the table</h4>
          <ul>
            {brief.why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief?.who.length ? (
        <section>
          <h4>Who is involved</h4>
          <div className={modalStyles.whoRow}>
            {brief.who.map((name) => (
              <span key={name} className={modalStyles.whoChip}>
                {name}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {brief?.next.length ? (
        <section>
          <h4>If you approve</h4>
          <ul>
            {brief.next.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief?.alternatives.length ? (
        <section>
          <h4>What else could be true</h4>
          <ul>
            {brief.alternatives.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type RecCard = {
  title: string;
  explanation: string;
  status: string;
  statusTone?: "low" | "medium" | "critical" | "info";
  confidence: number;
  impact: string;
  impactDetail: string;
  effort: string;
  rank: string;
  decisionId?: string | null;
};

function recIdentity(rec: { decisionId?: string | null; title: string; rank?: string }, index = 0) {
  return rec.decisionId || `${rec.title}::${rec.rank ?? index}`;
}

const verdictLabels: Record<DecisionVerdict, string> = {
  approved: "Approved",
  rejected: "Rejected",
  deferred: "Deferred",
};

export default function DecidePage() {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, DecisionVerdict>>({});
  const [committing, setCommitting] = useState(false);
  const [readiness, setReadiness] = useState<ExecutionPlan | null>(null);
  const [liveRecs, setLiveRecs] = useState<RecCard[] | null>(null);
  const [ledgerDecisions, setLedgerDecisions] = useState<LedgerDecision[] | null>(null);
  const [ownerName, setOwnerName] = useState("—");
  const [execCounts, setExecCounts] = useState({ total: 0, active: 0, pending: 0, blocked: 0 });
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDecisionRequired(), fetchDecisions(), fetchMe(), fetchMissionSummary()])
      .then(([items, decisions, me, summary]) => {
        if (cancelled) return;
        if (me?.profile.displayName) setOwnerName(me.profile.displayName);
        if (decisions) setLedgerDecisions(decisions);
        if (summary) setExecCounts(summary.executionSummary);
        if (items.length) {
        setLiveRecs(
          items.slice(0, 8).map((item, index) => ({
            title: item.decision_vow || `${item.dimension.replace(/_/g, " ")} · ${item.entity_id}`,
            explanation:
              item.explanation ||
              `${item.severity} ${item.status.toLowerCase()} conflict on ${item.dimension} (${item.entity_id}).`,
            status: item.decision_status || (item.status === "ESCALATED" ? "Decision required" : item.status),
            statusTone:
              item.severity === "CRITICAL"
                ? "critical"
                : item.severity === "HIGH"
                  ? "medium"
                  : "info",
            confidence: Math.round(Number(item.confidence || 0) * 100) || 55,
            impact: item.dimension.replace(/_/g, " "),
            impactDetail: item.entity_id,
            effort: item.status === "ESCALATED" ? "Human commit" : "Review",
            rank: String(index + 1).padStart(2, "0"),
            decisionId: item.decision_id,
          })),
        );
        } else if (decisions) {
          setLiveRecs(recsFromLedgerDecisions(decisions));
        } else {
          setLiveRecs([]);
        }
      })
      .catch(() => {
        /* keep mock fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const liveTable = ledgerDecisions
    ? openDecisionRows(ledgerDecisions, ownerName)
    : [];
  const liveStages = ledgerDecisions ? stageBarsFromDecisions(ledgerDecisions) : [];
  const liveHealth = ledgerDecisions ? decisionHealth(ledgerDecisions, execCounts) : null;
  const liveRecent = ledgerDecisions ? recentFromDecisions(ledgerDecisions) : [];
  const liveSplit = ledgerDecisions ? splitDecisionPanels(ledgerDecisions) : null;
  const featured = ledgerDecisions?.[0] ?? null;
  const featuredConf = confidencePct(featured?.confidence);
  const reviewingLedger = reviewing
    ? ledgerDecisions?.find((d) => d.id === reviewing.decisionId || d.vow === reviewing.title)
    : null;
  const alreadyActive = reviewingLedger?.status === "ACTIVE" && !readiness;

  const recCards: RecCard[] = liveRecs ?? [];

  const commit = async (verdict: DecisionVerdict) => {
    if (!reviewing || committing) return;
    setCommitting(true);
    try {
      const result = await commitDecision(reviewing.title, verdict, reviewing.decisionId);
      if (!result.ok) {
        toast("Commit failed", { description: "No matching ledger decision.", tone: "danger" });
        return;
      }
      setVerdicts((prev) => ({ ...prev, [reviewing.decisionId || reviewing.title]: verdict }));
      if (verdict === "approved") {
        const id = reviewing.decisionId;
        if (id) {
          setLedgerDecisions((rows) =>
            rows ? rows.map((d) => (d.id === id ? { ...d, status: "ACTIVE" } : d)) : rows,
          );
        }
        let plan = result.plan ?? null;
        if (id && !plan) {
          try {
            plan = await fetchExecutionPlan(id);
          } catch {
            plan = null;
          }
        }
        if (plan) {
          setReadiness(plan);
          toast("Decision activated", { description: reviewing.title, tone: "success" });
          return;
        }
      }
      toast(`Decision ${verdictLabels[verdict].toLowerCase()}`, {
        description: reviewing.title,
        tone: verdict === "rejected" ? "danger" : "success",
      });
      setReviewing(null);
    } catch (err) {
      toast("Commit failed", {
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    } finally {
      setCommitting(false);
    }
  };

  const closeReview = () => {
    setReviewing(null);
    setReadiness(null);
  };

  const goExecute = (decisionId?: string | null) => {
    const id = decisionId || reviewing?.decisionId || readiness?.decisionId;
    closeReview();
    router.push(id ? `/execute?decision=${encodeURIComponent(id)}` : "/execute");
  };

  const openReview = (target: ReviewTarget) => {
    setReadiness(null);
    const fromLedger = ledgerDecisions?.find((d) => d.id === target.decisionId || d.vow === target.title);
    const raw = fromLedger?.decision_reasoning || target.detail || "";
    const brief = founderDecisionBrief(raw);
    const technicalImpact = !target.impact || (/commit/i.test(target.impact) && /[0-9a-f]{6,}/i.test(target.impact));
    setReviewing({
      title: target.title,
      detail:
        brief.summary ||
        readableLedgerText(fromLedger?.expected_outcomes) ||
        target.detail ||
        target.title,
      brief,
      confidence:
        (target.confidence && target.confidence > 0 ? target.confidence : undefined) ??
        brief.confidencePct ??
        confidencePct(fromLedger?.confidence) ??
        undefined,
      impact: (technicalImpact ? brief.impact : target.impact) || brief.impact || fromLedger?.status.replace(/_/g, " "),
      effort: target.effort,
      deadline: target.deadline,
      owner: target.owner,
      decisionId: target.decisionId || fromLedger?.id || null,
    });
  };

  const openProjectDetails = () => {
    if (!reviewing) return;
    if (!reviewing.decisionId) {
      toast("No ledger id", { description: "This item is not on the decision ledger.", tone: "danger" });
      return;
    }
    closeReview();
    router.push(`/brain/projects/${reviewing.decisionId}`);
  };

  return (
    <AppShell
      topBar={
        <TopBar
          title="Decisions"
          subtitle="What we decided, why, and what the ledger is enforcing."
          askLabel="+ AI Assistant"
        />
      }
    >
      <div className={styles.gridMainRail}>
        <div className={styles.stack}>
          <Panel>
            <PanelHeader title={liveRecs !== null ? (liveRecs.length ? "Needs a commit" : "Nothing to recommend") : "Recommended for you"} />
            <div className={styles.recGrid}>
              {recCards.length ? recCards.map((rec, index) => {
                const Icon = recIcons[index] ?? Target;
                const recKey = recIdentity(rec, index);
                const verdict = verdicts[recKey] || (rec.decisionId ? verdicts[rec.decisionId] : undefined);
                return (
                  <article
                    key={recKey}
                    className={styles.recCard}
                    data-tone={rec.statusTone ?? rec.status}
                    data-clickable="true"
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      openReview({
                        title: rec.title,
                        detail: rec.explanation,
                        confidence: rec.confidence,
                        impact: rec.impactDetail ? `${rec.impact} · ${rec.impactDetail}` : rec.impact,
                        effort: rec.effort,
                        decisionId: rec.decisionId,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      openReview({
                        title: rec.title,
                        detail: rec.explanation,
                        confidence: rec.confidence,
                        impact: rec.impactDetail ? `${rec.impact} · ${rec.impactDetail}` : rec.impact,
                        effort: rec.effort,
                        decisionId: rec.decisionId,
                      });
                    }}
                  >
                    <div className={styles.recTop}>
                      <span className={styles.rank}>{rec.rank}</span>
                      <h3>{rec.title}</h3>
                      <span className={styles.recIcon} data-tone={rec.statusTone}>
                        <Icon size={15} />
                      </span>
                    </div>
                    <div className={styles.recPills}>
                      <StatusPill label={rec.status} tone={rec.statusTone} />
                    </div>
                    <p>{rec.explanation}</p>
                    <div className={styles.recMeta}>
                      <div>
                        <span>Confidence</span>
                        <strong data-accent="low">{rec.confidence}%</strong>
                      </div>
                      <div>
                        <span>Impact</span>
                        <strong data-accent={rec.statusTone}>
                          {rec.impact}
                          <em>{rec.impactDetail}</em>
                        </strong>
                      </div>
                      <div>
                        <span>Effort</span>
                        <strong>{rec.effort}</strong>
                      </div>
                    </div>
                    <div className={styles.recFoot}>
                      <small>{liveRecs !== null ? "From decision ledger" : "Recommended by AI"}</small>
                      {verdict ? (
                        <StatusPill
                          label={verdictLabels[verdict]}
                          tone={verdict === "approved" ? "low" : verdict === "rejected" ? "critical" : "medium"}
                        />
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {rec.decisionId ? (
                            <Link
                              href={`/brain/projects/${rec.decisionId}`}
                              className={detailStyles.detailsBtn}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Details
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className={styles.reviewBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              openReview({
                                title: rec.title,
                                detail: rec.explanation,
                                confidence: rec.confidence,
                                impact: rec.impactDetail ? `${rec.impact} · ${rec.impactDetail}` : rec.impact,
                                effort: rec.effort,
                                decisionId: rec.decisionId,
                              });
                            }}
                          >
                            Review
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }) : (
                <p className={styles.emptyHint}>No draft or in-review decisions on the ledger.</p>
              )}
            </div>
          </Panel>

          <DataTable
            onRowClick={(row) =>
              openReview({
                title: row.title,
                detail: `${row.type} decision owned by ${row.owner}. Status: ${
                  verdicts[row.decisionId] || verdicts[row.title]
                    ? verdictLabels[verdicts[row.decisionId] || verdicts[row.title]]
                    : row.status
                }.`,
                impact: row.impact,
                deadline: row.deadline,
                owner: row.owner,
                decisionId: row.decisionId || null,
              })
            }
            rows={liveTable.map((d) => ({
              title: d.title,
              type: d.type,
              owner: d.owner,
              impact: d.impact,
              deadline: d.deadline ?? "",
              age: d.age ?? "",
              status: verdicts[d.id] || verdicts[d.title] ? verdictLabels[verdicts[d.id] || verdicts[d.title]] : d.status,
              decisionId: d.id,
            }))}
            columns={[
              { key: "title", label: "Decision" },
              { key: "type", label: "Type" },
              { key: "owner", label: "Owner" },
              { key: "impact", label: "Impact", render: (row) => <StatusPill label={row.impact} /> },
              { key: "deadline", label: "Created" },
              { key: "age", label: "Age" },
              { key: "status", label: "Status", render: (row) => <StatusPill label={row.status} /> },
              {
                key: "decisionId",
                label: "",
                render: (row) =>
                  row.decisionId ? (
                    <Link
                      href={`/brain/projects/${row.decisionId}`}
                      className={detailStyles.detailsBtn}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Details
                    </Link>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />

          <div className={styles.triple}>
            <Panel>
              <PanelHeader title={ledgerDecisions ? "Active / completed" : "Strategic Decisions"} />
              <div className={styles.miniList}>
                {(liveSplit?.strategic ?? []).map((item) => (
                  <button
                    key={"id" in item && item.id ? item.id : item.title}
                    type="button"
                    className={`${styles.miniItem} ${styles.miniClick}`}
                    onClick={() =>
                      openReview({
                        title: item.title,
                        detail: item.detail,
                        confidence: item.confidence ?? item.progress,
                        impact: item.stage,
                        decisionId: item.id,
                      })
                    }
                  >
                    <header>
                      <strong>{item.title}</strong>
                      <StatusPill label={`${item.stage} ${item.progress}%`} tone="info" />
                    </header>
                    <ProgressBar value={item.progress} tone="blue" />
                  </button>
                ))}
                {liveSplit && !liveSplit.strategic.length ? (
                  <p className={styles.emptyHint}>No active or completed decisions.</p>
                ) : null}
              </div>
            </Panel>
            <Panel>
              <PanelHeader title={ledgerDecisions ? "Draft / review" : "Operational Decisions"} />
              <div className={styles.miniList}>
                {(liveSplit?.operational ?? []).map((item) => (
                  <button
                    key={"id" in item && item.id ? item.id : item.title}
                    type="button"
                    className={`${styles.miniItem} ${styles.miniClick}`}
                    onClick={() =>
                      openReview({
                        title: item.title,
                        detail: item.detail,
                        confidence: item.confidence ?? item.progress,
                        impact: item.stage,
                        decisionId: item.id,
                      })
                    }
                  >
                    <header>
                      <strong>{item.title}</strong>
                      <StatusPill label={item.stage} tone="medium" />
                    </header>
                    <ProgressBar value={item.progress} tone="gold" />
                  </button>
                ))}
                {liveSplit && !liveSplit.operational.length ? (
                  <p className={styles.emptyHint}>No draft or in-review decisions.</p>
                ) : null}
              </div>
            </Panel>
            <Panel>
              <PanelHeader title={ledgerDecisions ? "Ledger snapshot" : "What-if Analysis"} />
              <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 13 }}>
                {featured?.vow || "Delay Mobile Launch by 5 days"}
              </p>
              <div className={styles.whatIfMetrics}>
                <div>
                  <span>{ledgerDecisions ? "Decisions" : "Revenue Impact"}</span>
                  <strong>{ledgerDecisions ? ledgerDecisions.length : "-$180K"}</strong>
                </div>
                <div>
                  <span>{ledgerDecisions ? "Executions" : "Customer Impact"}</span>
                  <strong>{ledgerDecisions ? execCounts.total : "Low"}</strong>
                </div>
                <div>
                  <span>{ledgerDecisions ? "Blocked" : "Launch Probability"}</span>
                  <strong>{ledgerDecisions ? execCounts.blocked : "+62%"}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{featuredConf != null ? `${featuredConf}%` : ledgerDecisions ? "—" : "91%"}</strong>
                </div>
              </div>
              <div className={styles.chartBox}>
                <svg className={styles.sparkline} viewBox="0 0 280 120" preserveAspectRatio="none" aria-hidden>
                  <polyline
                    fill="none"
                    stroke="rgba(255,255,255,0.25)"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    points="10,30 70,35 130,42 190,55 250,70"
                  />
                  <polyline
                    fill="none"
                    stroke="var(--status-low)"
                    strokeWidth="2.5"
                    points="10,40 70,38 130,34 190,28 250,22"
                  />
                </svg>
                <div className={styles.chartLegend}>
                  <span>
                    <i data-style="dashed" /> Current Plan
                  </span>
                  <span>
                    <i data-style="solid" /> Delay by 5 Days
                  </span>
                </div>
              </div>
            </Panel>
          </div>

        </div>

        <aside className={styles.rail}>
          <Panel>
            <PanelHeader title="Decision Health" />
            <div className={styles.healthSplit}>
              <HealthRing
                value={liveHealth?.ring ?? 78}
                label={liveHealth?.label ?? "Good"}
                tone={liveHealth?.tone ?? "good"}
                size="lg"
              />
              <div className={styles.healthLegend}>
                <div>
                  <i data-tone="healthy" /> Healthy <strong>{liveHealth ? `${liveHealth.healthy}%` : "62%"}</strong>
                </div>
                <div>
                  <i data-tone="at-risk" /> At Risk <strong>{liveHealth ? `${liveHealth.atRisk}%` : "23%"}</strong>
                </div>
                <div>
                  <i data-tone="blocked" /> Blocked <strong>{liveHealth ? `${liveHealth.blocked}%` : "10%"}</strong>
                </div>
                <div>
                  <i data-tone="pending" /> Draft <strong>{liveHealth ? `${liveHealth.pending}%` : "5%"}</strong>
                </div>
                {!liveHealth ? <p className={styles.trendUp}>↑ +14% vs last month</p> : null}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Decisions by Stage" />
            {liveStages.map((stage, index) => (
              <div key={stage.label} className={styles.stageRow} data-stage={index % 5}>
                <span>{stage.label}</span>
                <div className={styles.stageTrack}>
                  <div className={styles.stageFill} style={{ width: `${(stage.value / stage.max) * 100}%` }} />
                </div>
                <strong className="tabular">{stage.value}</strong>
              </div>
            ))}
          </Panel>

          <Panel>
            <PanelHeader title="Impact Summary" subtitle={ledgerDecisions ? "Ledger" : "Next 90 days"} />
            <div className={styles.impactGrid}>
              <div className={styles.impactCard}>
                <span>{ledgerDecisions ? "Decisions" : "Revenue Impact"}</span>
                <strong>{ledgerDecisions ? ledgerDecisions.length : "+$1.2M"}</strong>
              </div>
              <div className={styles.impactCard}>
                <span>{ledgerDecisions ? "Active exec" : "Cost Impact"}</span>
                <strong>{ledgerDecisions ? execCounts.active : "-$430K"}</strong>
              </div>
              <div className={styles.impactCard}>
                <span>{ledgerDecisions ? "Blocked exec" : "Risk Exposure"}</span>
                <strong>{ledgerDecisions ? execCounts.blocked : "$280K"}</strong>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Recent Decisions" />
            <ul className={styles.listPlain}>
              {liveRecent.map((item) => (
                <li key={"id" in item && item.id ? item.id : item.title}>
                  <button
                    type="button"
                    className={styles.listPlainBtn}
                    onClick={() =>
                      openReview({
                        title: item.title,
                        detail: item.detail,
                        confidence: item.confidence,
                        impact: item.result,
                        decisionId: item.id,
                      })
                    }
                  >
                    {item.result === "Approved" ? (
                      <CheckCircle2 size={16} color="var(--status-low)" />
                    ) : (
                      <XCircle size={16} color="var(--status-critical)" />
                    )}
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.result} · {item.date}
                      </small>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      <Modal
        open={reviewing !== null}
        onClose={closeReview}
        title={reviewing?.title ?? ""}
        subtitle={
          readiness
            ? "Decision is ACTIVE · execution plan (no work started yet)"
            : alreadyActive
              ? "Already an active organizational commitment"
              : "Decision review · Commits to the execution ledger"
        }
        size="lg"
        footer={
          readiness || alreadyActive ? (
            <>
              <button type="button" className={`${buttonStyles.ghost} ${modalStyles.footLead}`} onClick={closeReview}>
                Close
              </button>
              <button type="button" className={buttonStyles.primary} onClick={() => goExecute(reviewing?.decisionId)}>
                Review Execution
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${buttonStyles.ghost} ${modalStyles.footLead}`}
                disabled={committing}
                onClick={openProjectDetails}
              >
                Details
              </button>
              <button type="button" className={buttonStyles.ghost} disabled={committing} onClick={() => void commit("deferred")}>
                Defer
              </button>
              <button type="button" className={buttonStyles.danger} disabled={committing} onClick={() => void commit("rejected")}>
                Reject
              </button>
              <button type="button" className={buttonStyles.primary} disabled={committing} onClick={() => void commit("approved")}>
                {committing ? "Committing…" : "Approve Decision"}
              </button>
            </>
          )
        }
      >
        {readiness ? (
          <ExecutionReadiness plan={readiness} />
        ) : (
          <>
            <DecisionReviewBrief brief={reviewing?.brief} fallback={reviewing?.detail} />
            <div className={modalStyles.kvGrid}>
              <div>
                <span>Confidence</span>
                <strong>{reviewing?.confidence ? `${reviewing.confidence}%` : "—"}</strong>
              </div>
              <div>
                <span>Impact</span>
                <strong>{reviewing?.impact ?? "—"}</strong>
              </div>
              <div>
                <span>{reviewing?.owner ? "Owner" : "Effort"}</span>
                <strong>{reviewing?.owner ?? reviewing?.effort ?? "—"}</strong>
              </div>
            </div>
            <ul className={modalStyles.list}>
              <li>
                <CheckCircle2 size={14} color="var(--status-low)" />
                Context pulled from Company Brain: related messages, capacity, and who is involved.
              </li>
              <li>
                <Clock size={14} color="var(--status-medium)" />
                {reviewing?.deadline
                  ? `Deadline: ${reviewing.deadline}`
                  : alreadyActive
                    ? "This vow is already ACTIVE. Review execution to start or unblock work."
                    : "Approving records this as a company decision. Assigned work stays pending until Execute."}
              </li>
            </ul>
          </>
        )}
      </Modal>
    </AppShell>
  );
}
