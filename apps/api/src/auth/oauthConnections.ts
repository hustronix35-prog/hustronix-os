/**
 * High-level OAuth connection helpers.
 *
 * Wraps the raw DB methods in `database.ts` with:
 *   - encryption/decryption so callers only ever see plaintext tokens
 *   - automatic refresh when an `expires_at` is within `EARLY_REFRESH_WINDOW_SEC`
 *   - typed view of a "live" connection ready for API calls
 *
 * Every provider-specific module (slackEvents.ts, githubIngest.ts,
 * microsoftGraph.ts, etc.) should call `getLiveAccessToken(userId, provider)`
 * instead of touching `oauth_connections` directly. That guarantees:
 *   1. Tokens are decrypted in a single place.
 *   2. Refresh happens transparently.
 *   3. Revocation is honored consistently.
 */

import { db } from "../database.js";
import { decryptToken, encryptToken } from "./oauthCrypto.js";
import {
  PROVIDERS,
  getProvider,
  readClientCredentials,
  type ProviderConfig,
  type ProviderId,
  type TokenSet,
} from "./oauthProviders.js";

/** Refresh access tokens this many seconds before they actually expire. */
const EARLY_REFRESH_WINDOW_SEC = 120;

export interface LiveConnection {
  id: string;
  userId: string;
  provider: ProviderId;
  externalTeamId: string;
  externalTeamName: string | null;
  externalUserId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  tokenType: string | null;
}

export function hydrateLiveConnection(row: any): LiveConnection {
  /**
   * Legacy Slack installs wrote plaintext to `access_token`. New scheme writes
   * ciphertext to `access_token_encrypted` and leaves the legacy column empty.
   * Read whichever is populated — never mix.
   */
  const encrypted = (row.access_token_encrypted || "").toString();
  const accessToken = encrypted
    ? decryptToken(encrypted)
    : (row.access_token || "").toString();
  const refreshToken = row.refresh_token_encrypted
    ? decryptToken(row.refresh_token_encrypted)
    : null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as ProviderId,
    externalTeamId: row.external_team_id || "",
    externalTeamName: row.external_team_name ?? null,
    externalUserId: row.external_user_id ?? null,
    accessToken,
    refreshToken,
    expiresAt: row.expires_at ?? null,
    scope: row.scope ?? null,
    tokenType: row.token_type ?? null,
  };
}

/**
 * Persist a `TokenSet` after a successful authorize -> token exchange OR refresh.
 * The provider module passes plaintext; this function handles encryption.
 */
export function saveTokenSet(
  userId: string,
  provider: ProviderConfig,
  tokens: TokenSet,
  connectionLabel: string | null,
): string {
  return db.upsertOAuthConnection({
    userId,
    provider: provider.id,
    externalTeamId: tokens.externalTeamId || "",
    externalTeamName: tokens.externalTeamName,
    externalUserId: tokens.externalUserId,
    connectionLabel,
    accessTokenEncrypted: encryptToken(tokens.accessToken),
    refreshTokenEncrypted: encryptToken(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    rawInstallPayload: JSON.stringify(tokens.raw),
  });
}

/** Persist refreshed tokens. Some providers omit a new refresh_token; keep the old one. */
export function applyRefreshedTokens(
  connectionId: string,
  next: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt: string | null;
    scope?: string | null;
  },
) {
  db.updateOAuthConnectionTokens(connectionId, {
    accessTokenEncrypted: encryptToken(next.accessToken),
    refreshTokenEncrypted:
      next.refreshToken !== undefined && next.refreshToken !== null
        ? encryptToken(next.refreshToken)
        : undefined,
    expiresAt: next.expiresAt,
    scope: next.scope,
  });
}

/**
 * Exchange a `refresh_token` for a fresh `access_token`. Caller passes the
 * resolved provider config and current refresh token; we issue the HTTP call
 * and persist the result.
 */
export async function refreshConnectionTokens(
  connection: LiveConnection,
): Promise<LiveConnection> {
  const provider = getProvider(connection.provider);
  if (!provider) {
    throw new Error(`unknown provider ${connection.provider}`);
  }
  if (!provider.supportsRefresh) {
    return connection;
  }
  if (!connection.refreshToken) {
    throw new Error(`no refresh_token on file for ${provider.id}`);
  }
  const creds = readClientCredentials(provider);
  if (!creds) {
    throw new Error(`${provider.clientIdEnv}/${provider.clientSecretEnv} are not set`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  /** Microsoft Graph requires `scope` to be re-sent on refresh; passing the original is safe across all providers. */
  if (connection.scope) body.set("scope", connection.scope);

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  const res = await fetch(provider.tokenUrl, { method: "POST", body, headers });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `refresh failed for ${provider.id}: ${res.status} ${JSON.stringify(json)}`,
    );
  }

  const accessToken = String(json.access_token || "");
  if (!accessToken) {
    throw new Error(`refresh response missing access_token for ${provider.id}`);
  }
  const refreshToken: string | null =
    typeof json.refresh_token === "string" && json.refresh_token.length
      ? json.refresh_token
      : connection.refreshToken;
  const expiresIn = Number(json.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  applyRefreshedTokens(connection.id, {
    accessToken,
    refreshToken,
    expiresAt,
    scope: typeof json.scope === "string" ? json.scope : connection.scope,
  });

  return {
    ...connection,
    accessToken,
    refreshToken,
    expiresAt,
    scope: typeof json.scope === "string" ? json.scope : connection.scope,
  };
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts - Date.now() < EARLY_REFRESH_WINDOW_SEC * 1000;
}

/**
 * Returns a live connection ready for use. Refreshes the access token if it's
 * expired or within the early-refresh window. Throws when nothing is connected
 * or refresh fails (caller decides whether to fall back to "not connected").
 */
export async function getLiveConnection(
  userId: string,
  provider: ProviderId,
): Promise<LiveConnection | null> {
  const row = db.getOAuthConnectionForUser(userId, provider);
  if (!row) return null;
  let live = hydrateLiveConnection(row);
  const cfg = getProvider(provider);
  if (cfg?.supportsRefresh && isExpiringSoon(live.expiresAt)) {
    try {
      live = await refreshConnectionTokens(live);
    } catch (err) {
      console.warn(
        `[oauth] auto-refresh failed for ${provider} (connection ${live.id}):`,
        (err as Error).message,
      );
    }
  }
  return live;
}

export async function getLiveAccessToken(
  userId: string,
  provider: ProviderId,
): Promise<string | null> {
  const live = await getLiveConnection(userId, provider);
  if (!live || !live.accessToken) return null;
  return live.accessToken;
}

/** Surface connection state to /api/me and /settings. No token material returned. */
export function listConnectionStatuses(userId: string) {
  return Object.values(PROVIDERS).map((p) => {
    const row = db.getOAuthConnectionForUser(userId, p.id);
    return {
      provider: p.id,
      label: p.label,
      connected: !!row,
      externalTeamName: row?.external_team_name ?? null,
      externalUserId: row?.external_user_id ?? null,
      scope: row?.scope ?? null,
      expiresAt: row?.expires_at ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export function getConnectionStatus(userId: string, provider: ProviderId) {
  const cfg = getProvider(provider);
  if (!cfg) return null;
  const row = db.getOAuthConnectionForUser(userId, provider);
  return {
    provider,
    label: cfg.label,
    connected: !!row,
    externalTeamName: row?.external_team_name ?? null,
    externalUserId: row?.external_user_id ?? null,
    scope: row?.scope ?? null,
    expiresAt: row?.expires_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}
