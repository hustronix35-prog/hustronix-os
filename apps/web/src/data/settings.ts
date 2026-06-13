export const settingsTabs = [
  "General",
  "Connections",
  "Rules & Policies",
  "Capacity",
  "Notifications",
  "Security",
  "Billing",
] as const;

export type IntegrationId =
  | "slack"
  | "github"
  | "google_calendar"
  | "notion"
  | "gmail"
  | "jira"
  | "linear"
  | "ms_teams";

/** Matches `/oauth/[provider]` route segment — see `src/lib/oauth-providers.ts`. */
export type IntegrationDefinition = {
  id: IntegrationId;
  apiSlug: IntegrationId;
  name: string;
  connected: boolean;
  developer: string;
};

export const integrations: IntegrationDefinition[] = [
  {
    id: "slack",
    apiSlug: "slack",
    name: "Slack",
    connected: true,
    developer: "Authorize with Slack",
  },
  {
    id: "github",
    apiSlug: "github",
    name: "GitHub",
    connected: true,
    developer: "Authorize with GitHub",
  },
  {
    id: "google_calendar",
    apiSlug: "google_calendar",
    name: "Google Calendar",
    connected: true,
    developer: "Authorize with Google",
  },
  {
    id: "notion",
    apiSlug: "notion",
    name: "Notion",
    connected: true,
    developer: "Authorize with Notion",
  },
  {
    id: "gmail",
    apiSlug: "gmail",
    name: "Gmail",
    connected: true,
    developer: "Authorize with Google",
  },
  {
    id: "jira",
    apiSlug: "jira",
    name: "Jira",
    connected: false,
    developer: "Authorize with Atlassian",
  },
  {
    id: "linear",
    apiSlug: "linear",
    name: "Linear",
    connected: true,
    developer: "Authorize with Linear",
  },
  {
    id: "ms_teams",
    apiSlug: "ms_teams",
    name: "MS Teams",
    connected: false,
    developer: "Authorize with Microsoft",
  },
];
