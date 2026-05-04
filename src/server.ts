import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer, type Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { db } from "./database.js";
import path from "path";
import { transcribeBuffer } from "./audio.js";
import { v4 as uuidv4 } from "uuid";
import { connectionsManager } from "./connections_manager.js";
import { authMiddleware, resolveWsUserId } from "./middleware/auth.js";
import { authRouteLimiter, passwordRouteLimiter } from "./middleware/rateLimit.js";
import {
  hashPassword,
  verifyBcrypt,
  verifyLegacySha256,
  MIN_PASSWORD_LENGTH,
} from "./auth/password.js";
import { hashOpaqueToken, randomHex, newApiAccessTokenPlain } from "./auth/tokens.js";
import { handleSlackEventsRequest } from "./integrations/slackEvents.js";
import { auditor } from "./auditor.js";

const LEGACY_UID_COOKIE = "hustronix_uid";
const SESSION_COOKIE = "hustronix_session";
const SESSION_DAYS = 30;

function cookieBase() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
  };
}

function attachSessionCookie(res: express.Response, plainToken: string) {
  res.cookie(SESSION_COOKIE, plainToken, {
    ...cookieBase(),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function issueSession(res: express.Response, userId: string, req: express.Request) {
  const plain = randomHex(32);
  const tokenHash = hashOpaqueToken(plain);
  const sid = uuidv4();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.createUserSession({
    id: sid,
    userId,
    tokenHash,
    expiresAtIso: expires,
    userAgent: (req.headers["user-agent"] as string) || null,
    ip: req.ip || req.socket.remoteAddress || null,
  });
  attachSessionCookie(res, plain);
  res.clearCookie(LEGACY_UID_COOKIE, { path: "/" });
  return { plainToken: plain, sessionId: sid };
}

function commitDecisionActive(userId: string, decisionId: string, justification?: string) {
  const tenant = db.getDecisionTenant(decisionId);
  if (!tenant) throw new Error("Decision not found.");
  if (userId !== "system" && tenant !== userId) {
    throw new Error("Forbidden: decision belongs to another account.");
  }
  db.transitionDecisionState(decisionId, "ACTIVE", justification || "Committed via Hustronix");
}

/** SQL fragment + params for tenant-scoped external_signals (system sees all). */
function signalsTenant(userId: string): { sql: string; params: unknown[] } {
  if (userId === "system") return { sql: "", params: [] };
  return { sql: " AND user_id = ?", params: [userId] };
}

const app = express();
app.set("trust proxy", 1);

/** Set when WebSocket layer is attached (API-only or unified server). */
let wssSingleton: WebSocketServer | null = null;

const serverStartedAt = Date.now();

export function attachWebSocketServer(httpServer: HttpServer) {
  if (wssSingleton) {
    console.warn("[WS] WebSocket server already attached; skipping duplicate attach.");
    return;
  }
  wssSingleton = new WebSocketServer({ server: httpServer });
  wireWebSocketHandlers(wssSingleton);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.server.allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
/** Slack Events API requires raw body + HMAC signature — must run before express.json(). */
app.post(
  "/api/integrations/slack/events",
  express.raw({ type: "application/json" }),
  handleSlackEventsRequest,
);
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

// --- Global Request Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// --- Auth Endpoints ---
app.post("/api/auth/register", authRouteLimiter, (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const u = String(username || "").trim();
    const p = String(password || "");
    if (!u || !p) return res.status(400).json({ error: "Username and password required" });
    if (p.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const existing = db.getUser(u);
    if (existing) return res.status(400).json({ error: "Username taken" });
    const id = uuidv4();
    const hash = hashPassword(p);
    db.createUser(id, u, hash);
    const sess = issueSession(res, id, req);
    res.json({ success: true, userId: id, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", authRouteLimiter, (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const u = String(username || "").trim();
    const p = String(password || "");
    const user = db.getUser(u) as { id: string; password_hash: string } | undefined;
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    let ok = verifyBcrypt(p, user.password_hash);
    if (!ok) ok = verifyLegacySha256(p, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    if (!user.password_hash.startsWith("$2")) {
      db.updateUserPasswordHash(user.id, hashPassword(p));
    }
    const sess = issueSession(res, user.id, req);
    res.json({ success: true, userId: user.id, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sessionCookie = req.cookies?.hustronix_session as string | undefined;
  if (sessionCookie) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionCookie));
    if (sess && !sess.revoked_at) db.revokeSession(sess.id, sess.user_id);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(LEGACY_UID_COOKIE, { path: "/" });
  res.json({ success: true });
});

/** Link OAuth subject to existing user by email username, or create a password-less-backed user. */
function findOrCreateUserFromOAuth(
  provider: "google" | "github",
  providerUserId: string,
  email: string | null,
  usernameHint: string,
): string {
  let userId = db.findOAuthUserId(provider, providerUserId);
  if (userId) return userId;

  if (email) {
    userId = db.findUserIdByUsername(email);
    if (userId) {
      db.insertOAuthIdentity(provider, providerUserId, userId, email);
      return userId;
    }
  }

  const username = db.allocateUniqueUsername(
    usernameHint || email || `${provider}_${providerUserId.slice(0, 10)}`,
  );
  userId = uuidv4();
  db.createUser(userId, username, hashPassword(randomHex(48)));
  db.insertOAuthIdentity(provider, providerUserId, userId, email);
  return userId;
}

function redirectBrowserAfterSocialLogin(
  res: express.Response,
  req: express.Request,
  userId: string | null,
  errorDetail?: string,
) {
  const origin = config.server.appOrigin;
  if (!userId || errorDetail) {
    return res.redirect(
      302,
      `${origin}/login?error=${encodeURIComponent(errorDetail || "oauth_failed")}`,
    );
  }
  issueSession(res, userId, req);
  return res.redirect(302, `${origin}/onboarding?signed_in=1`);
}

app.get("/api/auth/google/start", authRouteLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return res.status(500).send("Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI (Google Cloud Console OAuth client).");
  }
  const state = randomHex(24);
  db.createOAuthLoginState(state, "google", 15);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "select_account");
  res.redirect(302, url.toString());
});

app.get("/api/auth/google/callback", authRouteLimiter, async (req, res) => {
  const err = String(req.query.error || "");
  if (err && err !== "undefined") {
    return redirectBrowserAfterSocialLogin(res, req, null, err);
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    return redirectBrowserAfterSocialLogin(res, req, null, "missing_code_or_state");
  }
  const provider = db.consumeOAuthLoginState(state);
  if (provider !== "google") {
    return redirectBrowserAfterSocialLogin(res, req, null, "invalid_or_expired_state");
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return redirectBrowserAfterSocialLogin(res, req, null, "server_oauth_not_configured");
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenJson.access_token) {
      return redirectBrowserAfterSocialLogin(
        res,
        req,
        null,
        tokenJson.error || "google_token_exchange_failed",
      );
    }
    const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = (await ui.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!profile.sub) {
      return redirectBrowserAfterSocialLogin(res, req, null, "google_profile_missing");
    }
    const userId = findOrCreateUserFromOAuth(
      "google",
      profile.sub,
      profile.email ?? null,
      profile.name?.replace(/\s+/g, "_").toLowerCase().slice(0, 40) ||
        profile.email?.split("@")[0] ||
        "google_user",
    );
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      ["GOOGLE_OAUTH_LOGIN", `sub=${profile.sub}`, userId],
    );
    return redirectBrowserAfterSocialLogin(res, req, userId);
  } catch (e: any) {
    return redirectBrowserAfterSocialLogin(
      res,
      req,
      null,
      e?.message || "google_oauth_error",
    );
  }
});

app.get("/api/auth/github/start", authRouteLimiter, (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return res.status(500).send("Set GITHUB_CLIENT_ID and GITHUB_REDIRECT_URI (GitHub OAuth App).");
  }
  const state = randomHex(24);
  db.createOAuthLoginState(state, "github", 15);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
});

app.get("/api/auth/github/callback", authRouteLimiter, async (req, res) => {
  const err = String(req.query.error || "");
  if (err && err !== "undefined") {
    return redirectBrowserAfterSocialLogin(res, req, null, err);
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    return redirectBrowserAfterSocialLogin(res, req, null, "missing_code_or_state");
  }
  const provider = db.consumeOAuthLoginState(state);
  if (provider !== "github") {
    return redirectBrowserAfterSocialLogin(res, req, null, "invalid_or_expired_state");
  }
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return redirectBrowserAfterSocialLogin(res, req, null, "server_oauth_not_configured");
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      return redirectBrowserAfterSocialLogin(
        res,
        req,
        null,
        tokenJson.error_description || tokenJson.error || "github_token_exchange_failed",
      );
    }
    const ghUserRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Hustronix-OS",
      },
    });
    const gh = (await ghUserRes.json()) as {
      id?: number;
      login?: string;
      email?: string | null;
      name?: string | null;
    };
    if (!gh.id) {
      return redirectBrowserAfterSocialLogin(res, req, null, "github_profile_missing");
    }
    let email = gh.email ?? null;
    if (!email) {
      const emRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Hustronix-OS",
        },
      });
      const emails = (await emRes.json()) as { email?: string; primary?: boolean }[];
      const primary = emails?.find((e) => e.primary);
      email = primary?.email || emails?.[0]?.email || null;
    }
    const userId = findOrCreateUserFromOAuth(
      "github",
      String(gh.id),
      email,
      gh.login || gh.name || `github_${gh.id}`,
    );
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      ["GITHUB_OAUTH_LOGIN", `id=${gh.id}`, userId],
    );
    return redirectBrowserAfterSocialLogin(res, req, userId);
  } catch (e: any) {
    return redirectBrowserAfterSocialLogin(
      res,
      req,
      null,
      e?.message || "github_oauth_error",
    );
  }
});

app.post("/api/auth/password", authMiddleware, passwordRouteLimiter, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId || userId === "system") {
      return res.status(400).json({ error: "Password change not available for this principal." });
    }
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    const cur = String(currentPassword || "");
    const neu = String(newPassword || "");
    if (!cur || !neu) return res.status(400).json({ error: "currentPassword and newPassword required" });
    if (neu.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const stored = db.getUserPasswordHash(userId);
    if (!stored) return res.status(400).json({ error: "User not found" });
    let ok = verifyBcrypt(cur, stored);
    if (!ok) ok = verifyLegacySha256(cur, stored);
    if (!ok) return res.status(401).json({ error: "Current password incorrect" });
    db.updateUserPasswordHash(userId, hashPassword(neu));
    db.revokeAllUserSessions(userId);
    const sess = issueSession(res, userId, req);
    res.json({ success: true, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/api-keys", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId || userId === "system") return res.status(400).json({ error: "API keys require a user account." });
    const name = String((req.body as { name?: string }).name || "API Key").trim().slice(0, 120);
    const plain = newApiAccessTokenPlain();
    const prefix = plain.slice(0, 16);
    db.createApiAccessToken(userId, name, prefix, hashOpaqueToken(plain));
    res.status(201).json({ success: true, name, token: plain, warning: "Store this token now; it will not be shown again." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/api-keys", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.json({ keys: [] });
  const keys = db.listApiAccessTokens(userId).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.token_prefix,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    status: k.revoked_at ? "Revoked" : "Active",
  }));
  res.json({ keys });
});

app.delete("/api/auth/api-keys/:id", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const ok = db.revokeApiAccessToken(String(req.params.id), userId);
  if (!ok) return res.status(404).json({ error: "Key not found." });
  res.json({ success: true });
});

app.get("/api/auth/sessions", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.json({ sessions: [] });
  const current = (req as any).sessionId as string | undefined;
  const rows = db.listUserSessions(userId).map((s) => ({
    id: s.id,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    lastActive: s.last_seen_at,
    userAgent: s.user_agent || "—",
    ip: s.ip || "—",
    status: s.revoked_at ? "Ended" : new Date(s.expires_at) < new Date() ? "Expired" : "Active",
    isCurrent: s.id === current && !s.revoked_at,
  }));
  res.json({ sessions: rows });
});

app.delete("/api/auth/sessions/:id", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const ok = db.revokeSession(String(req.params.id), userId);
  if (!ok) return res.status(404).json({ error: "Session not found." });
  res.json({ success: true });
});

app.post("/api/auth/sessions/revoke-all", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const keepCurrent = Boolean((req.body as { keepCurrent?: boolean })?.keepCurrent);
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const current = keepCurrent ? ((req as any).sessionId as string | undefined) : undefined;
  db.revokeAllUserSessions(userId, current);
  if (!keepCurrent) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(LEGACY_UID_COOKIE, { path: "/" });
  }
  res.json({ success: true });
});

// --- Connections & Capability Endpoints ---
app.get("/api/connections", authMiddleware, (req, res) => {
  res.json({ capabilities: connectionsManager.getAllCapabilities() });
});

app.post("/api/connections/sync", authMiddleware, async (req, res) => {
  const result = await connectionsManager.syncProtocols();
  res.json(result);
});

// --- Slack OAuth (workspace install → bot token in SQLite) ---
function slackOAuthFinishHtml(ok: boolean, detail?: string) {
  const origin = config.server.appOrigin;
  const qs = ok
    ? "slack_connected=1"
    : `slack_error=${encodeURIComponent(detail || "oauth_failed")}`;
  const settingsUrl = `${origin}/settings?tab=connections&${qs}`;
  const payload = JSON.stringify({
    source: "hustronix-oauth",
    provider: "slack",
    ok,
    detail: detail ?? null,
  });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Slack · Hustronix</title></head><body>
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
<p style="font-family:system-ui,sans-serif;padding:1rem">Finishing… <a href="${settingsUrl.replace(/"/g, "&quot;")}">Open settings</a></p>
</body></html>`;
}

app.get("/api/oauth/slack/start", authMiddleware, (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const redirectUri = process.env.SLACK_REDIRECT_URI?.trim();
  const scope =
    process.env.SLACK_BOT_SCOPES?.trim() ||
    "app_mentions:read,channels:history,chat:write,commands";
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") {
    res.status(401).type("html")
      .send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem"><p>Sign in to Hustronix (not the <code>system</code> principal), then open Settings → Connections → Slack again.</p><p><a href="${config.server.appOrigin}/settings?tab=connections">Back to settings</a></p></body></html>`);
    return;
  }
  if (!clientId || !redirectUri) {
    res.status(500).type("html").send(
      `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem"><p><strong>Missing env.</strong> Set <code>SLACK_CLIENT_ID</code> and <code>SLACK_REDIRECT_URI</code> on the API server (see Slack app → OAuth).</p><p><a href="${config.server.appOrigin}/settings?tab=connections">Settings</a></p></body></html>`,
    );
    return;
  }
  const state = randomHex(24);
  db.createOAuthPendingState(state, userId, "slack", 15);
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
});

app.get("/api/oauth/slack/callback", async (req, res) => {
  const err = String(req.query.error || "");
  if (err && err !== "undefined") {
    res.status(200).type("html").send(slackOAuthFinishHtml(false, err));
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    res.status(400).type("html").send(slackOAuthFinishHtml(false, "missing_code_or_state"));
    return;
  }
  const pending = db.consumeOAuthPendingState(state);
  if (!pending) {
    res.status(400).type("html").send(slackOAuthFinishHtml(false, "invalid_or_expired_state"));
    return;
  }
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const redirectUri = process.env.SLACK_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).type("html").send(slackOAuthFinishHtml(false, "server_missing_slack_credentials"));
    return;
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await tokenRes.json()) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      scope?: string;
      token_type?: string;
      bot_user_id?: string;
      team?: { id?: string; name?: string };
    };
    if (!json.ok || !json.access_token || !json.team?.id) {
      res.status(200).type("html").send(
        slackOAuthFinishHtml(false, json.error || "oauth.v2.access_failed"),
      );
      return;
    }
    db.upsertSlackBotInstallation({
      userId: pending.user_id,
      teamId: json.team.id,
      teamName: json.team.name ?? null,
      botUserId: json.bot_user_id ?? null,
      accessToken: json.access_token,
      scope: json.scope ?? null,
      tokenType: json.token_type ?? null,
      rawJson: JSON.stringify(json),
    });
    db.rawRun(
      `INSERT INTO audit_log (action, reason, affected_entity_id) VALUES (?, ?, ?)`,
      [
        "SLACK_OAUTH_CONNECTED",
        `Slack workspace ${json.team.name || json.team.id}`,
        pending.user_id,
      ],
    );
    res.status(200).type("html").send(slackOAuthFinishHtml(true));
  } catch (e: any) {
    res.status(500).type("html").send(slackOAuthFinishHtml(false, e?.message || "token_exchange_error"));
  }
});

app.get("/api/oauth/slack/status", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const rows = db.getSlackConnectionsForUser(userId);
  res.json({
    connected: rows.length > 0,
    workspaces: rows.map((r) => ({
      teamId: r.external_team_id,
      teamName: r.external_team_name,
      scope: r.scope,
      updatedAt: r.updated_at,
    })),
  });
});

// --- Value Telemetry & Learning Endpoints ---
app.get("/api/system/value-telemetry", authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  try {
    const stats = db.getUsageStats(userId);
    const accuracyNum = stats.systemStatus === "ENFORCING" ? 72 : 58;
    const stressScore = stats.activeTasks > 5 ? 0.82 : stats.activeTasks > 0 ? 0.45 : 0.12;
    res.json({
      accuracy: `${accuracyNum}%`,
      learningRate: accuracyNum > 70 ? "+1.4%" : "-0.5%",
      roiDelta: "Live Tracking",
      stressScore,
      decisions: stats.decisionsCount,
      stats
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

app.get("/api/learning-log", authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  try {
    const logs = db.rawGet("SELECT * FROM learning_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10", [userId]);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch learning log" });
  }
});

app.get("/api/audit-log", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const data =
      userId === "system"
        ? db.rawGet(`SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 1000`)
        : db.rawGet(
            `SELECT a.*
             FROM audit_log a
             LEFT JOIN decision_ledger d ON a.affected_entity_id = d.id
             LEFT JOIN execution_ledger e ON a.affected_entity_id = e.task_id
             LEFT JOIN decision_ledger d2 ON e.decision_id = d2.id
             WHERE d.user_id = ? OR d2.user_id = ?
             ORDER BY a.timestamp DESC
             LIMIT 1000`,
            [userId, userId],
          );
    
    const headers = ["ID", "Action", "Reason", "Entity ID", "Timestamp"];
    const rows = data.map((r: any) => [
      r.id, 
      r.action, 
      `"${(r.reason || '').replace(/"/g, '""')}"`, 
      r.affected_entity_id || '', 
      r.timestamp
    ]);
    
    const csv = [headers.join(","), ...rows.map((r: (string | number)[]) => r.join(","))].join("\n");
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=hustronix_audit_log.csv");
    res.send(csv);
  } catch (err: any) {
    console.error("❌ Audit Export Failed:", err.message);
    res.status(500).json({ error: "Failed to export audit log" });
  }
});

// --- Productivity Endpoints ---
app.get("/api/productivity", authMiddleware, (req, res) => {
  res.json({ habits: [], todos: [], startDate: new Date().toISOString() });
});

// --- Execution & Signal Endpoints ---
app.get("/api/execution/ledger", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const scope = req.query.scope as string | undefined;
    const baseJoin = `
      FROM execution_ledger e
      INNER JOIN decision_ledger d ON e.decision_id = d.id
      WHERE d.user_id = ?
    `;
    if (scope === "all") {
      const data = db.rawGet(
        `SELECT e.*, d.vow as decision_vow ${baseJoin} ORDER BY e.last_update DESC`,
        [userId],
      );
      return res.json({ executions: data });
    }
    const data = db.rawGet(
      `SELECT e.*, d.vow as decision_vow ${baseJoin}
       AND e.status IN ('PENDING', 'ACTIVE', 'BLOCKED')
       ORDER BY e.last_update DESC`,
      [userId],
    );
    res.json({ executions: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch executions" });
  }
});

app.get("/api/execution/signals", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { sql, params } = signalsTenant(userId);
    const data = db.rawGet(
      `SELECT * FROM external_signals WHERE state IN ('UNVERIFIED', 'GRACE')${sql} ORDER BY detected_at DESC`,
      params,
    );
    res.json({ signals: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

app.get("/api/execution/signals/by-state", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { sql: tenantSql, params: tenantParams } = signalsTenant(userId);
    const tab = (req.query.tab as string) || "unverified";
    let sql = `SELECT * FROM external_signals`;
    const params: unknown[] = [...tenantParams];
    if (tab === "unverified") {
      sql += ` WHERE state IN ('UNVERIFIED', 'GRACE')${tenantSql.replace(/^ AND/, " AND")}`;
    } else if (tab === "linked") {
      sql += ` WHERE state = 'LINKED'${tenantSql.replace(/^ AND/, " AND")}`;
    } else if (tab === "killed") {
      sql += ` WHERE state = 'KILLED'${tenantSql.replace(/^ AND/, " AND")}`;
    } else {
      sql += tenantSql ? ` WHERE 1=1${tenantSql}` : "";
    }
    sql += ` ORDER BY detected_at DESC`;
    const rows = db.rawGet(sql, params);
    const countSql = `SELECT
        SUM(CASE WHEN state IN ('UNVERIFIED','GRACE') THEN 1 ELSE 0 END) as unverified,
        SUM(CASE WHEN state = 'LINKED' THEN 1 ELSE 0 END) as linked,
        SUM(CASE WHEN state = 'KILLED' THEN 1 ELSE 0 END) as killed
       FROM external_signals WHERE 1=1${tenantSql}`;
    const counts = db.rawGet(countSql, [...tenantParams]) as {
      unverified: number;
      linked: number;
      killed: number;
    }[];
    const c = counts[0] || { unverified: 0, linked: 0, killed: 0 };
    res.json({
      signals: rows,
      counts: {
        unverified: Number(c.unverified) || 0,
        linked: Number(c.linked) || 0,
        killed: Number(c.killed) || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

app.get("/api/mission-control/summary", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const ownerFromExec = db.rawGet(
      `SELECT e.owner FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ? AND e.status IN ('ACTIVE','PENDING')
       ORDER BY e.last_update DESC LIMIT 1`,
      [userId],
    )[0] as { owner: string } | undefined;
    const owner =
      (req.query.owner as string)?.trim() ||
      ownerFromExec?.owner ||
      "system";

    const activeDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )[0] as Record<string, unknown> | undefined;

    const fallbackDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )[0] as Record<string, unknown> | undefined;

    const decision = activeDecision || fallbackDecision;

    const statusCounts = db.rawGet(
      `SELECT e.status, COUNT(*) as n
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ?
       GROUP BY e.status`,
      [userId],
    ) as { status: string; n: number }[];

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = Number(row.n);
    }

    const totalExec = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const activeExec = (byStatus["ACTIVE"] || 0) + (byStatus["PENDING"] || 0);
    const blockedExec = byStatus["BLOCKED"] || 0;

    const cap = db.getOwnerCapacity(owner);
    const activeTasks = db.rawGet(
      `SELECT sum(weight) as total_weight FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'`,
      [owner],
    ) as { total_weight: number | null }[];
    const currentLoad = Number(activeTasks[0]?.total_weight || 0);
    const loadPct =
      cap.capacity > 0 ? Math.round((currentLoad / cap.capacity) * 100) : 0;

    const mcRows = db.rawGet(
      `SELECT e.task_id, e.owner, e.weight, e.status, e.success_condition, e.last_update, d.vow as decision_vow
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ? AND e.status IN ('ACTIVE','BLOCKED','PENDING')
       ORDER BY e.last_update DESC
       LIMIT 8`,
      [userId],
    );

    const { sql: sigSql, params: sigParams } = signalsTenant(userId);
    const sigPreview = db.rawGet(
      `SELECT id, source, content, detected_at, grace_expires_at, state
       FROM external_signals
       WHERE state IN ('UNVERIFIED','GRACE')${sigSql}
       ORDER BY detected_at DESC
       LIMIT 5`,
      sigParams,
    );

    const unverifiedN =
      Number(
        (
          db.rawGet(
            `SELECT COUNT(*) as c FROM external_signals WHERE state IN ('UNVERIFIED','GRACE')${sigSql}`,
            sigParams,
          ) as { c: number }[]
        )[0]?.c || 0,
      ) || 0;

    res.json({
      decision: decision || null,
      executionSummary: {
        total: totalExec,
        active: byStatus["ACTIVE"] || 0,
        pending: byStatus["PENDING"] || 0,
        blocked: blockedExec,
        activeOrPending: activeExec,
      },
      capacity: {
        ...cap,
        currentLoad,
        loadPct,
        owner,
      },
      mcExecutions: mcRows,
      signalsPreview: sigPreview,
      unverifiedSignalCount: unverifiedN,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to build mission control summary" });
  }
});

/** Chat-page sidebar: context, signal counts, pipeline step, core memory, inspector summary. */
app.get("/api/chat/sidebar", authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { sql: sigTenantSql, params: sigTenantParams } = signalsTenant(userId);

    const activeDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE user_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )[0] as Record<string, unknown> | undefined;

    const fallbackDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )[0] as Record<string, unknown> | undefined;

    const decision = activeDecision || fallbackDecision || null;

    const statusCounts = db.rawGet(
      `SELECT e.status, COUNT(*) as n
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ?
       GROUP BY e.status`,
      [userId],
    ) as { status: string; n: number }[];

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = Number(row.n);
    }

    const sigRows = db.rawGet(
      `SELECT source, COUNT(*) as n
       FROM external_signals
       WHERE state IN ('UNVERIFIED','GRACE')${sigTenantSql}
       GROUP BY source`,
      sigTenantParams,
    ) as { source: string; n: number }[];

    const sourceLabel = (s: string) => {
      const u = String(s).toUpperCase();
      if (u === "SLACK") return "Slack";
      if (u === "GITHUB") return "GitHub";
      if (u === "JIRA") return "Jira";
      if (u === "MANUAL") return "Manual";
      return s || "Other";
    };

    const signalsBySource = sigRows.map((r) => ({
      name: sourceLabel(r.source),
      count: Number(r.n) || 0,
      source: r.source,
    }));
    const signalsTotal = signalsBySource.reduce((a, b) => a + b.count, 0);

    let pipelineStepIndex = 0;
    const pipelineSteps = ["Collecting", "Processing", "Decision Ready", "Executing"];
    if (decision) {
      const st = String(decision.status || "");
      if (st === "DRAFT" || st === "UNDER_REVIEW") pipelineStepIndex = 1;
      else if (st === "ACTIVE") {
        const running = (byStatus["ACTIVE"] || 0) + (byStatus["PENDING"] || 0);
        pipelineStepIndex = running > 0 ? 3 : 2;
      } else if (st === "COMPLETED") {
        pipelineStepIndex = 3;
      }
    }

    const memoryLines: string[] = [];
    const pushLines = (blob: string | null) => {
      if (!blob?.trim()) return;
      for (const line of blob.split("\n")) {
        const t = line.replace(/^-\s*/, "").trim();
        if (t) memoryLines.push(t);
      }
    };
    pushLines(db.getCoreMemory(userId, "user_profile"));
    pushLines(db.getCoreMemory(userId, "persona"));
    if (memoryLines.length > 8) memoryLines.length = 8;

    let contextTitle = "No decision in ledger";
    let contextDescription =
      "Create a decision from Mission Control or ask the agent to log a strategic vow.";
    if (decision) {
      contextTitle = String(decision.vow || "Decision").slice(0, 160);
      let desc = "";
      try {
        const eo = decision.expected_outcomes;
        if (typeof eo === "string" && eo) {
          const j = JSON.parse(eo);
          if (Array.isArray(j) && j.length) {
            desc = j
              .map((x: unknown) => {
                if (typeof x === "string") return x;
                const o = x as { metric?: string; target?: string };
                if (o?.metric) return `${o.metric}${o.target != null ? `: ${o.target}` : ""}`;
                return JSON.stringify(x);
              })
              .join(" · ");
          }
        }
      } catch {
        desc = String(decision.expected_outcomes || "").slice(0, 280);
      }
      if (!desc) {
        try {
          const raw = String(decision.constraints || "[]");
          const c = JSON.parse(raw);
          if (Array.isArray(c) && c.length) desc = c.map(String).slice(0, 3).join(" · ");
        } catch {
          /* ignore */
        }
      }
      contextDescription = (desc || `Status: ${decision.status}`).slice(0, 280);
    }

    let inspector: Record<string, unknown> | null = null;
    if (decision) {
      const rawConf = decision.confidence != null ? Number(decision.confidence) : 0.75;
      const confPct =
        !Number.isNaN(rawConf) && rawConf <= 1
          ? Math.round(rawConf * 100)
          : Math.round(rawConf);
      const factors: string[] = [];
      try {
        const c = JSON.parse(String(decision.constraints || "[]"));
        if (Array.isArray(c)) factors.push(...c.map(String).filter(Boolean).slice(0, 6));
      } catch {
        /* ignore */
      }
      if (factors.length < 2) {
        try {
          const eo = JSON.parse(String(decision.expected_outcomes || "[]"));
          if (Array.isArray(eo)) {
            for (const x of eo) {
              if (factors.length >= 6) break;
              if (typeof x === "string") factors.push(x);
              else if (x && typeof x === "object") {
                const o = x as { metric?: string; target?: string };
                factors.push(`${o.metric || "Metric"}: ${o.target ?? "—"}`);
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (factors.length === 0) {
        factors.push(`Ledger status: ${decision.status}`, `Confidence ${confPct}%`);
      }
      const roiHint = factors.slice(0, 2).join(" · ") || "Track execution outcomes in Mission Control.";
      inspector = {
        title: String(decision.vow || "Decision").slice(0, 120),
        why: factors[0] || `Decision is ${decision.status}.`,
        factors,
        impact: confPct >= 75 ? "High" : confPct >= 45 ? "Medium" : "Low",
        roi: String(decision.reversal_conditions || roiHint).slice(0, 220),
        confidence: confPct,
      };
    }

    res.json({
      context: {
        title: contextTitle,
        description: contextDescription,
        decisionStatus: decision ? String(decision.status) : null,
        decisionId: decision ? String(decision.id) : null,
      },
      signals: {
        total: signalsTotal,
        bySource: signalsBySource,
      },
      pipeline: {
        stepIndex: pipelineStepIndex,
        steps: pipelineSteps,
      },
      memory: memoryLines,
      inspector,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message || "chat sidebar failed" });
  }
});

app.get("/api/execution/capacity", authMiddleware, (req, res) => {
  try {
    const owner = (req.query.owner as string) || "system";
    const capacity = db.getOwnerCapacity(owner);
    const activeTasks = db.rawGet("SELECT sum(weight) as total_weight FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'", [owner]);
    res.json({ ...capacity, currentLoad: activeTasks[0]?.total_weight || 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch capacity" });
  }
});

app.post("/api/execution/transition", authMiddleware, (req, res) => {
  const { taskId, newState, reason } = req.body as { taskId?: string; newState?: string; reason?: string };
  const userId = (req as any).userId as string;
  try {
    if (!taskId || !newState) return res.status(400).json({ error: "taskId and newState required" });
    const tenant = db.getExecutionTenantForTask(taskId);
    if (!tenant) return res.status(404).json({ error: "Task not found" });
    if (userId !== "system" && tenant !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = db.transitionExecutionState(taskId, newState, reason);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/execution/link", authMiddleware, (req, res) => {
  const { signalId, taskId } = req.body as { signalId?: string; taskId?: string };
  const userId = (req as any).userId as string;
  try {
    if (!signalId || !taskId) return res.status(400).json({ error: "signalId and taskId required" });
    const sigT = db.getSignalTenant(signalId);
    const execT = db.getExecutionTenantForTask(taskId);
    if (!sigT || !execT) return res.status(404).json({ error: "Signal or task not found" });
    if (userId !== "system" && (sigT !== userId || execT !== userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    db.linkExternalSignalToTask(signalId, taskId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to link signal" });
  }
});

/** Operator: full auditor sweep (cron remains the safety net). */
app.post("/api/audit/run", authMiddleware, (_req, res) => {
  try {
    auditor.evaluateAll();
    res.json({ success: true, scope: "full" });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "audit run failed" });
  }
});

// --- Settings Endpoints ---
app.get("/api/settings", authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  try {
    const data = db.rawGet("SELECT key, value FROM settings WHERE user_id = ?", [userId]);
    const settingsObj = data.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json({ settings: settingsObj });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.post("/api/settings", authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { key, value } = req.body;
  try {
    db.updateSetting(userId, key, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update setting" });
  }
});

app.post("/api/settings/bulk", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const body = req.body as { settings?: Record<string, string> };
  try {
    const entries = Object.entries(body.settings || {});
    for (const [k, v] of entries) {
      db.updateSetting(userId, k, String(v));
    }
    res.json({ success: true, updated: entries.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to bulk update settings" });
  }
});

app.get("/api/me", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const row =
      userId === "system"
        ? { id: "system", username: "system", created_at: null }
        : (db.getUserById(userId) as { id: string; username: string; created_at: string } | undefined);
    const settingsRows = db.rawGet("SELECT key, value FROM settings WHERE user_id = ?", [userId]) as {
      key: string;
      value: string;
    }[];
    const prof: Record<string, string> = {};
    for (const r of settingsRows) {
      if (r.key.startsWith("profile.")) prof[r.key.slice("profile.".length)] = r.value;
    }

    const decisionsCreated = (
      db.rawGet(
        `SELECT COUNT(*) as c FROM decision_ledger WHERE user_id = ?`,
        [userId],
      ) as { c: number }[]
    )[0]?.c ?? 0;
    const executionsOwned = (
      db.rawGet(
        `SELECT COUNT(*) as c FROM execution_ledger e
         INNER JOIN decision_ledger d ON e.decision_id = d.id WHERE d.user_id = ?`,
        [userId],
      ) as { c: number }[]
    )[0]?.c ?? 0;
    const terminal = (
      db.rawGet(
        `SELECT 
           SUM(CASE WHEN e.status = 'DONE' THEN 1 ELSE 0 END) as done,
           SUM(CASE WHEN e.status = 'KILLED' THEN 1 ELSE 0 END) as killed
         FROM execution_ledger e
         INNER JOIN decision_ledger d ON e.decision_id = d.id WHERE d.user_id = ?`,
        [userId],
      ) as { done: number; killed: number }[]
    )[0];
    const done = Number(terminal?.done || 0);
    const killed = Number(terminal?.killed || 0);
    const denom = done + killed;
    const successRatePct = denom > 0 ? Math.round((done / denom) * 100) : 0;
    const { sql: sigSql, params: sigParams } = signalsTenant(userId);
    const signalsLinked = (
      db.rawGet(`SELECT COUNT(*) as c FROM external_signals WHERE state = 'LINKED'${sigSql}`, sigParams) as {
        c: number;
      }[]
    )[0]?.c ?? 0;

    res.json({
      user: row || { id: userId, username: userId, created_at: null },
      profile: {
        displayName: prof.display_name || row?.username || userId,
        bio: prof.bio || "",
        email: prof.email || "",
        phone: prof.phone || "",
        location: prof.location || "",
        department: prof.department || "",
      },
      stats: {
        decisionsCreated,
        executionsOwned,
        signalsLinked,
        successRatePct,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/me", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") {
    return res.status(400).json({ error: "Profile updates require a non-system user account." });
  }
  try {
    const body = req.body as {
      profile?: Partial<{
        displayName: string;
        bio: string;
        email: string;
        phone: string;
        location: string;
        department: string;
      }>;
    };
    const p = body.profile || {};
    const entries: [string, string][] = [
      ["displayName", "profile.display_name"],
      ["bio", "profile.bio"],
      ["email", "profile.email"],
      ["phone", "profile.phone"],
      ["location", "profile.location"],
      ["department", "profile.department"],
    ];
    let n = 0;
    for (const [field, key] of entries) {
      const v = (p as Record<string, unknown>)[field];
      if (v !== undefined) {
        db.updateSetting(userId, key, String(v).slice(0, 4000));
        n++;
      }
    }
    res.json({ success: true, updated: n });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function auditActivitySource(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("LOGIN") || a.includes("SESSION") || a.includes("PASSWORD")) return "Security";
  if (a.includes("OAUTH") || a.includes("GITHUB") || a.includes("GOOGLE")) return "Web";
  if (a.includes("SLACK")) return "Slack";
  if (a.includes("SIGNAL")) return "Signals";
  return "Ledger";
}

app.get("/api/activity", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "80"), 10) || 80));
  const sinceRaw = req.query.since as string | undefined;
  const actionLikeRaw = (req.query.actionLike as string | undefined)?.trim();

  let sql = `SELECT a.action, a.reason, a.timestamp, a.affected_entity_id
       FROM audit_log a
       LEFT JOIN decision_ledger d ON a.affected_entity_id = d.id
       LEFT JOIN execution_ledger e ON a.affected_entity_id = e.task_id
       LEFT JOIN decision_ledger d2 ON e.decision_id = d2.id
       WHERE (d.user_id = ? OR d2.user_id = ?)`;
  const params: unknown[] = [userId, userId];

  if (sinceRaw) {
    sql += ` AND datetime(a.timestamp) >= datetime(?)`;
    params.push(sinceRaw);
  }
  if (actionLikeRaw && /^[A-Za-z0-9_%]+$/.test(actionLikeRaw)) {
    sql += ` AND a.action LIKE ?`;
    params.push(actionLikeRaw.includes("%") ? actionLikeRaw : `${actionLikeRaw}%`);
  }

  sql += ` ORDER BY a.timestamp DESC LIMIT ?`;
  params.push(limit);

  try {
    const rows = db.rawGet(sql, params) as {
      action: string;
      reason: string;
      timestamp: string;
      affected_entity_id: string | null;
    }[];
    const activity = rows.map((r) => ({
      ...r,
      source: auditActivitySource(r.action),
    }));
    res.json({ activity });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/decisions", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const status = req.query.status as string | undefined;
  try {
    let sql = `SELECT id, vow, status, confidence, created_at, expected_outcomes
               FROM decision_ledger WHERE user_id = ?`;
    const params: unknown[] = [userId];
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC`;
    const decisions = db.rawGet(sql, params);
    res.json({ decisions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/decisions/commit", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const { decisionId, justification } = req.body as { decisionId?: string; justification?: string };
  if (!decisionId) return res.status(400).json({ error: "decisionId required" });
  try {
    commitDecisionActive(userId, decisionId, justification);
    res.json({ success: true, decisionId, status: "ACTIVE" });
  } catch (e: any) {
    const msg = e.message || String(e);
    const status = msg.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: msg });
  }
});

/** Create a DRAFT decision (optional default task). */
app.post("/api/decisions", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const body = req.body as {
    vow?: string;
    expected_outcomes?: unknown[];
    tasks?: { type?: string; weight?: number; owner?: string }[];
  };
  const vow = String(body.vow || "").trim();
  if (!vow) return res.status(400).json({ error: "vow required" });
  try {
    const tasks =
      Array.isArray(body.tasks) && body.tasks.length > 0
        ? body.tasks.map((t) => ({
            type: t.type || "ACTION",
            weight: typeof t.weight === "number" ? t.weight : 1,
            owner: String(t.owner || "system").slice(0, 120),
          }))
        : [{ type: "ACTION", weight: 1, owner: "system" }];
    const id = db.saveDecisionEvent(userId, {
      vow: vow.slice(0, 4000),
      expected_outcomes: Array.isArray(body.expected_outcomes)
        ? body.expected_outcomes
        : [{ metric: "Outcome", target: "Define success criteria" }],
      constraints: [],
      confidence: 0.75,
      tasks,
    });
    res.status(201).json({ id, status: "DRAFT" });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Failed to create decision" });
  }
});

app.post("/api/execution/signals/kill", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const { signalId } = req.body as { signalId?: string };
  if (!signalId) return res.status(400).json({ error: "signalId required" });
  try {
    const tenant = db.getSignalTenant(signalId);
    if (!tenant) return res.status(404).json({ error: "Signal not found" });
    if (userId !== "system" && tenant !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    db.killExternalSignal(signalId);
    res.json({ success: true, signalId });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to kill signal" });
  }
});

app.get("/api/metrics/reports", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const completed = Number(
      (
        db.rawGet(
          `SELECT COUNT(*) as c FROM decision_ledger WHERE user_id = ? AND status = 'COMPLETED'`,
          [userId],
        ) as { c: number }[]
      )[0]?.c || 0,
    );
    const done = Number(
      (
        db.rawGet(
          `SELECT SUM(CASE WHEN e.status = 'DONE' THEN 1 ELSE 0 END) as c
           FROM execution_ledger e INNER JOIN decision_ledger d ON e.decision_id = d.id WHERE d.user_id = ?`,
          [userId],
        ) as { c: number }[]
      )[0]?.c || 0,
    );
    const killed = Number(
      (
        db.rawGet(
          `SELECT SUM(CASE WHEN e.status = 'KILLED' THEN 1 ELSE 0 END) as c
           FROM execution_ledger e INNER JOIN decision_ledger d ON e.decision_id = d.id WHERE d.user_id = ?`,
          [userId],
        ) as { c: number }[]
      )[0]?.c || 0,
    );
    const denom = done + killed;
    const execSuccessPct = denom > 0 ? Math.round((done / denom) * 100) : 0;
    const { sql: repSigSql, params: repSigParams } = signalsTenant(userId);
    const signalsKilled = Number(
      (
        db.rawGet(`SELECT COUNT(*) as c FROM external_signals WHERE state = 'KILLED'${repSigSql}`, repSigParams) as {
          c: number;
        }[]
      )[0]?.c || 0,
    );

    const daily = db.rawGet(
      `SELECT date(timestamp) as day,
          SUM(CASE WHEN reason LIKE '%New State: DONE%' THEN 1 ELSE 0 END) as wins,
          COUNT(*) as events
       FROM audit_log
       WHERE timestamp > datetime('now', '-14 days')
       GROUP BY date(timestamp)
       ORDER BY day ASC`,
    ) as { day: string; wins: number; events: number }[];

    const chart = daily.map((d) => {
      const load = Math.min(100, (Number(d.events) || 0) * 4);
      const success = Math.min(100, 35 + (Number(d.wins) || 0) * 12);
      return {
        date: String(d.day).slice(5),
        success,
        load,
      };
    });

    const underReview = db.rawGet(
      `SELECT id, vow FROM decision_ledger WHERE user_id = ? AND status = 'UNDER_REVIEW' LIMIT 6`,
      [userId],
    ) as { id: string; vow: string }[];

    const blocked = db.rawGet(
      `SELECT e.success_condition, e.owner, e.blocked_reasons
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ? AND e.status = 'BLOCKED'
       ORDER BY e.last_update DESC
       LIMIT 6`,
      [userId],
    );

    const unverified = Number(
      (
        db.rawGet(
          `SELECT COUNT(*) as c FROM external_signals WHERE state IN ('UNVERIFIED','GRACE')${repSigSql}`,
          repSigParams,
        ) as { c: number }[]
      )[0]?.c || 0,
    );

    let overloadDay: string | null = null;
    let maxLoad = -1;
    for (const p of chart) {
      if (p.load > maxLoad) {
        maxLoad = p.load;
        overloadDay = p.date;
      }
    }

    res.json({
      kpis: [
        {
          label: "Decisions Completed",
          value: String(completed),
          sub: "All time",
          trend: completed > 0 ? "↑ ledger" : "—",
          trendUp: true,
        },
        {
          label: "Execution Success Rate",
          value: `${execSuccessPct}%`,
          sub: "DONE vs terminal",
          trend: denom > 0 ? `${done} done / ${killed} killed` : "No terminal tasks",
          trendUp: execSuccessPct >= 60,
        },
        {
          label: "Signals Killed",
          value: String(signalsKilled),
          sub: "Shadow work enforcement",
          trend: "Global count",
          trendUp: true,
        },
      ],
      chart: chart.length ? chart : [{ date: "—", success: 0, load: 0 }],
      issues: {
        underperformingDecisions: underReview.map((u) => ({
          title: u.vow.slice(0, 48),
          delta: "UNDER_REVIEW",
        })),
        bottlenecks: (blocked as { success_condition: string; owner: string; blocked_reasons: string }[]).map(
          (b) => ({
            title: b.success_condition || "Task",
            detail: `${b.owner}: ${(b.blocked_reasons || "").slice(0, 80)}`,
          }),
        ),
        signalNoise: {
          unverified,
        },
      },
      overloadDay,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/metrics/teams", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const owners = db.rawGet(
      `SELECT e.owner as owner,
          COUNT(*) as total_tasks,
          SUM(CASE WHEN e.status = 'ACTIVE' THEN e.weight ELSE 0 END) as active_weight,
          SUM(CASE WHEN e.status = 'BLOCKED' THEN 1 ELSE 0 END) as blocked_n,
          SUM(CASE WHEN e.status = 'PENDING' THEN 1 ELSE 0 END) as pending_n
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ?
       GROUP BY e.owner
       ORDER BY e.owner`,
      [userId],
    ) as {
      owner: string;
      total_tasks: number;
      active_weight: number;
      blocked_n: number;
      pending_n: number;
    }[];

    const members = owners.map((o, i) => {
      const cap = db.getOwnerCapacity(o.owner);
      const load = Number(o.active_weight || 0);
      const capN = cap.capacity || 3;
      const loadPct = Math.min(100, Math.round((load / capN) * 100));
      const utilization = Math.min(100, loadPct + (Number(o.blocked_n) > 0 ? 15 : 0));
      let status: "Healthy" | "At Risk" | "Over Capacity" = "Healthy";
      if (load > capN) status = "Over Capacity";
      else if (load > capN * 0.85 || Number(o.blocked_n) > 0) status = "At Risk";
      return {
        id: String(i + 1),
        name: o.owner === "system" ? "System" : o.owner,
        email: `${o.owner}@owners.local`,
        role: "Owner",
        team: "Execution",
        capacity: `${capN.toFixed(1)} wt`,
        loadPct,
        utilization,
        status,
      };
    });

    let totalCap = 0;
    let totalLoad = 0;
    for (const o of owners) {
      const cap = db.getOwnerCapacity(o.owner).capacity;
      totalCap += cap;
      totalLoad += Number(o.active_weight || 0);
    }
    const usedPct = totalCap > 0 ? Math.round((totalLoad / totalCap) * 100) : 0;
    const over = Math.max(0, totalLoad - totalCap);
    const available = Math.max(0, totalCap - totalLoad);

    const insights: string[] = [];
    const overN = members.filter((m) => m.status === "Over Capacity").length;
    const riskN = members.filter((m) => m.status === "At Risk").length;
    if (overN) insights.push(`${overN} owner(s) over capacity — redistribute weight.`);
    if (riskN) insights.push(`${riskN} owner(s) at risk — resolve blocked tasks.`);

    const deptBars = owners.map((o) => {
      const cap = db.getOwnerCapacity(o.owner).capacity || 3;
      const load = Number(o.active_weight || 0);
      return {
        dept: o.owner,
        pct: Math.min(100, Math.round((load / cap) * 100)),
      };
    });

    res.json({
      metrics: {
        members: members.length || 1,
        membersNote: `${owners.length} execution owner(s)`,
        utilization: usedPct,
        utilTrend: totalCap > 0 ? `Load ${totalLoad.toFixed(1)} / ${totalCap.toFixed(1)}` : "—",
        atRisk: riskN,
        overCapacity: overN,
      },
      members: members.length ? members : [],
      donut: {
        total: Math.round(totalCap * 10) || 100,
        used: Math.round(totalLoad * 10),
        usedPct,
        available: Math.round(available * 10),
        availablePct: totalCap > 0 ? Math.round((available / totalCap) * 100) : 0,
        over: Math.round(over * 10),
        overPct: totalCap > 0 ? Math.round((over / totalCap) * 100) : 0,
      },
      deptBars: deptBars.length ? deptBars : [{ dept: "system", pct: 0 }],
      insights,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Logs & Stats ---
app.get("/api/health", (_req, res) => {
  let dbOk = false;
  try {
    db.rawGet("SELECT 1 as ok");
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "online" : "degraded",
    db: dbOk,
    uptimeSec: Math.floor((Date.now() - serverStartedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// --- WebSocket Orchestration ---
export type AgentWsReply = (payload: Record<string, unknown>) => void;

let onMessage:
  | ((
      userId: string,
      text: string,
      sessionId: string,
      reply: AgentWsReply,
    ) => Promise<void>)
  | null = null;

export function setAgentMessageHandler(
  handler: (
    userId: string,
    text: string,
    sessionId: string,
    reply: AgentWsReply,
  ) => Promise<void>,
) {
  onMessage = handler;
}

export function broadcast(type: string, data: any) {
  const payload = JSON.stringify({ type, ...data });
  wssSingleton?.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function wireWebSocketHandlers(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
  const resolved = resolveWsUserId(req);
  if (resolved === null) {
    ws.send(JSON.stringify({ type: "auth_error", error: "Unauthorized WebSocket connection." }));
    ws.close(4401, "Unauthorized");
    return;
  }
  const userId = resolved;

  // Send sessions list on connect
  const sessions = db.rawGet("SELECT DISTINCT session_id FROM messages WHERE user_id = ? ORDER BY timestamp DESC", [userId]);
  ws.send(JSON.stringify({ type: "sessions", data: sessions }));

  ws.on("message", async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      
      if (payload.type === "load_session") {
        const sid = payload.sessionId || "default";
        const history = db.getRecentMessages(userId, sid, 200);
        ws.send(JSON.stringify({ type: "history", sessionId: sid, data: history }));
      }
      else if (payload.type === "text" && onMessage) {
        const sid = payload.sessionId || "default";
        const reply: AgentWsReply = (obj) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
        };
        await onMessage(userId, payload.text, sid, reply);
      }
      else if (payload.type === "COMMIT_DECISION") {
        console.log(`🛡️ [Decision] Committing decision ${payload.decisionId}...`);
        try {
          commitDecisionActive(userId, payload.decisionId, payload.justification);
          broadcast("DECISION_COMMITTED", { decisionId: payload.decisionId, status: "ACTIVE" });
        } catch (err: any) {
          console.error("❌ [Decision] Commit failed:", err?.message || err);
          broadcast("DECISION_COMMIT_FAILED", {
            decisionId: payload.decisionId,
            error: err?.message || String(err),
          });
        }
      }
      else if (payload.type === "SYNC_PROTOCOLS") {
        await connectionsManager.syncProtocols();
      }
      else if (payload.type === "new_session") {
        const newSessId = uuidv4();
        ws.send(JSON.stringify({ type: "session_created", sessionId: newSessId }));
      }
      else if (payload.type === "CAPABILITY_OVERRIDE") {
        connectionsManager.updateStatus(payload.id, payload.status, payload.reason);
      }
    } catch (err) {
      console.error("❌ [Server] Inbound message error:", err);
    }
  });
  });
}

export function startServer() {
  const PORT = config.server.port;
  const srv = createServer(app);
  attachWebSocketServer(srv);
  srv.listen(PORT, () => {
    console.log(`🌐 [Hustronix Server] Live on http://localhost:${PORT}`);
  });
}

export { app };
