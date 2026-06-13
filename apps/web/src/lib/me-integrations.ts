export type IntegrationKey =
  | "slack"
  | "github"
  | "googleCalendar"
  | "notion"
  | "gmail";

export interface IntegrationStatus {
  label: string;
  connected: boolean;
}

export type MeIntegrations = Record<IntegrationKey, IntegrationStatus>;

/** Alias used by settings/profile clients for `/api/me` integrations slice. */
export type MeIntegrationsPayload = MeIntegrations;

const CANONICAL_LABELS: Record<IntegrationKey, string> = {
  slack: "Slack",
  github: "GitHub",
  googleCalendar: "Google Calendar",
  notion: "Notion",
  gmail: "Gmail",
};

export const INTEGRATION_ORDER: IntegrationKey[] = [
  "slack",
  "github",
  "googleCalendar",
  "notion",
  "gmail",
];

export const DEFAULT_INTEGRATIONS: MeIntegrations = {
  slack: { label: CANONICAL_LABELS.slack, connected: false },
  github: { label: CANONICAL_LABELS.github, connected: false },
  googleCalendar: { label: CANONICAL_LABELS.googleCalendar, connected: false },
  notion: { label: CANONICAL_LABELS.notion, connected: false },
  gmail: { label: CANONICAL_LABELS.gmail, connected: false },
};

/**
 * Coerces `/api/me` `integrations` into a full record. Missing or invalid keys
 * use canonical labels and `connected: false`. `connected` is only true when
 * the source explicitly has `connected === true`.
 */
export function normalizeMeIntegrations(raw: unknown): MeIntegrations {
  const next: MeIntegrations = { ...DEFAULT_INTEGRATIONS };
  if (!raw || typeof raw !== "object") return next;

  const o = raw as Record<string, unknown>;
  for (const key of INTEGRATION_ORDER) {
    const entry = o[key];
    const canonical = CANONICAL_LABELS[key];
    if (!entry || typeof entry !== "object") {
      next[key] = { label: canonical, connected: false };
      continue;
    }
    const e = entry as Record<string, unknown>;
    const label =
      typeof e.label === "string" && e.label.trim().length > 0
        ? e.label.trim()
        : canonical;
    const connected = e.connected === true;
    next[key] = { label, connected };
  }
  return next;
}
