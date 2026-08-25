/**
 * HSOG artifacts → production ingest transforms (Slack Events, Nango Slack,
 * Jira, GitHub, Gmail, HubSpot CRM, Google Calendar, meeting heuristic).
 */
import { db } from "../../database.js";
import { ingestExternal, ingestExternalBatch, type IngestRecord } from "../ingestRouter.js";
import {
  transformCrmWebhook,
  transformGithubWebhook,
  transformGmailMessage,
  transformGoogleCalendarEvent,
  transformJiraWebhook,
  transformSlackEvent,
} from "../webhookTransforms.js";
import { ingestNangoRecords } from "../nango/dispatcher.js";
import { ensureNangoTables, upsertNangoConnection, getNangoConnection } from "../nango/nangoStore.js";
import { extractHeuristic } from "../../intelligence/meetingIngestion.js";
import { simOccurredAt, evidenceProseForEvent } from "./artifactMap.js";
import type { HsogArtifact, HsogEvent, HsogIngestBundle } from "./types.js";

export type ChannelTally = Record<string, { attempted: number; inserted: number; duplicates: number; errors: number }>;

function bump(tally: ChannelTally, channel: string, field: "attempted" | "inserted" | "duplicates" | "errors", n = 1) {
  if (!tally[channel]) tally[channel] = { attempted: 0, inserted: 0, duplicates: 0, errors: 0 };
  tally[channel][field] += n;
}

function channelFor(atype: string): string {
  if (atype === "slack_message") return "slack";
  if (atype === "jira_issue" || atype === "support_ticket") return "jira";
  if (atype === "github_pr") return "github";
  if (atype === "email_thread") return "gmail";
  if (atype === "crm_record") return "crm";
  if (atype === "meeting_transcript") return "meeting";
  if (atype === "confluence_page") return "confluence";
  if (atype === "metric_snapshot" || atype === "pagerduty_alert" || atype === "siem_alert") return "ops_telemetry";
  if (atype === "incident_report") return "incident";
  if (atype === "finance_forecast" || atype === "finance_memo") return "finance";
  if (atype === "hris_record") return "hris";
  return "manual";
}

function stampMeta(rec: IngestRecord, event: HsogEvent, art: HsogArtifact, extra?: Record<string, unknown>): IngestRecord {
  rec.meta = {
    ...(rec.meta || {}),
    integration_runtime: extra?.runtime ?? "hsog-provider",
    hsog_scenario_id: event.scenario_id,
    hsog_event_id: event.event_id,
    hsog_event_type: event.event_type,
    artifact_id: art.artifact_id,
    artifact_type: art.artifact_type,
    evidence_quality: art.evidence_quality ?? "supporting",
    ground_truth_fact_ids: art.ground_truth_fact_ids || event.ground_truth_fact_ids || [],
    visibility_scope: art.visibility_scope || event.visibility_scope || null,
    occurred_at: extra?.occurred_at ?? simOccurredAt("2026-02-02", event.day),
    ...(extra || {}),
  };
  rec.externalId = `hsog:${art.artifact_id}`;
  rec.tenantKey = rec.tenantKey || `hsog:${event.scenario_id}`;
  rec.detectedAt = rec.detectedAt || simOccurredAt("2026-02-02", event.day);
  return rec;
}

function slackChannel(scope?: string): string {
  const s = (scope || "ops").replace(/^team:|^department:/, "");
  return s.slice(0, 21) || "ops";
}

function jiraKey(event: HsogEvent, art: HsogArtifact): string {
  const proj =
    event.scenario_id === "feature_quality_regression"
      ? "FLO"
      : event.scenario_id === "security_incident"
        ? "SEC"
        : event.scenario_id === "infrastructure_outage"
          ? "SIG"
          : "NEX";
  const n = Math.abs([...art.artifact_id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 900 + 100;
  return `${proj}-${n}`;
}

function artifactRecords(userId: string, event: HsogEvent, art: HsogArtifact, slackViaNango: boolean): IngestRecord[] {
  const actor = event.actors?.[0] || "unknown";
  const summary = (event.summary || event.event_type).trim();
  const facts = (art.ground_truth_fact_ids || event.ground_truth_fact_ids || []).join("; ");
  const prose = evidenceProseForEvent(event).join(" ");
  const body = [
    summary,
    facts ? `Ground truth: ${facts}` : "",
    prose,
    `Entities: ${(event.entity_ids || []).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (art.artifact_type === "slack_message" && !slackViaNango) {
    return [
      stampMeta(
        transformSlackEvent({
          userId,
          teamId: "T-HSOG",
          channelId: slackChannel(event.visibility_scope),
          user: actor.toLowerCase(),
          text: `${actor}: ${summary}${facts ? ` — ${facts}` : ""}${prose ? ` — ${prose}` : ""}`,
          eventId: `hsog-slack-${art.artifact_id}`,
          ts: `${event.day}.000001`,
        }),
        event,
        art,
      ),
    ];
  }

  if (art.artifact_type === "jira_issue" || art.artifact_type === "support_ticket") {
    return transformJiraWebhook(
      {
        webhookEvent: "jira:issue_updated",
        timestamp: Date.now(),
        issue: {
          key: jiraKey(event, art),
          fields: {
            summary,
            description: body,
            status: { name: event.event_type.includes("failed") ? "Blocked" : "In Progress" },
            assignee: { emailAddress: `${actor.toLowerCase()}@hustronix.io` },
            reporter: { emailAddress: `${actor.toLowerCase()}@hustronix.io` },
          },
        },
      },
      { userId, bearerSecret: "hsog", deliveryId: `hsog-jira-${art.artifact_id}` },
    ).map((r) => stampMeta(r, event, art));
  }

  if (art.artifact_type === "github_pr") {
    const num = Math.abs([...art.artifact_id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 800 + 20;
    return transformGithubWebhook(
      {
        action: "opened",
        repository: { full_name: "hustronix/platform" },
        sender: { login: actor.toLowerCase() },
        pull_request: {
          number: num,
          title: summary,
          body,
          merged: false,
          state: "open",
        },
      },
      { userId, deliveryId: `hsog-gh-${art.artifact_id}`, event: "pull_request" },
    ).map((r) => stampMeta(r, event, art));
  }

  if (art.artifact_type === "email_thread") {
    return transformGmailMessage(
      {
        id: art.artifact_id,
        threadId: event.event_id,
        snippet: summary.slice(0, 400),
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "Subject", value: `[${event.scenario_id}] ${summary.slice(0, 90)}` },
            { name: "From", value: `${actor} <${actor.toLowerCase()}@hustronix.io>` },
            { name: "To", value: "ops@hustronix.io" },
          ],
        },
      },
      { userId, accountEmail: "ops@hustronix.io", partition: "hsog" },
    ).map((r) => stampMeta(r, event, art));
  }

  if (art.artifact_type === "crm_record") {
    const account = (event.entity_ids || []).find((id) => !id.startsWith("PRJ-") && !["flowops", "signalgrid", "nexusai"].includes(id)) || "unknown_account";
    return transformCrmWebhook(
      {
        subscriptionType: "deal.propertyChange",
        objectId: account,
        eventId: art.artifact_id,
        occurredAt: simOccurredAt("2026-02-02", event.day),
        actorId: actor,
        propertyValue: { summary, health_note: body, scenario: event.scenario_id },
      },
      { userId, bearerSecret: "hsog", vendor: "hubspot" },
    ).map((r) => stampMeta(r, event, art));
  }

  if (art.artifact_type === "confluence_page") {
    return [
      stampMeta(
        {
          provider: "confluence",
          subtype: "confluence.page",
          userId,
          tenantKey: "hsog",
          content: `[confluence] ${summary}\n${body}`,
          owner: `confluence:${actor}`,
          externalId: `hsog:${art.artifact_id}`,
        },
        event,
        art,
      ),
    ];
  }

  if (art.artifact_type === "meeting_transcript") {
    return []; // handled via heuristic meeting fan-out
  }

  // Calendar stand-in for exec visibility meetings that aren't transcripts
  if (event.visibility_scope === "executive" && art.artifact_type === "metric_snapshot") {
    return transformGoogleCalendarEvent(
      {
        id: art.artifact_id,
        iCalUID: `${art.artifact_id}@hustronix.io`,
        status: "confirmed",
        summary: `Exec review: ${summary}`,
        description: body,
        start: { dateTime: simOccurredAt("2026-02-02", event.day) },
        end: { dateTime: simOccurredAt("2026-02-02", event.day, 15) },
        organizer: { email: `${actor.toLowerCase()}@hustronix.io` },
        attendees: (event.actors || []).map((a) => ({ email: `${a.toLowerCase()}@hustronix.io` })),
        updated: simOccurredAt("2026-02-02", event.day),
      },
      { userId, accountEmail: "ops@hustronix.io", partition: "hsog-cal" },
    ).map((r) => stampMeta(r, event, art));
  }

  const subtype = `${channelFor(art.artifact_type)}.${art.artifact_type}`;
  return [
    stampMeta(
      {
        provider: "manual",
        subtype,
        userId,
        tenantKey: "hsog",
        content: `[${art.artifact_type}] ${actor}: ${summary}\n${body}`,
        owner: `${channelFor(art.artifact_type)}:${actor}`,
        externalId: `hsog:${art.artifact_id}`,
      },
      event,
      art,
    ),
  ];
}

function ingestMeetingHeuristic(userId: string, event: HsogEvent, art: HsogArtifact): { inserted: number; duplicates: number; errors: number } {
  const actor = event.actors?.[0] || "unknown";
  const summary = event.summary || event.event_type;
  const prose = evidenceProseForEvent(event).join(" ");
  const transcript = [
    `${actor} opened the ${event.scenario_id.replace(/_/g, " ")} review on day ${event.day}.`,
    summary,
    prose,
    `We will treat this as a company operating issue and not a generic delay.`,
    `@${actor} will own the follow-up by Friday and send the written update.`,
    `We cannot proceed without cited evidence from engineering and customer success.`,
    `The work is blocked by incomplete ${art.artifact_type.replace(/_/g, " ")} until ${summary}.`,
    `Priya and Elena disagree on whether launch pressure should override reliability.`,
  ]
    .filter(Boolean)
    .join(" ");
  const items = extractHeuristic(transcript);
  try {
    const rec = stampMeta(
      {
        provider: "meeting",
        subtype: "meeting.transcript",
        userId,
        tenantKey: `hsog:${event.scenario_id}`,
        content: `[meeting] ${summary}\n${transcript}`,
        owner: `meeting:${actor}`,
        externalId: `hsog:${art.artifact_id}`,
      },
      event,
      art,
      { extracted_items: items.slice(0, 8), extracted_count: items.length },
    );
    const out = ingestExternal(rec);
    return {
      inserted: out.duplicate ? 0 : 1,
      duplicates: out.duplicate ? 1 : 0,
      errors: 0,
    };
  } catch {
    return { inserted: 0, duplicates: 0, errors: 1 };
  }
}

export function ingestHsogViaProviders(userId: string, bundle: HsogIngestBundle): ChannelTally {
  const tally: ChannelTally = {};
  const slackArts: { event: HsogEvent; art: HsogArtifact }[] = [];
  const other: IngestRecord[] = [];
  const meetings: { event: HsogEvent; art: HsogArtifact }[] = [];

  for (const event of bundle.events || []) {
    for (const art of event.artifacts || []) {
      const ch = channelFor(art.artifact_type);
      bump(tally, ch, "attempted");
      if (art.artifact_type === "meeting_transcript") {
        meetings.push({ event, art });
        continue;
      }
      if (art.artifact_type === "slack_message") {
        slackArts.push({ event, art });
        continue;
      }
      other.push(...artifactRecords(userId, event, art, false));
    }
  }

  const slackEvents = slackArts.filter((_, i) => i % 2 === 0);
  const slackNango = slackArts.filter((_, i) => i % 2 === 1);

  const slackRecs = slackEvents.flatMap(({ event, art }) => artifactRecords(userId, event, art, false));
  const batch = ingestExternalBatch([...other, ...slackRecs]);
  for (const r of batch.results) {
    const st = (r.subtype || "").toLowerCase();
    const ch =
      r.source === "SLACK"
        ? "slack"
        : r.source === "JIRA"
          ? "jira"
          : r.source === "GITHUB"
            ? "github"
            : r.source === "GMAIL"
              ? "gmail"
              : r.source === "GOOGLE"
                ? "calendar"
                : r.source === "CRM"
                  ? "crm"
                  : r.source === "MEETING"
                    ? "meeting"
                    : r.source === "FINANCE"
                      ? "finance"
                      : r.source === "HRIS"
                        ? "hris"
                        : r.source === "INCIDENT"
                          ? st.includes("metric")
                            ? "ops_telemetry"
                            : "incident"
                          : st.includes("confluence")
                            ? "confluence"
                            : st.includes("metric") || st.includes("pager") || st.includes("siem")
                              ? "ops_telemetry"
                              : "manual";
    if (r.duplicate) bump(tally, ch, "duplicates");
    else bump(tally, ch, "inserted");
  }
  bump(tally, "transform_errors", "errors", batch.errors.length);

  if (slackNango.length) {
    ensureNangoTables();
    upsertNangoConnection({
      userId,
      provider: "slack",
      integrationId: "slack",
      connectionId: `hsog-slack-${userId.slice(0, 8)}`,
      connectionName: "HSOG Slack",
    });
    const conn = getNangoConnection(userId, "slack");
    if (conn) {
      const records = slackNango.map(({ event, art }, i) => ({
        id: `C-HSOG.${art.artifact_id}.${i}`,
        channel_id: slackChannel(event.visibility_scope),
        channel_name: slackChannel(event.visibility_scope),
        user_id: `U-${(event.actors?.[0] || "unknown").toUpperCase()}`,
        user_name: event.actors?.[0] || "unknown",
        text: `${event.actors?.[0] || "unknown"}: ${event.summary || event.event_type}`,
        timestamp: `${100000 + event.day}.${String(i).padStart(6, "0")}`,
        created_at: simOccurredAt("2026-02-02", event.day),
        is_thread_reply: false,
        _nango_metadata: { cursor: `hsog-${art.artifact_id}`, last_action: "added" as const },
      }));
      const nangoOut = ingestNangoRecords({
        conn,
        integrationId: "slack",
        model: "Message",
        records,
      });
      bump(tally, "slack_nango", "attempted", records.length);
      bump(tally, "slack_nango", "inserted", nangoOut.ingested);
      bump(tally, "slack_nango", "duplicates", nangoOut.duplicates);
      bump(tally, "slack_nango", "errors", nangoOut.errors.length);
      // stamp scenario meta on nango rows (adapter doesn't know HSOG)
      for (const { event, art } of slackNango) {
        dbStampNangoMeta(userId, art.artifact_id, event, art);
      }
    }
  }

  for (const m of meetings) {
    const out = ingestMeetingHeuristic(userId, m.event, m.art);
    bump(tally, "meeting", "inserted", out.inserted);
    bump(tally, "meeting", "duplicates", out.duplicates);
    bump(tally, "meeting", "errors", out.errors);
  }

  return tally;
}

function dbStampNangoMeta(userId: string, artifactId: string, event: HsogEvent, art: HsogArtifact): void {
  const rows = db.rawGet(
    `SELECT id, ingest_meta FROM external_signals
     WHERE user_id = ? AND source = 'SLACK'
       AND (external_id LIKE ? OR ingest_meta LIKE ?)
     LIMIT 4`,
    [userId, `%${artifactId}%`, `%${artifactId}%`],
  ) as { id: string; ingest_meta: string | null }[];
  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = row.ingest_meta ? JSON.parse(row.ingest_meta) : {};
    } catch {
      meta = {};
    }
    meta.hsog_scenario_id = event.scenario_id;
    meta.hsog_event_id = event.event_id;
    meta.artifact_id = art.artifact_id;
    meta.artifact_type = "slack_message";
    meta.evidence_quality = art.evidence_quality ?? "supporting";
    meta.ground_truth_fact_ids = art.ground_truth_fact_ids || event.ground_truth_fact_ids || [];
    meta.integration_runtime = meta.integration_runtime || "nango";
    db.rawRun(`UPDATE external_signals SET ingest_meta = ? WHERE id = ?`, [JSON.stringify(meta), row.id]);
  }
}
