/**
 * Customer-path ingest — blind artifacts → production transforms → ingestExternal.
 * Never writes scenario_id / event_type / playbook / ground_truth into the OS.
 */
import { ingestExternal, type IngestRecord } from "../ingestRouter.js";
import {
  transformCrmWebhook,
  transformGithubWebhook,
  transformGmailMessage,
  transformJiraWebhook,
  transformSlackEvent,
} from "../webhookTransforms.js";
import type { BlindCustomerArtifact, BlindCustomerBundle } from "./customerPathCorpus.js";
import { runSituationDetection } from "../../intelligence/situation-detect.js";
import { reprocessUnenrichedSignals } from "../../intelligence/index.js";
import { db } from "../../database.js";

export type CustomerIngestStats = {
  attempted: number;
  inserted: number;
  duplicates: number;
  errors: number;
  by_source: Record<string, { inserted: number; duplicates: number; errors: number }>;
};

function bump(
  stats: CustomerIngestStats,
  source: string,
  field: "inserted" | "duplicates" | "errors",
) {
  if (!stats.by_source[source]) stats.by_source[source] = { inserted: 0, duplicates: 0, errors: 0 };
  stats.by_source[source][field] += 1;
  stats[field] += 1;
}

function emptyStats(): CustomerIngestStats {
  return { attempted: 0, inserted: 0, duplicates: 0, errors: 0, by_source: {} };
}

function mergeStats(a: CustomerIngestStats, b: CustomerIngestStats): CustomerIngestStats {
  const out = emptyStats();
  out.attempted = a.attempted + b.attempted;
  out.inserted = a.inserted + b.inserted;
  out.duplicates = a.duplicates + b.duplicates;
  out.errors = a.errors + b.errors;
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src.by_source)) {
      if (!out.by_source[k]) out.by_source[k] = { inserted: 0, duplicates: 0, errors: 0 };
      out.by_source[k].inserted += v.inserted;
      out.by_source[k].duplicates += v.duplicates;
      out.by_source[k].errors += v.errors;
    }
  }
  return out;
}

function jiraKey(art: BlindCustomerArtifact): string {
  const n = Math.abs([...art.external_id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 900 + 100;
  return `OPS-${n}`;
}

function withCustomerMeta(rec: IngestRecord, art: BlindCustomerArtifact, userId: string): IngestRecord {
  return {
    ...rec,
    userId,
    externalId: art.external_id,
    tenantKey: "customer_path",
    detectedAt: art.timestamp,
    owner: art.author,
    meta: {
      ...(rec.meta || {}),
      integration_runtime: "customer_path",
      occurred_at: art.timestamp,
      channel: art.channel,
      project: art.project,
      customer: art.customer,
      artifact_type: art.artifact_type,
      source_system: art.source,
    },
  };
}

/** Build production-shaped ingest record(s) with customer-safe meta only. */
export function blindArtifactToIngestRecords(
  userId: string,
  art: BlindCustomerArtifact,
): IngestRecord[] {
  const delivery = art.external_id.replace(/^cust:/, "d-");

  switch (art.artifact_type) {
    case "slack_message":
      return [
        withCustomerMeta(
          transformSlackEvent({
            userId,
            teamId: "T-CUSTOMER",
            channelId: (art.channel || "ops").slice(0, 21),
            user: art.author.toLowerCase(),
            text: art.content,
            eventId: delivery,
            ts: `${art.day}.${String(art.seq).padStart(6, "0")}`,
          }),
          art,
          userId,
        ),
      ];
    case "jira_issue":
    case "support_ticket":
      return transformJiraWebhook(
        {
          webhookEvent: "jira:issue_updated",
          timestamp: Date.parse(art.timestamp) || Date.now(),
          issue: {
            key: jiraKey(art),
            fields: {
              summary: art.content.slice(0, 200),
              description: art.content,
              status: { name: "In Progress" },
              assignee: { emailAddress: `${art.author.toLowerCase()}@example.com` },
              reporter: { emailAddress: `${art.author.toLowerCase()}@example.com` },
            },
          },
        },
        { userId, bearerSecret: "customer", deliveryId: delivery },
      ).map((r) => withCustomerMeta(r, art, userId));
    case "github_pr": {
      const num = (art.seq % 800) + 20;
      return transformGithubWebhook(
        {
          action: "opened",
          repository: { full_name: "customer/platform" },
          sender: { login: art.author.toLowerCase() },
          pull_request: {
            number: num,
            title: art.content.slice(0, 120),
            body: art.content,
            merged: false,
            state: "open",
          },
        },
        { userId, deliveryId: delivery, event: "pull_request" },
      ).map((r) => withCustomerMeta(r, art, userId));
    }
    case "email_thread":
      return transformGmailMessage(
        {
          id: delivery,
          threadId: delivery,
          snippet: art.content.slice(0, 400),
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "Subject", value: art.content.slice(0, 90) },
              { name: "From", value: `${art.author} <${art.author.toLowerCase()}@example.com>` },
              { name: "To", value: "ops@example.com" },
              { name: "Date", value: art.timestamp },
            ],
          },
        },
        { userId, accountEmail: "ops@example.com", partition: "customer" },
      ).map((r) => withCustomerMeta(r, art, userId));
    case "crm_record":
      return transformCrmWebhook(
        {
          subscriptionType: "deal.propertyChange",
          objectId: art.customer || art.project || delivery,
          eventId: delivery,
          occurredAt: art.timestamp,
          actorId: art.author,
          propertyValue: { notes: art.content, account: art.customer },
        },
        { userId, bearerSecret: "customer", vendor: "hubspot" },
      ).map((r) => withCustomerMeta(r, art, userId));
    default:
      return [
        withCustomerMeta(
          {
            provider: art.source,
            subtype: `${art.source}.${art.artifact_type}`,
            userId,
            content: art.content,
            owner: art.author,
            source:
              art.source === "meeting"
                ? "MEETING"
                : art.source === "finance"
                  ? "FINANCE"
                  : art.source === "hris"
                    ? "HRIS"
                    : art.source === "incident" || art.source === "ops" || art.source === "metrics"
                      ? "INCIDENT"
                      : "MANUAL",
          } as IngestRecord,
          art,
          userId,
        ),
      ];
  }
}

function ingestOne(userId: string, art: BlindCustomerArtifact, stats: CustomerIngestStats) {
  stats.attempted += 1;
  try {
    const recs = blindArtifactToIngestRecords(userId, art);
    if (!recs.length) {
      bump(stats, art.source, "errors");
      return;
    }
    for (const rec of recs) {
      const out = ingestExternal(rec);
      if (out.duplicate) bump(stats, art.source, "duplicates");
      else bump(stats, art.source, "inserted");
    }
  } catch {
    bump(stats, art.source, "errors");
  }
}

export function ingestBlindBundle(
  userId: string,
  blind: BlindCustomerBundle,
  opts?: {
    order?: "timestamp" | "as_is";
    stream?: boolean;
    throughDay?: number;
    /** When false, caller runs situation_detect (chrono cadence). Default true. */
    detect?: boolean;
    onProgress?: (info: { index: number; total: number; art: BlindCustomerArtifact }) => void;
  },
): CustomerIngestStats {
  const stats = emptyStats();
  let arts = [...blind.artifacts];
  if (opts?.throughDay != null) {
    arts = arts.filter((a) => a.day <= opts.throughDay!);
  }
  if (opts?.order !== "as_is") {
    arts.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.seq - b.seq);
  }

  for (let i = 0; i < arts.length; i++) {
    const art = arts[i];
    opts?.onProgress?.({ index: i, total: arts.length, art });
    ingestOne(userId, art, stats);
    if (opts?.stream && (i + 1) % 5 === 0) {
      try {
        reprocessUnenrichedSignals(userId, 20);
      } catch {
        /* optional */
      }
      try {
        runSituationDetection(userId);
      } catch {
        /* optional */
      }
    }
  }

  if (opts?.detect !== false) {
    try {
      reprocessUnenrichedSignals(userId, 200);
    } catch {
      /* optional */
    }
    try {
      runSituationDetection(userId);
    } catch {
      /* optional */
    }
  }

  return stats;
}

/** Chronological: group by day → ingest → detect (no playbooks, no finalize). */
export function ingestChronological(
  userId: string,
  blind: BlindCustomerBundle,
  opts?: { throughDay?: number; detectEveryDays?: number },
): CustomerIngestStats & { detection_timeline: Record<string, number> } {
  const through = opts?.throughDay ?? 9999;
  const every = opts?.detectEveryDays ?? 1;
  const byDay = new Map<number, BlindCustomerArtifact[]>();
  for (const a of blind.artifacts) {
    if (a.day > through) continue;
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  let stats = emptyStats();
  let dayIndex = 0;
  const detection_timeline: Record<string, number> = {};

  const snapshotDetected = (): Set<string> => {
    const rows = db.rawGet(
      `SELECT decision_reasoning FROM decision_ledger WHERE user_id = ?`,
      [userId],
    ) as { decision_reasoning: string | null }[];
    const ids = new Set<string>();
    for (const r of rows) {
      try {
        const j = r.decision_reasoning ? JSON.parse(r.decision_reasoning) : null;
        if (j?.source === "situation_detect" && j?.situation_id) ids.add(String(j.situation_id));
      } catch {
        /* ignore */
      }
    }
    return ids;
  };

  let known = snapshotDetected();

  for (const day of days) {
    const slice: BlindCustomerBundle = {
      ...blind,
      artifacts: (byDay.get(day) || []).sort((a, b) => a.seq - b.seq),
    };
    const part = ingestBlindBundle(userId, slice, {
      order: "timestamp",
      detect: false,
    });
    stats = mergeStats(stats, part);
    dayIndex += 1;
    if (dayIndex % every === 0) {
      try {
        reprocessUnenrichedSignals(userId, 40);
      } catch {
        /* ignore */
      }
      try {
        runSituationDetection(userId, { simDay: day });
      } catch {
        /* ignore */
      }
      const now = snapshotDetected();
      for (const id of now) {
        if (!known.has(id) && detection_timeline[id] == null) {
          detection_timeline[id] = day;
        }
      }
      // Also track first awareness from situation objects (before DECISION_READY)
      const sits = db.rawGet(
        `SELECT pattern_id, awareness_day, forming_day, elevated_day, decision_ready_day, stage
         FROM situations WHERE user_id = ?`,
        [userId],
      ) as {
        pattern_id: string;
        awareness_day: number | null;
        forming_day: number | null;
        elevated_day: number | null;
        decision_ready_day: number | null;
        stage: string;
      }[];
      for (const s of sits) {
        const first =
          s.awareness_day ?? s.forming_day ?? s.elevated_day ?? s.decision_ready_day ?? null;
        if (first != null && detection_timeline[`aware:${s.pattern_id}`] == null) {
          detection_timeline[`aware:${s.pattern_id}`] = first;
        }
        if (s.decision_ready_day != null && detection_timeline[s.pattern_id] == null) {
          detection_timeline[s.pattern_id] = s.decision_ready_day;
        }
      }
      known = now;
    }
  }
  const finalDay = days[days.length - 1] ?? through;
  try {
    reprocessUnenrichedSignals(userId, 200);
  } catch {
    /* ignore */
  }
  try {
    runSituationDetection(userId, { simDay: finalDay });
  } catch {
    /* ignore */
  }
  const now = snapshotDetected();
  for (const id of now) {
    if (detection_timeline[id] == null) detection_timeline[id] = finalDay;
  }
  const sits = db.rawGet(
    `SELECT pattern_id, awareness_day, forming_day, elevated_day, decision_ready_day
     FROM situations WHERE user_id = ?`,
    [userId],
  ) as {
    pattern_id: string;
    awareness_day: number | null;
    forming_day: number | null;
    elevated_day: number | null;
    decision_ready_day: number | null;
  }[];
  for (const s of sits) {
    if (s.awareness_day != null) detection_timeline[`aware:${s.pattern_id}`] = s.awareness_day;
    if (s.forming_day != null) detection_timeline[`forming:${s.pattern_id}`] = s.forming_day;
    if (s.elevated_day != null) detection_timeline[`elevated:${s.pattern_id}`] = s.elevated_day;
    if (s.decision_ready_day != null) detection_timeline[s.pattern_id] = s.decision_ready_day;
  }

  return { ...stats, detection_timeline };
}
