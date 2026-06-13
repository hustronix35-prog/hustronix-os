/**
 * OAuth Provider Registry.
 *
 * Single source of truth for every integration's OAuth flow. Each entry
 * declares enough metadata that the generic `oauthRoutes.ts` handler can
 * drive the entire dance (authorize -> token exchange -> refresh -> revoke)
 * without provider-specific branching in the route layer.
 *
 * Adding a new provider:
 *   1. Add a key to `ProviderId`.
 *   2. Add an entry to `PROVIDERS` with its endpoints, scopes, and credentials.
 *   3. Implement the per-provider hooks (`buildAuthorizeUrl`, `extractTokens`,
 *      optionally `afterConnect` for webhook auto-registration).
 *   4. Wire env vars in `.env.example` and bind them in Container Apps.
 *
 * Anything provider-specific that doesn't fit this shape (e.g. Microsoft's
 * change-notification subscriptions, Google Pub/Sub watch channels) lives in
 * the per-provider module and is invoked via `afterConnect` / `beforeDisconnect`.
 */

export type ProviderId =
  | "slack"
  | "github"
  | "google" // covers Calendar + Gmail (single client)
  | "microsoft" // covers Teams + Outlook Calendar + Outlook Mail (single Azure AD app)
  | "notion"
  | "jira"
  | "linear";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute ISO timestamp (UTC) when `accessToken` becomes invalid. Null = no expiry advertised. */
  expiresAt: string | null;
  scope: string | null;
  tokenType: string | null;
  /**
   * Provider-side workspace/team identifier (Slack team_id, GitHub login, Microsoft tenantId, etc.).
   * Used to scope webhooks and dedup multi-workspace installs from the same user.
   */
  externalTeamId: string;
  externalTeamName: string | null;
  /** Optional provider-side user identifier (Slack user, GitHub user, MS oid). */
  externalUserId: string | null;
  /** Full token response for debugging — stored as JSON. NOT used for auth decisions. */
  raw: Record<string, unknown>;
}

export interface ProviderConfig {
  id: ProviderId;
  /** Human label shown in audit logs and `/api/me`. */
  label: string;
  /**
   * Scopes requested at authorize time. Provider may grant fewer; we honor the
   * scope string the provider returns. Override via env if needed.
   */
  defaultScopes: string[];
  /** OAuth authorize endpoint (where the user is redirected). */
  authorizeUrl: string;
  /** OAuth token endpoint (server-to-server code exchange + refresh). */
  tokenUrl: string;
  /**
   * Optional revoke endpoint. When present, `DELETE /api/oauth/:provider` will
   * notify the provider to invalidate the token in addition to dropping our row.
   */
  revokeUrl?: string;
  /** env var name for the OAuth client id (set this in `.env` / Key Vault). */
  clientIdEnv: string;
  /** env var name for the OAuth client secret. */
  clientSecretEnv: string;
  /**
   * env var override for redirect URI. If unset, the runtime computes
   * `${APP_ORIGIN}/api/oauth/<id>/callback`.
   */
  redirectUriEnv?: string;
  /** Defaults to `?`-delimited query string. Set true for providers that want POST-form auth (rare). */
  tokenRequestStyle?: "form" | "json";
  /**
   * Provider-specific quirks for the authorize URL — e.g. Microsoft needs
   * `response_mode=query`, Google wants `access_type=offline&prompt=consent`,
   * Slack uses `scope=` (bot) not `scopes=`.
   */
  extraAuthorizeParams?: Record<string, string>;
  /** True if this provider supports `refresh_token` grant. */
  supportsRefresh: boolean;
  /** Some providers (Slack bot) never expire — skip the refresh worker for them. */
  tokenNeverExpires?: boolean;
}

function envOrigin(): string {
  return (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
}

export function computeRedirectUri(provider: ProviderId): string {
  const explicit = process.env[`OAUTH_${provider.toUpperCase()}_REDIRECT_URI`]?.trim();
  if (explicit) return explicit;
  /** Slack uses the legacy SLACK_REDIRECT_URI var — keep backward-compat. */
  if (provider === "slack" && process.env.SLACK_REDIRECT_URI?.trim()) {
    return process.env.SLACK_REDIRECT_URI.trim();
  }
  return `${envOrigin()}/api/oauth/${provider}/callback`;
}

/** Every supported integration. Order here drives Settings list order. */
export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  slack: {
    id: "slack",
    label: "Slack",
    defaultScopes: (
      process.env.SLACK_BOT_SCOPES ||
      "app_mentions:read,channels:history,chat:write,commands"
    )
      .split(/[,\s]+/)
      .filter(Boolean),
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    redirectUriEnv: "SLACK_REDIRECT_URI",
    extraAuthorizeParams: {},
    supportsRefresh: false,
    tokenNeverExpires: true,
  },

  github: {
    id: "github",
    label: "GitHub",
    defaultScopes: ["repo", "read:org", "workflow", "read:user"],
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { allow_signup: "false" },
    supportsRefresh: false,
    tokenNeverExpires: true,
  },

  google: {
    id: "google",
    label: "Google",
    defaultScopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    supportsRefresh: true,
  },

  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    defaultScopes: [
      "offline_access",
      "openid",
      "email",
      "profile",
      "User.Read",
      "Calendars.Read",
      "Mail.Read",
      "ChannelMessage.Read.All",
      "Chat.Read",
    ],
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { response_mode: "query" },
    supportsRefresh: true,
  },

  notion: {
    id: "notion",
    label: "Notion",
    defaultScopes: [],
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
    tokenRequestStyle: "json",
    extraAuthorizeParams: { owner: "user" },
    supportsRefresh: false,
    tokenNeverExpires: true,
  },

  jira: {
    id: "jira",
    label: "Jira",
    defaultScopes: [
      "read:jira-work",
      "read:jira-user",
      "manage:jira-webhook",
      "offline_access",
    ],
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    clientIdEnv: "JIRA_OAUTH_CLIENT_ID",
    clientSecretEnv: "JIRA_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { audience: "api.atlassian.com", prompt: "consent" },
    supportsRefresh: true,
  },

  linear: {
    id: "linear",
    label: "Linear",
    defaultScopes: ["read", "write"],
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    revokeUrl: "https://api.linear.app/oauth/revoke",
    clientIdEnv: "LINEAR_OAUTH_CLIENT_ID",
    clientSecretEnv: "LINEAR_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { prompt: "consent" },
    supportsRefresh: true,
  },
};

export function getProvider(id: string): ProviderConfig | null {
  return (PROVIDERS as Record<string, ProviderConfig>)[id] ?? null;
}

export function isProviderId(id: string): id is ProviderId {
  return id in PROVIDERS;
}

/** Resolve env-backed client credentials. Returns null when not configured. */
export function readClientCredentials(
  provider: ProviderConfig,
): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env[provider.clientIdEnv] || "").trim();
  const clientSecret = (process.env[provider.clientSecretEnv] || "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
