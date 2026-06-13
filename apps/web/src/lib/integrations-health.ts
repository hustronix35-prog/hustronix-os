/**
 * Frontend types + fetcher for `GET /api/integrations/health`. Mirrors the
 * shape emitted by `apps/api/src/integrations/connectionsHealth.ts`. Keep this
 * type in sync with the backend response — it is the contract for the
 * Settings → Connections panel.
 */
import { apiGet } from "@/lib/api";

export type IntegrationSurface = {
  kind: string;
  resource: string;
  expiresAt: string | null;
  minutesUntilExpiry: number | null;
  expired: boolean;
};

export type IntegrationHealth = {
  provider: string;
  label: string;
  connected: boolean;
  externalTeamName: string | null;
  scope: string | null;
  expiresAt: string | null;
  needsReauth: boolean;
  surfaces: IntegrationSurface[];
  lastSignalAt: string | null;
  signalCount24h: number;
};

export type IntegrationsHealthPayload = {
  ok: boolean;
  summary: {
    total: number;
    connected: number;
    needsReauth: number;
    expiringSoon: number;
  };
  providers: IntegrationHealth[];
};

export async function fetchIntegrationsHealth(): Promise<IntegrationsHealthPayload> {
  return apiGet<IntegrationsHealthPayload>("/api/integrations/health");
}

/**
 * Pretty time-until/ago helpers. Health data is high-frequency so we keep the
 * UI textual and reach for raw minutes only when sub-hour resolution matters.
 */
export function formatExpiry(minutesUntilExpiry: number | null): string {
  if (minutesUntilExpiry === null) return "—";
  if (minutesUntilExpiry < 0) {
    const m = Math.abs(minutesUntilExpiry);
    if (m < 60) return `expired ${m}m ago`;
    if (m < 24 * 60) return `expired ${Math.round(m / 60)}h ago`;
    return `expired ${Math.round(m / (24 * 60))}d ago`;
  }
  if (minutesUntilExpiry < 60) return `${minutesUntilExpiry}m`;
  if (minutesUntilExpiry < 24 * 60) {
    return `${Math.round(minutesUntilExpiry / 60)}h`;
  }
  return `${Math.round(minutesUntilExpiry / (24 * 60))}d`;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const ms = Date.now() - t;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/**
 * Human label for the subscription kind. These come from the backend without
 * a registry, so we map known kinds and fall back to a humanized form.
 */
const SURFACE_LABELS: Record<string, string> = {
  "github.repo": "Repository webhook",
  "microsoft.teams.channelMessage": "Teams channel messages",
  "microsoft.outlook.calendar": "Outlook calendar events",
  "microsoft.outlook.mail": "Outlook mail",
  "google.calendar.watch": "Google Calendar push",
  "gmail.poll": "Gmail history poll",
  "notion.poll": "Notion change poll",
  "jira.webhook": "Jira webhook",
  "linear.webhook": "Linear webhook",
};

export function labelSurface(kind: string): string {
  if (SURFACE_LABELS[kind]) return SURFACE_LABELS[kind];
  return kind
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
