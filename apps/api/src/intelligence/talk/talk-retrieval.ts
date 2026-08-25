/**
 * Company Brain retrieval for Talk. Relevance-ranked slices — not a full dump.
 */
import { db } from "../../database.js";
import { loadEvidenceReferences, type EvidenceReference } from "../evidence-reference.js";
import { isImpactScan, rankContext } from "../context-ranking.js";
import { extractEntities } from "../entity-resolver.js";
import { explainBottlenecks } from "../../org/bottleneck-intelligence.js";
import { buildOrgIntelligence } from "../../org/intelligence.js";
import type { TalkIntent, TalkMode } from "./talk-intent.js";
import type { TalkContext } from "./talk-context.js";
import { planTalkRetrieval } from "./talk-retrieval-plan.js";

export type SituationContext = {
  id: string;
  title: string;
  pattern_id: string;
  stage: string;
  trajectory: string;
  confidence: number;
  entities: string[];
  explanation: string | null;
  decision_id: string | null;
};

export type DecisionContext = { id: string; vow: string; status: string };
export type OutcomeContext = { decision_id: string; result: string; pattern_id: string | null; notes?: string | null };
export type DependencyContext = { fromTeam: string; toTeam: string; work: string; status: string };
export type TeamContext = { name: string; atRisk: number };
export type PersonContext = { name: string; team: string; blocked: number };
export type SignalContext = { id: string; source: string; snippet: string; detected_at: string | null };
export type CustomerContext = { name: string; situationIds: string[]; worsening: boolean };
export type TaskContext = { id: string; owner: string; status: string; work: string };

export type CompanyContext = {
  situations: SituationContext[];
  evidence: EvidenceReference[];
  customers: CustomerContext[];
  teams: TeamContext[];
  people: PersonContext[];
  decisions: DecisionContext[];
  tasks: TaskContext[];
  outcomes: OutcomeContext[];
  dependencies: DependencyContext[];
  signals: SignalContext[];
  bottleneckTalk: string | null;
  insufficient: boolean;
};

function parseArr(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function recencyFromIso(ts: string | null): number {
  if (!ts) return 0.3;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 0.3;
  const days = (Date.now() - t) / 86400000;
  if (days < 7) return 1;
  if (days < 30) return 0.7;
  if (days < 90) return 0.4;
  return 0.2;
}

function hayHas(hay: string, token: string): boolean {
  return hay.toLowerCase().includes(token.toLowerCase());
}

const TEAM_LABELS = new Set([
  "sales",
  "engineering",
  "security",
  "finance",
  "product",
  "support",
  "executive",
  "qa",
  "customer success",
]);

function relevantToNamed(text: string, entities: string[], named: string[]): boolean {
  const focus = named.filter((n) => !TEAM_LABELS.has(n));
  const hay = `${text} ${entities.join(" ")}`.toLowerCase();
  if (focus.length) return focus.some((n) => hayHas(hay, n));
  if (named.includes("sales")) return /sales|revenue|pipeline|deal|forecast|quota|arr|renewal|churn|conversion|coverage/.test(hay);
  return true;
}

function emptyContext(): CompanyContext {
  return {
    situations: [],
    evidence: [],
    customers: [],
    teams: [],
    people: [],
    decisions: [],
    tasks: [],
    outcomes: [],
    dependencies: [],
    signals: [],
    bottleneckTalk: null,
    insufficient: true,
  };
}

export function retrieveTalkContext(opts: {
  userId: string;
  question: string;
  intent: TalkIntent;
  conversation?: TalkContext | null;
}): CompanyContext {
  const { userId, intent } = opts;
  const plan = planTalkRetrieval({
    question: opts.question,
    intent,
    conversation: opts.conversation,
  });
  if (!plan.required) return emptyContext();
  if (intent.mode === "CASUAL" || intent.mode === "GENERAL") return emptyContext();
  if (intent.contextMode === "GENERAL" || !intent.requiresCompanyContext) return emptyContext();

  const namedSeed = unique([
    plan.focusEntity,
    ...(plan.suspendSticky || plan.companyWide ? [] : plan.entities),
    ...(plan.companyWide || plan.suspendSticky ? [] : [intent.entity]),
    ...(plan.suspendSticky || plan.companyWide
      ? []
      : [...(opts.conversation?.currentEntities?.customers || []), ...(opts.conversation?.recentEntities || [])]),
  ]).filter(Boolean) as string[];

  const question =
    intent.scope === "CURRENT_CONTEXT" && (opts.conversation?.currentTopic || opts.conversation?.recentTopics[0])
      ? `${opts.question} ${opts.conversation.currentTopic || opts.conversation.recentTopics[0]} ${
          plan.suspendSticky ? "" : opts.conversation.activeCustomerId || ""
        }`
      : plan.reason === "dependency_bottleneck"
        ? `${opts.question} launch blocked engineering security legal dependency`
        : opts.question;

  const ctx = retrieveCompanyContext(
    userId,
    question,
    intent.mode,
    namedSeed.length ? namedSeed : extractEntities(question).map((e) => e.label),
    {
      maxSituations: plan.maxSituations,
      maxEvidence: plan.maxEvidence,
      focusEntity: plan.companyWide || plan.suspendSticky ? undefined : plan.focusEntity,
      includeDecisions: plan.decisions,
      includeOutcomes: plan.outcomes,
      includeOrg: plan.organization || plan.dependencies,
      includeSignals: plan.signals,
      companyWide: plan.companyWide,
      preferWorsening:
        plan.reason === "company_overview" ||
        plan.reason === "customer_risk_scan" ||
        plan.reason === "temporal_delta",
      preferLaunch: plan.reason === "dependency_bottleneck",
    },
  );
  return ctx;
}

function unique(xs: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x || "").trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

export function retrieveCompanyContext(
  userId: string,
  question: string,
  mode: TalkMode | string,
  namedEntities: string[],
  limits?: {
    maxSituations?: number;
    maxEvidence?: number;
    focusEntity?: string;
    includeDecisions?: boolean;
    includeOutcomes?: boolean;
    includeOrg?: boolean;
    includeSignals?: boolean;
    companyWide?: boolean;
    preferWorsening?: boolean;
    preferLaunch?: boolean;
  },
): CompanyContext {
  const empty = emptyContext();
  if (mode === "CASUAL" || mode === "GENERAL" || mode === "GENERAL_CONVERSATION") return empty;

  const maxSits = limits?.maxSituations ?? (mode === "STRATEGY" || mode === "BRAINSTORM" || mode === "COMPANY_QA" ? 6 : 3);
  const maxEv = limits?.maxEvidence ?? 8;
  const focus = (limits?.focusEntity || "").toLowerCase();
  const companyWide = Boolean(limits?.companyWide);

  const sitRows = db.rawGet(
    `SELECT id, title, pattern_id, stage, trajectory, confidence, entities_json, explanation, decision_id, updated_at, evidence_count
       FROM situations WHERE user_id = ? AND stage != 'RESOLVED'
       ORDER BY updated_at DESC LIMIT 40`,
    [userId],
  ) as Array<{
    id: string;
    title: string;
    pattern_id: string;
    stage: string;
    trajectory: string;
    confidence: number;
    entities_json: string | null;
    explanation: string | null;
    decision_id: string | null;
    updated_at: string | null;
    evidence_count: number;
  }>;

  const named = namedEntities.map((e) => e.toLowerCase());
  const focusNamed = companyWide ? [] : named.filter((n) => !TEAM_LABELS.has(n));
  const requireTopic = companyWide ? false : !focusNamed.length && !isImpactScan(question) && !limits?.preferWorsening;
  const broad =
    companyWide ||
    (!focus && (mode === "STRATEGY" || mode === "BRAINSTORM" || mode === "COMPANY_QA" || mode === "COMPANY_QUESTION" || mode === "COMPARISON"));
  let rankedSits = rankContext(
    question,
    sitRows.map((s) => {
      const entities = parseArr(s.entities_json);
      const text = `${s.title} ${s.pattern_id} ${s.explanation || ""} ${entities.join(" ")}`;
      const hitEntity = focusNamed.some((n) => hayHas(text, n));
      const focusHit = focus ? hayHas(text, focus) : false;
      const launchHit = limits?.preferLaunch
        ? /launch|block|credential|security|legal|engineering|waiting|dependency/i.test(text)
        : false;
      const money = /renewal|forecast|pipeline|revenue|arr|quota/i.test(text) ? 0.85 : 0.35;
      const worsen = s.trajectory === "WORSENING" ? 1 : s.trajectory === "IMPROVING" ? 0.15 : 0.4;
      return {
        id: s.id,
        text,
        entities,
        impact: s.stage === "DECISION_READY" || s.stage === "DECIDED" ? 0.9 : s.stage === "ELEVATED" ? 0.7 : 0.4,
        recency: recencyFromIso(s.updated_at),
        trajectoryBoost: limits?.preferWorsening ? worsen : s.trajectory === "WORSENING" ? 0.85 : s.trajectory === "IMPROVING" ? 0.2 : 0.4,
        situationBoost: launchHit ? 1 : focusHit ? 1 : hitEntity ? 0.95 : companyWide ? 0.55 : 0.25,
        customerImportance: focusHit || hitEntity ? 1 : entities.length ? 0.4 : 0.2,
        financialImportance: money,
        decisionStateBoost: s.decision_id ? 0.6 : s.stage === "DECISION_READY" ? 0.7 : 0.2,
        row: s,
      };
    }),
    Math.max(maxSits, broad ? 6 : 3),
    { requireTopic: focus || companyWide ? false : requireTopic },
  ).filter((r) => (companyWide ? true : relevantToNamed(r.text, r.entities, named)));

  if (focus) {
    const focused = rankedSits.filter((r) => hayHas(r.text, focus) || r.entities.some((e) => hayHas(e, focus)));
    if (focused.length) rankedSits = focused;
  }
  if (limits?.preferLaunch) {
    const launchish = rankedSits.filter((r) =>
      /launch|block|credential|security|legal|engineering|waiting|dependency/i.test(r.text),
    );
    if (launchish.length) rankedSits = launchish;
  }
  if (limits?.preferWorsening) {
    rankedSits = [...rankedSits].sort((a, b) => {
      const aw = a.row.trajectory === "WORSENING" ? 1 : 0;
      const bw = b.row.trajectory === "WORSENING" ? 1 : 0;
      return bw - aw;
    });
  }
  rankedSits = rankedSits.slice(0, maxSits);

  const situations: SituationContext[] = rankedSits.map((r) => ({
    id: r.row.id,
    title: r.row.title,
    pattern_id: r.row.pattern_id,
    stage: r.row.stage,
    trajectory: r.row.trajectory,
    confidence: r.row.confidence,
    entities: parseArr(r.row.entities_json),
    explanation: r.row.explanation,
    decision_id: r.row.decision_id,
  }));

  const evidence: EvidenceReference[] = [];
  if (limits?.includeSignals !== false) {
    for (const s of situations.slice(0, Math.min(4, maxSits))) {
      evidence.push(...loadEvidenceReferences(s.id, Math.max(2, Math.ceil(maxEv / Math.max(1, situations.length)))));
    }
  }

  const customersMap = new Map<string, CustomerContext>();
  for (const s of situations) {
    for (const name of s.entities) {
      if (TEAM_LABELS.has(name.toLowerCase())) continue;
      const cur = customersMap.get(name) || { name, situationIds: [], worsening: false };
      cur.situationIds.push(s.id);
      if (s.trajectory === "WORSENING") cur.worsening = true;
      customersMap.set(name, cur);
    }
  }

  let decisions: DecisionContext[] = [];
  try {
    const decRows = db.rawGet(
      `SELECT id, vow, status FROM decision_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ) as DecisionContext[];
    decisions = rankContext(
      question,
      decRows.map((d) => ({
        id: d.id,
        text: `${d.vow} ${d.status}`,
        entities: [],
        impact: d.status === "ACTIVE" ? 0.7 : 0.4,
        recency: 0.5,
        situationBoost: 0.2,
        row: d,
      })),
      4,
      { requireTopic },
    ).map((r) => r.row);
  } catch {
    decisions = [];
  }

  let outcomes: OutcomeContext[] = [];
  try {
    const outRows = db.rawGet(
      `SELECT decision_id, result, pattern_id, learning_notes FROM decision_outcomes WHERE tenant_id = ? ORDER BY evaluated_at DESC LIMIT 20`,
      [userId],
    ) as OutcomeContext[];
    outcomes = rankContext(
      question,
      outRows.map((o) => ({
        id: o.decision_id,
        text: `${o.result} ${o.pattern_id || ""} ${o.notes || ""}`,
        entities: [],
        impact: o.result === "failed" ? 0.8 : 0.4,
        recency: 0.5,
        situationBoost: 0.2,
        row: o,
      })),
      4,
      { requireTopic: false },
    ).map((r) => r.row);
  } catch {
    outcomes = [];
  }

  let bottleneckTalk: string | null = null;
  let dependencies: DependencyContext[] = [];
  try {
    if (limits?.includeOrg) {
      const b = explainBottlenecks(userId);
      bottleneckTalk = b.bottleneck ? b.talk : null;
      dependencies = b.chain.map((c) => ({
        fromTeam: c.waiter,
        toTeam: c.blocker,
        work: c.work,
        status: "DELAYED",
      }));
    }
  } catch {
    /* ignore */
  }

  let teams: TeamContext[] = [];
  let people: PersonContext[] = [];
  try {
    if (limits?.includeOrg) {
      const org = buildOrgIntelligence(userId);
      teams = (org.teams || []).slice(0, 8).map((t) => ({ name: t.name, atRisk: t.atRisk }));
      people = (org.people || [])
        .filter((p) => p.blocked > 0 || /sales|cs|success/i.test(p.team))
        .slice(0, 6)
        .map((p) => ({ name: p.name, team: p.team, blocked: p.blocked }));
    }
  } catch {
    /* ignore */
  }

  let tasks: TaskContext[] = [];
  try {
    const rows = db.rawGet(
      `SELECT e.task_id AS id, e.owner, e.status, e.success_condition AS work
         FROM execution_ledger e
         INNER JOIN decision_ledger d ON d.id = e.decision_id
        WHERE d.user_id = ? AND e.status NOT IN ('DONE','KILLED')
        ORDER BY e.last_update DESC LIMIT 12`,
      [userId],
    ) as TaskContext[];
    tasks = (rows || []).slice(0, 8);
  } catch {
    tasks = [];
  }

  let signals: SignalContext[] = [];
  try {
    const sigRows = db.rawGet(
      `SELECT id, source, content, detected_at FROM external_signals
        WHERE user_id = ? AND state IN ('UNVERIFIED','GRACE','LINKED')
        ORDER BY COALESCE(detected_at, received_at) DESC LIMIT 30`,
      [userId],
    ) as Array<{ id: string; source: string; content: string | null; detected_at: string | null }>;
    signals = rankContext(
      question,
      sigRows.map((s) => ({
        id: s.id,
        text: s.content || "",
        entities: extractEntities(s.content || "").map((e) => e.label),
        recency: recencyFromIso(s.detected_at),
        impact: 0.4,
        situationBoost: 0.2,
        row: s,
      })),
      6,
      { requireTopic },
    )
      .filter((r) => relevantToNamed(r.text, r.entities, named))
      .map((r) => ({
        id: r.row.id,
        source: r.row.source,
        snippet: String(r.row.content || "").replace(/\s+/g, " ").slice(0, 160),
        detected_at: r.row.detected_at,
      }));
  } catch {
    signals = [];
  }

  const insufficient = situations.length === 0 && evidence.length === 0 && signals.length === 0 && decisions.length === 0;
  return {
    situations,
    evidence: evidence.slice(0, maxEv),
    customers: [...customersMap.values()].slice(0, 6),
    teams,
    people,
    decisions,
    tasks,
    outcomes,
    dependencies,
    signals,
    bottleneckTalk,
    insufficient,
  };
}
