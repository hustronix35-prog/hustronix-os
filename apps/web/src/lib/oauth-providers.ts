/**
 * Maps the UI's `/oauth/[provider]` slug → the canonical backend provider id
 * (the same one accepted by `/api/oauth/{id}/start`).
 *
 * The UI shows three Microsoft pills (Teams, Outlook Calendar, Outlook Mail)
 * and two Google pills (Calendar, Gmail). All of them connect through the
 * single Azure AD or Google OAuth client — we just send the user to the same
 * authorize URL and the user later picks which surfaces to monitor in
 * Settings → Manage modal.
 */

export const OAUTH_PROVIDER_SLUGS = [
  "slack",
  "github",
  "google_calendar",
  "gmail",
  "ms_teams",
  "outlook_calendar",
  "outlook_mail",
  "notion",
  "jira",
  "linear",
] as const;

export type OAuthProviderSlug = (typeof OAUTH_PROVIDER_SLUGS)[number];

/** UI slug → backend provider id (one of the keys in `apps/api/src/auth/oauthProviders.ts`). */
const SLUG_TO_BACKEND: Record<OAuthProviderSlug, string> = {
  slack: "slack",
  github: "github",
  google_calendar: "google",
  gmail: "google",
  ms_teams: "microsoft",
  outlook_calendar: "microsoft",
  outlook_mail: "microsoft",
  notion: "notion",
  jira: "jira",
  linear: "linear",
};

/**
 * Optional manual override for any slug — set `OAUTH_<SLUG>_URL` if you want
 * to bypass the backend's flow and point at a fully-formed authorize URL.
 * Useful for legacy Slack installs.
 */
const ENV_BY_SLUG: Record<OAuthProviderSlug, readonly [string, string]> = {
  slack: ["OAUTH_SLACK_URL", "NEXT_PUBLIC_OAUTH_SLACK_URL"],
  github: ["OAUTH_GITHUB_URL", "NEXT_PUBLIC_OAUTH_GITHUB_URL"],
  google_calendar: ["OAUTH_GOOGLE_CALENDAR_URL", "NEXT_PUBLIC_OAUTH_GOOGLE_CALENDAR_URL"],
  gmail: ["OAUTH_GMAIL_URL", "NEXT_PUBLIC_OAUTH_GMAIL_URL"],
  ms_teams: ["OAUTH_MS_TEAMS_URL", "NEXT_PUBLIC_OAUTH_MS_TEAMS_URL"],
  outlook_calendar: ["OAUTH_OUTLOOK_CALENDAR_URL", "NEXT_PUBLIC_OAUTH_OUTLOOK_CALENDAR_URL"],
  outlook_mail: ["OAUTH_OUTLOOK_MAIL_URL", "NEXT_PUBLIC_OAUTH_OUTLOOK_MAIL_URL"],
  notion: ["OAUTH_NOTION_URL", "NEXT_PUBLIC_OAUTH_NOTION_URL"],
  jira: ["OAUTH_JIRA_URL", "NEXT_PUBLIC_OAUTH_JIRA_URL"],
  linear: ["OAUTH_LINEAR_URL", "NEXT_PUBLIC_OAUTH_LINEAR_URL"],
};

export function resolveOAuthAuthorizeUrl(slug: string): string | undefined {
  if (!isOAuthProviderSlug(slug)) return undefined;
  const [priv, pub] = ENV_BY_SLUG[slug];
  const raw = process.env[priv] || process.env[pub];
  const url = raw?.trim();
  return url || undefined;
}

export function backendProviderId(slug: string): string | undefined {
  if (!isOAuthProviderSlug(slug)) return undefined;
  return SLUG_TO_BACKEND[slug];
}

export function isOAuthProviderSlug(s: string): s is OAuthProviderSlug {
  return (OAUTH_PROVIDER_SLUGS as readonly string[]).includes(s);
}
