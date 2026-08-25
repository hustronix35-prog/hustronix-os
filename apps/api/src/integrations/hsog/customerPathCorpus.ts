/**
 * Customer-path HSOG testing — dual corpus (ground truth vs blind input).
 *
 * Ground truth is NEVER written into ingest_meta or signal content.
 * Blind records look like real Slack/Jira/Gmail/… payloads.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";
import type { HsogArtifact, HsogEvent, HsogIngestBundle, HsogPerson } from "./types.js";
import { simOccurredAt, routeArtifactType } from "./artifactMap.js";
import { SITUATION_PATTERNS } from "../../intelligence/situation-patterns.js";
import { buildScenarioTiming } from "./intelligenceLeadEval.js";

/** Evaluator-only. Never pass to ingestExternal. */
export type HsogGroundTruth = {
  version: 1;
  source_bundle: string;
  start_date: string;
  scenarios: Array<{
    id: string;
    title: string;
    start_day: number;
    end_day: number;
    event_count: number;
    artifact_ids: string[];
    artifact_types: string[];
    people: string[];
    teams: string[];
    event_types: string[];
    /** Keywords used only by the evaluator to score detection (not ingested). */
    detection_keywords: string[];
    expected_situation_pattern_id: string | null;
    /** First day any artifact for this scenario appears. */
    first_evidence_day: number;
    /** Day the labeled corpus would fire a DECISION_TRIGGER (evaluator only). */
    declaration_day: number | null;
    declaration_event_type: string | null;
  }>;
  artifacts: Array<{
    artifact_id: string;
    artifact_type: string;
    scenario_id: string;
    event_id: string;
    day: number;
    actors: string[];
    visibility_scope: string | null;
    summary: string;
    /** Opaque id used in blind ingest — evaluator maps back. */
    blind_external_id: string;
  }>;
  people: HsogPerson[];
};

/** What a customer integration would deliver. */
export type BlindCustomerArtifact = {
  source: string;
  artifact_type: string;
  timestamp: string;
  author: string;
  channel: string | null;
  project: string | null;
  customer: string | null;
  content: string;
  /** Opaque external id for idempotency — no scenario semantics. */
  external_id: string;
  day: number;
  /** Stable sort key from original chronology (evaluator may use; ingest may ignore). */
  seq: number;
};

export type BlindCustomerBundle = {
  version: 1;
  kind: "customer_path_blind";
  start_date: string;
  max_days: number;
  company?: Record<string, unknown>;
  people?: HsogPerson[];
  artifacts: BlindCustomerArtifact[];
  /** Intentionally empty — scenarios live only in ground truth. */
  note: string;
};

function opaqueExternalId(artifactId: string): string {
  const h = crypto.createHash("sha256").update(artifactId).digest("hex").slice(0, 20);
  return `cust:${h}`;
}

function channelFromScope(scope?: string | null): string | null {
  if (!scope) return null;
  return scope.replace(/^team:|^department:|^channel:/, "").slice(0, 48) || null;
}

function projectFromEntities(ids: string[]): string | null {
  return ids.find((id) => id.startsWith("PRJ-")) || null;
}

function customerFromEntities(ids: string[]): string | null {
  const PRODUCTS = new Set(["flowops", "signalgrid", "nexusai"]);
  return ids.find((id) => id.includes("_") && !id.startsWith("fact_") && !PRODUCTS.has(id)) || null;
}

function sourceForType(artifactType: string): string {
  const r = routeArtifactType(artifactType);
  if (artifactType === "slack_message") return "slack";
  if (artifactType === "jira_issue" || artifactType === "support_ticket") return "jira";
  if (artifactType === "github_pr") return "github";
  if (artifactType === "email_thread") return "gmail";
  if (artifactType === "crm_record") return "crm";
  if (artifactType === "meeting_transcript") return "meeting";
  if (artifactType === "confluence_page") return "confluence";
  if (artifactType.includes("finance")) return "finance";
  if (artifactType === "hris_record") return "hris";
  if (artifactType === "siem_alert" || artifactType === "pagerduty_alert") return "ops";
  if (artifactType === "metric_snapshot") return "metrics";
  if (artifactType === "incident_report") return "incident";
  return r.provider || "manual";
}

/** Customer-facing body — summary + natural framing. No scenario labels / GT ids. */
export function blindContentFor(event: HsogEvent, art: HsogArtifact): string {
  const actor = event.actors?.[0] || "teammate";
  const summary = String(event.summary || "").trim() || "Update posted.";
  const channel = channelFromScope(art.visibility_scope || event.visibility_scope);
  const others = (event.actors || []).slice(1).join(", ");

  switch (art.artifact_type) {
    case "slack_message":
      return others
        ? `${actor} in #${channel || "ops"}: ${summary} (cc ${others})`
        : `${actor} in #${channel || "ops"}: ${summary}`;
    case "jira_issue":
    case "support_ticket":
      return `${art.artifact_type === "support_ticket" ? "Support ticket" : "Jira"}: ${summary}. Owner: ${actor}.`;
    case "github_pr":
      return `Pull request by ${actor}: ${summary}`;
    case "email_thread":
      return `Email from ${actor}: ${summary}`;
    case "meeting_transcript":
      return `Meeting notes (${(event.actors || [actor]).join(", ")}): ${summary}. Action items will follow in writing.`;
    case "crm_record":
      return `CRM update (${actor}): ${summary}`;
    case "confluence_page":
      return `Doc update by ${actor}: ${summary}`;
    case "siem_alert":
      return `SIEM alert: ${summary}`;
    case "incident_report":
      return `Incident report (${actor}): ${summary}`;
    case "metric_snapshot":
      return `Metrics snapshot: ${summary}`;
    case "pagerduty_alert":
      return `PagerDuty: ${summary}`;
    case "finance_forecast":
    case "finance_memo":
      return `Finance note (${actor}): ${summary}`;
    case "hris_record":
      return `HRIS: ${summary}`;
    default:
      return `${actor}: ${summary}`;
  }
}

const LEAK_RE =
  /hsog_scenario|scenario_id|event_type|playbook|ground_truth|expected_decision|product_launch_slip|customer_churn_risk|security_incident|infrastructure_outage|sales_forecast_miss|hiring_freeze|enterprise_deal_red_flags|feature_quality_regression/i;

function assertNoLeak(text: string, where: string) {
  if (LEAK_RE.test(text)) {
    throw new Error(`Blind corpus leak in ${where}: matched forbidden label pattern`);
  }
}

export function buildGroundTruth(bundle: HsogIngestBundle, sourcePath: string): HsogGroundTruth {
  const start = bundle.start_date || "2026-02-02";
  const byScenario = new Map<string, HsogEvent[]>();
  for (const ev of bundle.events || []) {
    const list = byScenario.get(ev.scenario_id) || [];
    list.push(ev);
    byScenario.set(ev.scenario_id, list);
  }

  const artifacts: HsogGroundTruth["artifacts"] = [];
  const scenarios: HsogGroundTruth["scenarios"] = [];

  const timing = buildScenarioTiming(bundle);
  const timingBy = new Map(timing.map((t) => [t.scenario_id, t]));

  for (const [sid, events] of byScenario) {
    const days = events.map((e) => e.day).filter((d) => d > 0);
    const arts = events.flatMap((e) => e.artifacts || []);
    const people = [...new Set(events.flatMap((e) => e.actors || []))];
    const teams = [
      ...new Set(
        events
          .map((e) => channelFromScope(e.visibility_scope))
          .filter((t): t is string => !!t),
      ),
    ];
    const meta = (bundle.scenarios || []).find((s) => s.id === sid);
    const pattern = SITUATION_PATTERNS.find((p) => p.id === sid) || null;
    const tm = timingBy.get(sid);
    scenarios.push({
      id: sid,
      title: meta?.title || sid.replace(/_/g, " "),
      start_day: days.length ? Math.min(...days) : 0,
      end_day: days.length ? Math.max(...days) : 0,
      event_count: events.length,
      artifact_ids: arts.map((a) => a.artifact_id),
      artifact_types: [...new Set(arts.map((a) => a.artifact_type))],
      people,
      teams,
      event_types: [...new Set(events.map((e) => e.event_type))],
      detection_keywords: pattern?.keywords?.map((k) => k.trim().toLowerCase()).filter(Boolean) || [],
      expected_situation_pattern_id: pattern ? pattern.id : null,
      first_evidence_day: tm?.first_evidence_day ?? (days.length ? Math.min(...days) : 0),
      declaration_day: tm?.declaration_day ?? null,
      declaration_event_type: tm?.declaration_event_type ?? null,
    });
    for (const ev of events) {
      for (const art of ev.artifacts || []) {
        artifacts.push({
          artifact_id: art.artifact_id,
          artifact_type: art.artifact_type,
          scenario_id: sid,
          event_id: ev.event_id,
          day: ev.day,
          actors: ev.actors || [],
          visibility_scope: art.visibility_scope || ev.visibility_scope || null,
          summary: ev.summary || "",
          blind_external_id: opaqueExternalId(art.artifact_id),
        });
      }
    }
  }

  scenarios.sort((a, b) => a.start_day - b.start_day || a.id.localeCompare(b.id));
  return {
    version: 1,
    source_bundle: sourcePath,
    start_date: start,
    scenarios,
    artifacts,
    people: bundle.people || [],
  };
}

export function buildBlindBundle(bundle: HsogIngestBundle): BlindCustomerBundle {
  const start = bundle.start_date || "2026-02-02";
  const artifacts: BlindCustomerArtifact[] = [];
  let seq = 0;
  const events = [...(bundle.events || [])].sort((a, b) => a.day - b.day || a.event_id.localeCompare(b.event_id));

  for (const ev of events) {
    for (const art of ev.artifacts || []) {
      const content = blindContentFor(ev, art);
      assertNoLeak(content, art.artifact_id);
      const entities = art.related_entity_ids?.length ? art.related_entity_ids : ev.entity_ids || [];
      const hour = 9 + (seq % 8);
      const ts = simOccurredAt(start, ev.day, hour);
      const external_id = opaqueExternalId(art.artifact_id);
      artifacts.push({
        source: sourceForType(art.artifact_type),
        artifact_type: art.artifact_type,
        timestamp: ts,
        author: ev.actors?.[0] || "unknown",
        channel: channelFromScope(art.visibility_scope || ev.visibility_scope),
        project: projectFromEntities(entities),
        customer: customerFromEntities(entities),
        content,
        external_id,
        day: ev.day,
        seq: seq++,
      });
    }
  }

  return {
    version: 1,
    kind: "customer_path_blind",
    start_date: start,
    max_days: bundle.max_days || 132,
    company: bundle.company,
    people: bundle.people,
    artifacts,
    note: "No scenario_id, event_type, playbook, or ground_truth fields. Evaluator uses ground_truth.json only.",
  };
}

export function defaultHsogDataDir(repoRoot: string): string {
  return resolve(repoRoot, "data/hsog");
}

export function exportDualCorpus(bundle: HsogIngestBundle, sourcePath: string, outDir: string): {
  groundTruthPath: string;
  blindPath: string;
  groundTruth: HsogGroundTruth;
  blind: BlindCustomerBundle;
} {
  mkdirSync(outDir, { recursive: true });
  const groundTruth = buildGroundTruth(bundle, sourcePath);
  const blind = buildBlindBundle(bundle);
  const groundTruthPath = resolve(outDir, "ground_truth.json");
  const blindPath = resolve(outDir, "os_ingest_blind.json");
  writeFileSync(groundTruthPath, JSON.stringify(groundTruth, null, 2));
  writeFileSync(blindPath, JSON.stringify(blind, null, 2));
  return { groundTruthPath, blindPath, groundTruth, blind };
}

export function loadBlindBundle(path: string): BlindCustomerBundle {
  return JSON.parse(readFileSync(path, "utf8")) as BlindCustomerBundle;
}

export function loadGroundTruth(path: string): HsogGroundTruth {
  return JSON.parse(readFileSync(path, "utf8")) as HsogGroundTruth;
}

export function filterBlindBySources(
  blind: BlindCustomerBundle,
  sources: string[],
): BlindCustomerBundle {
  const set = new Set(sources.map((s) => s.toLowerCase()));
  return {
    ...blind,
    artifacts: blind.artifacts.filter((a) => set.has(a.source.toLowerCase())),
  };
}

export function filterBlindByScenario(
  blind: BlindCustomerBundle,
  gt: HsogGroundTruth,
  scenarioId: string,
): BlindCustomerBundle {
  const ext = new Set(
    gt.artifacts.filter((a) => a.scenario_id === scenarioId).map((a) => a.blind_external_id),
  );
  return {
    ...blind,
    artifacts: blind.artifacts.filter((a) => ext.has(a.external_id)),
  };
}

/** ~80% noise / 15% weak / keep serious as-is — synthetic ambient traffic. */
export function injectNoise(
  blind: BlindCustomerBundle,
  opts?: { noiseRatio?: number; seed?: number },
): BlindCustomerBundle {
  const ratio = opts?.noiseRatio ?? 0.8;
  const serious = blind.artifacts;
  const targetNoise = Math.round((serious.length * ratio) / Math.max(1 - ratio, 0.05));
  const noise: BlindCustomerArtifact[] = [];
  const phrases = [
    "Deploying a minor patch tomorrow.",
    "Can someone review this when free?",
    "Customer asked for pricing deck.",
    "Lunch and learn moved to Thursday.",
    "FYI: wiki cleanup in progress.",
    "Standup notes look good.",
    "Reminder: expense reports due Friday.",
    "Shared the design mock in Figma.",
  ];
  let n = opts?.seed ?? 42;
  const rnd = () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 0xffffffff;
  };
  for (let i = 0; i < targetNoise; i++) {
    const day = 20 + Math.floor(rnd() * 100);
    const author = ["Alex", "Sam", "Casey", "Riley"][Math.floor(rnd() * 4)];
    const phrase = phrases[Math.floor(rnd() * phrases.length)];
    noise.push({
      source: "slack",
      artifact_type: "slack_message",
      timestamp: simOccurredAt(blind.start_date, day, 10 + Math.floor(rnd() * 6)),
      author,
      channel: "general",
      project: null,
      customer: null,
      content: `${author} in #general: ${phrase}`,
      external_id: opaqueExternalId(`noise_slack_${i}`),
      day,
      seq: 10_000 + i,
    });
  }
  return {
    ...blind,
    artifacts: [...serious, ...noise].sort((a, b) => a.day - b.day || a.seq - b.seq),
  };
}

/** Conflicting launch narratives (product vs eng vs marketing vs CEO). */
export function injectConflicts(blind: BlindCustomerBundle): BlindCustomerBundle {
  const day = 75;
  const extras: BlindCustomerArtifact[] = [
    {
      source: "slack",
      artifact_type: "slack_message",
      timestamp: simOccurredAt(blind.start_date, day, 10),
      author: "Imani",
      channel: "product",
      project: null,
      customer: null,
      content: "Imani in #product: Launch is on track for the committed date.",
      external_id: opaqueExternalId("conflict_product_on_track"),
      day,
      seq: 20_001,
    },
    {
      source: "slack",
      artifact_type: "slack_message",
      timestamp: simOccurredAt(blind.start_date, day, 11),
      author: "Ethan",
      channel: "engineering",
      project: null,
      customer: null,
      content: "Ethan in #engineering: Payment integration is still blocked — cannot ship.",
      external_id: opaqueExternalId("conflict_eng_blocked"),
      day,
      seq: 20_002,
    },
    {
      source: "slack",
      artifact_type: "slack_message",
      timestamp: simOccurredAt(blind.start_date, day, 12),
      author: "Helen",
      channel: "marketing",
      project: null,
      customer: null,
      content: "Helen in #marketing: Waiting on the final launch date before we schedule the campaign.",
      external_id: opaqueExternalId("conflict_mkt_waiting"),
      day,
      seq: 20_003,
    },
    {
      source: "gmail",
      artifact_type: "email_thread",
      timestamp: simOccurredAt(blind.start_date, day, 13),
      author: "CEO",
      channel: null,
      project: null,
      customer: "acme",
      content: "Email from CEO: Customers were promised Aug 20 — do not slip silently.",
      external_id: opaqueExternalId("conflict_ceo_promise"),
      day,
      seq: 20_004,
    },
  ];
  for (const e of extras) assertNoLeak(e.content, e.external_id);
  return {
    ...blind,
    artifacts: [...blind.artifacts, ...extras].sort((a, b) => a.day - b.day || a.seq - b.seq),
  };
}

/** Shuffle ingest order while preserving timestamps (tests reconstruction). */
export function outOfOrderCopy(blind: BlindCustomerBundle, seed = 7): BlindCustomerBundle {
  const arts = [...blind.artifacts];
  let n = seed;
  const rnd = () => {
    n = (n * 1103515245 + 12345) >>> 0;
    return n / 0xffffffff;
  };
  for (let i = arts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arts[i], arts[j]] = [arts[j], arts[i]];
  }
  return { ...blind, artifacts: arts };
}

export function ensureDualCorpusOnDisk(
  bundle: HsogIngestBundle,
  sourcePath: string,
  outDir: string,
  force = false,
): { groundTruthPath: string; blindPath: string; groundTruth: HsogGroundTruth; blind: BlindCustomerBundle } {
  const groundTruthPath = resolve(outDir, "ground_truth.json");
  const blindPath = resolve(outDir, "os_ingest_blind.json");
  if (!force && existsSync(groundTruthPath) && existsSync(blindPath)) {
    return {
      groundTruthPath,
      blindPath,
      groundTruth: loadGroundTruth(groundTruthPath),
      blind: loadBlindBundle(blindPath),
    };
  }
  return exportDualCorpus(bundle, sourcePath, outDir);
}
