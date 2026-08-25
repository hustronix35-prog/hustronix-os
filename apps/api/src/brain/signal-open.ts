import { db } from "../database.js";

export type SignalOpenTarget = {
  label: string;
  url: string;
  section: string;
};

export type SignalOpenRow = {
  source: string;
  source_subtype?: string | null;
  external_id?: string | null;
  content?: string | null;
  ingest_meta?: string | null;
  owner?: string | null;
};

const URL_KEYS = [
  "html_url",
  "permalink",
  "webUrl",
  "webLink",
  "htmlLink",
  "browseUrl",
  "issueUrl",
  "url",
  "link",
  "href",
  "self",
];

export function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
}

function firstHttp(meta: Record<string, unknown>, keys = URL_KEYS): string | null {
  for (const k of keys) {
    if (isHttpUrl(meta[k])) return String(meta[k]).trim();
  }
  for (const v of Object.values(meta)) {
    if (isHttpUrl(v)) return String(v).trim();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = firstHttp(v as Record<string, unknown>, keys);
      if (nested) return nested;
    }
  }
  return null;
}

export function jiraBrowseUrl(opts: {
  self?: string | null;
  cloudUrl?: string | null;
  issueKey?: string | null;
}): string | null {
  const key = String(opts.issueKey || "").trim();
  const cloud = String(opts.cloudUrl || "").trim().replace(/\/$/, "");
  if (cloud && key) return `${cloud}/browse/${encodeURIComponent(key)}`;
  const self = String(opts.self || "").trim();
  if (self && key) {
    try {
      return `${new URL(self).origin}/browse/${encodeURIComponent(key)}`;
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function slackArchiveUrl(meta: Record<string, unknown>): string | null {
  const channel = String(meta.channel || meta.channelId || "").trim();
  const team = String(meta.teamId || meta.team || "").trim();
  const ts = String(meta.ts || "").trim();
  const thread = String(meta.threadTs || meta.thread_ts || "").trim();
  if (!channel) return null;
  if (team) {
    const base = `https://app.slack.com/client/${encodeURIComponent(team)}/${encodeURIComponent(channel)}`;
    const stamp = (thread || ts).replace(/\./g, "");
    return stamp ? `${base}/${stamp}` : base;
  }
  if (ts) {
    const p = `p${ts.replace(/\./g, "")}`;
    return `https://slack.com/archives/${encodeURIComponent(channel)}/${p}`;
  }
  return null;
}

export function githubBrowse(meta: Record<string, unknown>, subtype?: string | null): SignalOpenTarget[] {
  const html = firstHttp(meta, ["html_url", "permalink", "url"]);
  const repo = String(meta.repo || "").trim();
  const number = String(meta.number || "").trim();
  const event = `${subtype || ""} ${meta.event || ""}`.toLowerCase();
  const out: SignalOpenTarget[] = [];
  if (html && !/\/rest\/api\//i.test(html)) {
    out.push({ label: "Open on GitHub", url: html, section: "item" });
  } else if (repo && number) {
    const kind = /pull_request|\.pr\b|\/pull/.test(event) ? "pull" : "issues";
    const url = `https://github.com/${repo}/${kind}/${number}`;
    out.push({
      label: kind === "pull" ? "Open pull request" : "Open issue",
      url,
      section: "item",
    });
    if (kind === "pull") out.push({ label: "Files changed", url: `${url}/files`, section: "files" });
    if (/comment/.test(event)) out.push({ label: "Conversation", url, section: "comments" });
  } else if (repo) {
    out.push({ label: "Open repository", url: `https://github.com/${repo}`, section: "repo" });
  }
  return dedupeTargets(out);
}

export function jiraCloudUrlForUser(userId: string): string | null {
  if (!userId || userId === "system") return null;
  const rows = db.rawGet(
    `SELECT s.meta FROM oauth_subscriptions s
     INNER JOIN oauth_connections c ON c.id = s.connection_id
     WHERE c.user_id = ? AND lower(c.provider) = 'jira' AND c.revoked_at IS NULL
     ORDER BY s.created_at DESC LIMIT 8`,
    [userId],
  ) as Array<{ meta: string | null }>;
  for (const r of rows) {
    const m = parseMeta(r.meta);
    const url = String(m.cloudUrl || m.url || "").trim();
    if (/^https?:\/\//i.test(url)) return url.replace(/\/$/, "");
  }
  return null;
}

function dedupeTargets(targets: SignalOpenTarget[]): SignalOpenTarget[] {
  const seen = new Set<string>();
  const out: SignalOpenTarget[] = [];
  for (const t of targets) {
    if (!isHttpUrl(t.url)) continue;
    const key = `${t.section}|${t.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function resolveSignalOpenTargets(row: SignalOpenRow, opts?: { jiraCloudUrl?: string | null }): SignalOpenTarget[] {
  const source = String(row.source || "").toUpperCase();
  const subtype = String(row.source_subtype || "");
  const meta = parseMeta(row.ingest_meta);
  const content = String(row.content || "");
  const out: SignalOpenTarget[] = [];

  if (source === "JIRA") {
    const issueKey =
      String(meta.issueKey || meta.issue_key || "").trim() ||
      (content.match(/\b([A-Z][A-Z0-9]+-\d+)\b/) || [])[1] ||
      "";
    const browse = jiraBrowseUrl({
      self: isHttpUrl(meta.self) ? String(meta.self) : null,
      cloudUrl: (isHttpUrl(meta.cloudUrl) ? String(meta.cloudUrl) : null) || opts?.jiraCloudUrl || null,
      issueKey,
    });
    if (browse) {
      out.push({ label: issueKey ? `Open ${issueKey} in Jira` : "Open in Jira", url: browse, section: "issue" });
      const commentId = String(meta.commentId || meta.comment_id || "").trim();
      if (commentId) {
        out.push({
          label: "Open comment",
          url: `${browse}?focusedCommentId=${encodeURIComponent(commentId)}`,
          section: "comments",
        });
      } else if (/comment/i.test(subtype) || /comment/i.test(String(meta.eventType || meta.event || ""))) {
        out.push({ label: "Open comments", url: `${browse}?page=com.atlassian.jira.plugin.system.issuetabpanels:comment-tabpanel`, section: "comments" });
      }
    }
  } else if (source === "GITHUB") {
    out.push(...githubBrowse(meta, subtype));
  } else if (source === "LINEAR") {
    const url = firstHttp(meta, ["url", "html_url"]);
    const identifier = String(meta.identifier || meta.issueId || "").trim();
    if (url) out.push({ label: identifier ? `Open ${identifier} in Linear` : "Open in Linear", url, section: "issue" });
    else if (identifier) out.push({ label: `Open ${identifier} in Linear`, url: `https://linear.app/issue/${encodeURIComponent(identifier)}`, section: "issue" });
  } else if (source === "SLACK") {
    const permalink = slackArchiveUrl(meta);
    if (permalink) out.push({ label: "Open in Slack", url: permalink, section: /thread/i.test(subtype) ? "thread" : "message" });
  } else if (source === "NOTION") {
    const url = firstHttp(meta, ["url", "html_url"]);
    if (url) out.push({ label: "Open in Notion", url, section: "page" });
  } else {
    const url = firstHttp(meta);
    if (url && !/\/rest\/api\//i.test(url)) {
      out.push({ label: `Open in ${source || "source"}`, url, section: "item" });
    }
  }

  return dedupeTargets(out);
}
