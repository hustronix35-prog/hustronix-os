/**
 * Generic OAuth route handlers — one HTTP surface for every integration.
 *
 * Mounted by server.ts as:
 *   GET    /api/oauth/:provider/start      → 302 to provider authorize page
 *   GET    /api/oauth/:provider/callback   → swaps code → tokens, persists, closes popup
 *   GET    /api/oauth/:provider/status     → JSON { connected, scope, ... }
 *   DELETE /api/oauth/:provider/:id?       → revokes one connection (or the user's freshest)
 *
 * Slack keeps its legacy `/api/oauth/slack/*` routes for bot-token install
 * (which is shaped differently than a normal authorization-code flow). New
 * providers MUST go through this module — do not duplicate the boilerplate.
 */

import type { Express, Request, Response } from "express";

import { db } from "../database.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { recordSecurityEvent } from "../security/audit.js";
import { randomHex } from "./tokens.js";
import {
  PROVIDERS,
  computeRedirectUri,
  getProvider,
  isProviderId,
  readClientCredentials,
  type ProviderConfig,
  type ProviderId,
  type TokenSet,
} from "./oauthProviders.js";
import {
  getConnectionStatus,
  getLiveConnection,
  hydrateLiveConnection,
  saveTokenSet,
} from "./oauthConnections.js";
import { runAfterConnect, runBeforeDisconnect } from "./oauthLifecycle.js";

// -----------------------------------------------------------------------------
// Per-provider extraction logic (parses the diverse token responses into our
// common TokenSet). Anything provider-specific that the registry can't capture
// declaratively goes here, NOT in oauthRoutes.
// -----------------------------------------------------------------------------

type TokenExtractor = (raw: any) => Omit<TokenSet, "raw">;

const tokenExtractors: Record<ProviderId, TokenExtractor> = {
  slack: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    externalTeamId: String(raw.team?.id ?? raw.team_id ?? ""),
    externalTeamName: raw.team?.name ?? null,
    externalUserId: raw.authed_user?.id ?? raw.user_id ?? null,
  }),

  github: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    /** GitHub user OAuth has no "team" concept; use the GitHub user id (filled in later via /user). */
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: null,
  }),

  google: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: null,
  }),

  microsoft: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: null,
  }),

  notion: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: null,
    expiresAt: null,
    scope: null,
    tokenType: raw.token_type ?? null,
    externalTeamId: String(raw.workspace_id || ""),
    externalTeamName: raw.workspace_name ?? null,
    externalUserId: raw.owner?.user?.id ?? raw.bot_id ?? null,
  }),

  jira: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    /** Resolved post-token via accessible-resources call (handled in jira connector). */
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: null,
  }),

  linear: (raw) => ({
    accessToken: String(raw.access_token || ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: raw.expires_in
      ? new Date(Date.now() + Number(raw.expires_in) * 1000).toISOString()
      : null,
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? null,
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: null,
  }),
};

// -----------------------------------------------------------------------------
// Popup-finish HTML — same pattern Slack already uses, generalized.
// -----------------------------------------------------------------------------

function popupFinishHtml(provider: ProviderId, ok: boolean, detail?: string): string {
  const origin = config.server.appOrigin;
  const qs = ok
    ? `${provider}_connected=1`
    : `${provider}_error=${encodeURIComponent(detail || "oauth_failed")}`;
  const settingsUrl = `${origin}/settings?tab=connections&${qs}`;
  const payload = JSON.stringify({
    source: "hustronix-oauth",
    provider,
    ok,
    detail: detail ?? null,
  });
  const safeUrl = settingsUrl.replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${provider} · Hustronix</title></head><body>
<script>
(function () {
  var url = ${JSON.stringify(settingsUrl)};
  try {
    if (window.opener) {
      window.opener.postMessage(${payload}, "*");
      window.close();
      return;
    }
  } catch (e) {}
  window.location.replace(url);
})();
</script>
<p style="font-family:system-ui,sans-serif;padding:1rem">Finishing… <a href="${safeUrl}">Open settings</a></p>
</body></html>`;
}

function htmlBadRequest(res: Response, provider: ProviderId, detail: string) {
  res.status(400).type("html").send(popupFinishHtml(provider, false, detail));
}

// -----------------------------------------------------------------------------
// HTTP handlers
// -----------------------------------------------------------------------------

function buildAuthorizeUrl(
  provider: ProviderConfig,
  state: string,
  redirectUri: string,
  customScopes?: string[],
): string {
  const creds = readClientCredentials(provider);
  if (!creds) {
    throw new Error(
      `${provider.id} OAuth client credentials not configured (${provider.clientIdEnv}, ${provider.clientSecretEnv}).`,
    );
  }
  const scopes = (customScopes && customScopes.length
    ? customScopes
    : provider.defaultScopes
  ).join(provider.id === "github" ? "," : " ");
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  if (scopes) params.set("scope", scopes);
  if (provider.extraAuthorizeParams) {
    for (const [k, v] of Object.entries(provider.extraAuthorizeParams)) {
      if (v != null) params.set(k, String(v));
    }
  }
  return `${provider.authorizeUrl}?${params.toString()}`;
}

async function exchangeCodeForTokens(
  provider: ProviderConfig,
  code: string,
  redirectUri: string,
): Promise<any> {
  const creds = readClientCredentials(provider);
  if (!creds) {
    throw new Error(`${provider.id}: missing client credentials`);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type":
      provider.tokenRequestStyle === "json"
        ? "application/json"
        : "application/x-www-form-urlencoded",
  };

  let body: string;
  if (provider.tokenRequestStyle === "json") {
    /**
     * Notion needs Basic auth + JSON body. Atlassian (Jira) also accepts JSON;
     * the form variant works there too, but we keep one explicit JSON branch.
     */
    headers["authorization"] =
      "Basic " +
      Buffer.from(`${creds.clientId}:${creds.clientSecret}`, "utf8").toString("base64");
    body = JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
  } else {
    body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString();
  }

  const res = await fetch(provider.tokenUrl, { method: "POST", headers, body });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    /** Some providers return form-encoded responses (GitHub does by default unless Accept is set). */
    const params = new URLSearchParams(text);
    json = Object.fromEntries(params.entries());
  }
  if (!res.ok || json.error) {
    const detail = json.error_description || json.error || `${res.status}`;
    throw new Error(`${provider.id} token exchange failed: ${detail}`);
  }
  return json;
}

async function attemptProviderRevoke(
  provider: ProviderConfig,
  accessToken: string,
): Promise<void> {
  if (!provider.revokeUrl || !accessToken) return;
  try {
    if (provider.id === "google") {
      await fetch(`${provider.revokeUrl}?token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
      });
      return;
    }
    if (provider.id === "slack") {
      await fetch(provider.revokeUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      return;
    }
    if (provider.id === "linear") {
      await fetch(provider.revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: accessToken }).toString(),
      });
      return;
    }
  } catch (err) {
    console.warn(`[oauth] provider-side revoke failed for ${provider.id}:`, (err as Error).message);
  }
}

export function mountOAuthRoutes(app: Express): void {
  app.get("/api/oauth/:provider/start", authMiddleware, (req: Request, res: Response) => {
    const providerId = String(req.params.provider || "").toLowerCase();
    if (!isProviderId(providerId) || providerId === "slack") {
      /** Slack keeps its legacy bot-install endpoint elsewhere in server.ts. */
      return res.status(404).json({ error: "unknown provider" });
    }
    const provider = getProvider(providerId)!;
    const userId = (req as any).userId as string;
    if (!userId || userId === "system") {
      return res.status(401).json({ error: "Sign in required to connect integrations." });
    }
    const creds = readClientCredentials(provider);
    if (!creds) {
      return res.status(503).json({
        error: `${provider.label} OAuth is not configured on the server.`,
        envVarsRequired: [provider.clientIdEnv, provider.clientSecretEnv],
      });
    }

    const state = randomHex(24);
    const redirectPath =
      typeof req.query.redirect === "string" ? req.query.redirect : null;
    db.createOAuthPendingStateExt(state, userId, provider.id, 15, redirectPath);
    const redirectUri = computeRedirectUri(provider.id);
    const customScopes =
      typeof req.query.scopes === "string" && req.query.scopes.length
        ? String(req.query.scopes).split(/[,\s]+/).filter(Boolean)
        : undefined;
    const url = buildAuthorizeUrl(provider, state, redirectUri, customScopes);
    recordSecurityEvent(req, `oauth.${provider.id}.start`, "info", { userId });
    return res.redirect(url);
  });

  app.get("/api/oauth/:provider/callback", async (req: Request, res: Response) => {
    const providerId = String(req.params.provider || "").toLowerCase();
    if (!isProviderId(providerId) || providerId === "slack") {
      return res.status(404).type("text").send("Unknown provider.");
    }
    const provider = getProvider(providerId)!;
    const stateParam = String(req.query.state || "");
    const code = String(req.query.code || "");
    const errorParam = String(req.query.error || "");

    if (errorParam) {
      return htmlBadRequest(res, providerId, errorParam);
    }
    if (!code || !stateParam) {
      return htmlBadRequest(res, providerId, "missing_code_or_state");
    }
    const pending = db.consumeOAuthPendingStateExt(stateParam);
    if (!pending || pending.provider !== provider.id) {
      return htmlBadRequest(res, providerId, "state_mismatch");
    }

    try {
      const redirectUri = computeRedirectUri(provider.id);
      const raw = await exchangeCodeForTokens(provider, code, redirectUri);
      const extract = tokenExtractors[provider.id];
      const partial = extract(raw);
      const tokens: TokenSet = { ...partial, raw };
      if (!tokens.accessToken) {
        return htmlBadRequest(res, providerId, "no_access_token");
      }
      const connectionLabel = tokens.externalTeamName || provider.label;
      const connectionId = saveTokenSet(
        pending.user_id,
        provider,
        tokens,
        connectionLabel,
      );
      const row = db.getOAuthConnectionById(connectionId);
      const live = row ? hydrateLiveConnection(row) : null;
      if (live) {
        await runAfterConnect(live);
      }
      recordSecurityEvent(req, `oauth.${provider.id}.connected`, "info", {
        userId: pending.user_id,
        connectionId,
        scope: tokens.scope,
      });
      return res.type("html").send(popupFinishHtml(providerId, true));
    } catch (err) {
      console.error(`[oauth] callback error for ${provider.id}:`, err);
      return htmlBadRequest(res, providerId, (err as Error).message.slice(0, 80));
    }
  });

  app.get("/api/oauth/:provider/status", authMiddleware, (req: Request, res: Response) => {
    const providerId = String(req.params.provider || "").toLowerCase();
    if (!isProviderId(providerId)) {
      return res.status(404).json({ error: "unknown provider" });
    }
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const status = getConnectionStatus(userId, providerId);
    return res.json(status);
  });

  app.get("/api/oauth/connections", authMiddleware, (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const out = Object.values(PROVIDERS).map((p) => getConnectionStatus(userId, p.id));
    return res.json({ connections: out });
  });

  app.delete("/api/oauth/:provider", authMiddleware, async (req: Request, res: Response) => {
    await disconnectHandler(req, res);
  });

  app.delete("/api/oauth/:provider/:id", authMiddleware, async (req: Request, res: Response) => {
    await disconnectHandler(req, res);
  });
}

async function disconnectHandler(req: Request, res: Response) {
  const providerId = String(req.params.provider || "").toLowerCase();
  if (!isProviderId(providerId)) {
    return res.status(404).json({ error: "unknown provider" });
  }
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") {
    return res.status(401).json({ error: "unauthorized" });
  }
  const provider = getProvider(providerId)!;
  const idParam = req.params.id as string | undefined;
  const live = await getLiveConnection(userId, providerId);
  if (!live) {
    return res.json({ ok: true, alreadyDisconnected: true });
  }
  if (idParam && idParam !== live.id) {
    /** Multi-workspace users could target a specific connection id later — placeholder for that path. */
    const row = db.getOAuthConnectionById(idParam);
    if (!row || row.user_id !== userId) {
      return res.status(404).json({ error: "connection not found" });
    }
  }
  await runBeforeDisconnect(live);
  await attemptProviderRevoke(provider, live.accessToken);
  db.revokeOAuthConnection(live.id);
  recordSecurityEvent(req, `oauth.${provider.id}.disconnected`, "warning", {
    userId,
    connectionId: live.id,
  });
  return res.json({ ok: true });
}
