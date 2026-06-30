import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer, type Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { db } from "./database.js";
import { hasLlmCredentials } from "./llm.js";
import {
  ROSTER_FIELD_SCHEMA,
  rowsToRosterMembers,
  parsePdfTextToRoster,
  extractTextFromPdfBuffer,
} from "./teams/rosterImport.js";
import { buildTeamEntries, mapRosterRow } from "./teams/teamsMembers.js";
import {
  listBeliefsForEntity,
  computeDerivedCapacity,
  buildOwnerProfile,
  computeCalibration,
  listPredictions,
  listEvidenceForEntity,
  listGraphNeighbors,
  replayBeliefsForTenant,
} from "./execution-intelligence/index.js";
import { ALGORITHM_VERSION, FEATURE_VERSION, MODEL_VERSION } from "./execution-intelligence/config.js";
import path from "path";
import { transcribeBuffer } from "./audio.js";
import { v4 as uuidv4 } from "uuid";
import { connectionsManager } from "./connections_manager.js";
import { authMiddleware, resolveWsAuth, type WsAuthContext } from "./middleware/auth.js";
import { jsonErrorHandler } from "./middleware/errorHandler.js";
import {
  assertWritableSettingKey,
  filterWritableSettings,
  InvalidSettingKeyError,
} from "./security/settings-keys.js";
import type { AuthKind } from "./middleware/auth.js";
import { authorizeWsAction, wsActionFromPayload } from "./security/action-authorization.js";
import { AuthorizationError } from "./security/authorization-errors.js";
import { userHasPermission, requirePermission, principalRole } from "./security/authorization.js";
import { computeTrustMetrics } from "./security/trust-metrics.js";
import { getSecurityDashboard } from "./security/security-observability.js";
import {
  computeOrganizationalTruth,
  getCurrentOrganizationalTruth,
} from "./security/organizational-truth.js";
import { explainMemoryFact } from "./security/memory-fact.js";
import { listBeliefs, explainBelief } from "./beliefs/belief-engine.js";
import { runCausalSimulation } from "./simulation/causal-simulator.js";
import { computeDigitalTwin } from "./state/digital-twin.js";
import {
  listEntities,
  getEntity,
  getEntityNeighbors,
  getEntityTimeline,
  isEntityType,
} from "./entities/index.js";
import {
  getOrganizationState,
  getCurrentStateVersion,
  listStateVersions,
  diffStateVersions,
  rollbackStateVersion,
  parseSnapshot,
  listDoctrineRules,
  createDoctrineRule,
  updateDoctrineRule,
  supersedeDoctrineRule,
  getDoctrineRule,
  rebuildOrganizationState,
} from "./state/index.js";
import { approvePendingAction, getApprovalById, listPendingApprovals } from "./security/approval-gate.js";
import { assertResourceTenantAccess, resolveTenantContext, tenantSqlScope } from "./security/tenant-context.js";
import { assertLedgerTenantAccess } from "./security/tenant-scope.js";
import { authorizeAndExecuteMutation } from "./security/security-gateway.js";
import {
  mutationCommitDecision,
  mutationCreateDraftDecision,
  mutationKillSignal,
  mutationLinkSignal,
  mutationTransitionExecution,
  mutationUnlinkSignal,
} from "./security/mutation-handlers.js";
import { checkWsRateLimit } from "./middleware/ws-rate-limit.js";
import {
  aiRouteLimiter,
  authRouteLimiter,
  globalApiLimiter,
  mutationRouteLimiter,
  passwordRouteLimiter,
  earlyAccessRouteLimiter,
  marketingContactRouteLimiter,
} from "./middleware/rateLimit.js";
import { handleEarlyAccessRequest } from "./early-access.js";
import { handleMarketingContactRequest } from "./marketing-contact.js";
import { buildCorsOptions } from "./security/cors.js";
import { csrfOriginGuard } from "./security/csrf.js";
import { recordSecurityEvent } from "./security/audit.js";
import { requireHttpsMiddleware, securityHeadersMiddleware } from "./security/httpSecurity.js";
import { getRequestId, logJson, requestContextMiddleware } from "./security/requestContext.js";
import { sqliteDatetimeToIso } from "./utils/sqlite-datetime.js";
import {
  canonicalJson,
  hashLedgerEvent,
  signLedgerEvent,
  type LedgerAggregateType,
  type LedgerActorType,
} from "./security/ledgerIntegrity.js";
import {
  hashPassword,
  verifyBcrypt,
  verifyLegacySha256,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  isValidEmailFormat,
} from "./auth/password.js";
import { hashOpaqueToken, randomHex, newApiAccessTokenPlain } from "./auth/tokens.js";
import { randomOtpDigits, hashEmailOtpCode, verifyEmailOtpCode } from "./auth/emailOtp.js";
import { smtpConfigured, sendOtpEmail, deliverSignupOtp } from "./auth/smtp.js";
import { totpMasterKeyBytes, encryptTotpPayload, decryptTotpPayload } from "./auth/totpVault.js";
import {
  generateTotpSecret,
  buildTotpKeyUri,
  verifyTotpToken,
  generateBackupCodesPlain,
  normalizeBackupCode,
} from "./auth/totpCore.js";
import { handleSlackEventsRequest } from "./integrations/slackEvents.js";
import { auditor } from "./auditor.js";
import {
  fetchDecisionContext,
  hybridSearch,
  processSignal,
  warmEmbeddingsForActiveLedger,
  findDriftSignals,
  findOverloadedOwners,
  findConflictingExecutions,
  findSignalsRelatedToTask,
  operationalSearch,
  weeklyDriftReport,
  operationalHealth,
  formatWeeklyDriftMarkdown,
  formatHealthMarkdown,
  ingestMeeting,
} from "./intelligence/index.js";
import { ingestExternal, ingestExternalBatch, IngestError } from "./integrations/ingestRouter.js";
import { notify, defaultAppLink } from "./notifications/dispatcher.js";
import { startNotificationDigestScheduler } from "./notifications/digest.js";
import {
  verifyGithubSignature,
  verifyJiraBearer,
  verifyCrmBearer,
  transformGithubWebhook,
  transformJiraWebhook,
  transformCrmWebhook,
} from "./integrations/webhookTransforms.js";
import { mountOAuthRoutes } from "./auth/oauthRoutes.js";
import { startOAuthRefreshWorker } from "./auth/oauthRefreshWorker.js";
import { listConnectionStatuses } from "./auth/oauthConnections.js";
import { assertOAuthEncryptionConfigured } from "./auth/oauthCrypto.js";
import { mountGithubRoutes } from "./integrations/githubRoutes.js";
import { registerGithubLifecycleHooks } from "./integrations/githubConnector.js";
import { mountMicrosoftRoutes } from "./integrations/microsoftRoutes.js";
import {
  registerMicrosoftLifecycleHooks,
  startMicrosoftRenewalWorker,
} from "./integrations/microsoftConnector.js";
import { mountMicrosoftWebhook } from "./integrations/microsoftWebhook.js";
import { registerLinearLifecycleHooks } from "./integrations/linearConnector.js";
import {
  registerJiraLifecycleHooks,
  startJiraRenewalWorker,
} from "./integrations/jiraConnector.js";
import {
  registerNotionLifecycleHooks,
  startNotionPollWorker,
} from "./integrations/notionConnector.js";
import {
  registerGoogleLifecycleHooks,
  startGoogleWorkers,
} from "./integrations/googleConnector.js";
import { mountGoogleWebhook } from "./integrations/googleWebhook.js";
import { mountGoogleRoutes } from "./integrations/googleRoutes.js";
import { mountConnectionsHealthRoute } from "./integrations/connectionsHealth.js";
import { getGraphImpact } from "./security/evidence-graph.js";

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

/** First-time org owner stamp: per-user org.role / org.owner_user_id; profile.role only if unset. */
function stampOrgOwnerIfUnset(userId: string): void {
  if (!userId || userId === "system") return;
  const currentRole = (db.getSetting(userId, "org.role") || "").trim();
  if (currentRole) return;
  db.updateSetting(userId, "org.role", "Owner");
  db.updateSetting(userId, "org.owner_user_id", userId);
  const profileRole = (db.getSetting(userId, "profile.role") || "").trim();
  if (!profileRole) {
    db.updateSetting(userId, "profile.role", "Owner");
  }
}

function issueSession(res: express.Response, userId: string, req: express.Request) {
  const plain = randomHex(32);
  const tokenHash = hashOpaqueToken(plain);
  const sid = uuidv4();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const userAgent = (req.headers["user-agent"] as string) || null;
  const ip = req.ip || req.socket.remoteAddress || null;
  const deviceFingerprint = hashOpaqueToken(`${userAgent || ""}|${ip || ""}`).slice(0, 32);
  if (db.countActiveUserSessions(userId) >= config.server.maxConcurrentSessions) {
    db.revokeOldestActiveSessions(userId, Math.max(0, config.server.maxConcurrentSessions - 1));
    recordSecurityEvent(req, "auth.concurrent_session_limit_enforced", "warning", {
      userId,
      maxConcurrentSessions: config.server.maxConcurrentSessions,
    });
  }
  db.createUserSession({
    id: sid,
    userId,
    tokenHash,
    expiresAtIso: expires,
    userAgent,
    ip,
    deviceFingerprint,
  });
  attachSessionCookie(res, plain);
  res.clearCookie(LEGACY_UID_COOKIE, { path: "/" });
  return { plainToken: plain, sessionId: sid };
}

function totpMasterKeyConfigured(): boolean {
  return Boolean(config.server.totpEncryptionKey?.trim());
}

function getTotpMasterKeyBytes(): Buffer {
  return totpMasterKeyBytes(config.server.totpEncryptionKey);
}

function userTotpActive(userId: string): boolean {
  const r = db.getUserTotpRow(userId);
  return Boolean(r && r.totp_enabled === 1 && r.totp_secret_encrypted);
}

/** Second factor for password login only (not signup verification). */
function loginRequiresSecondFactor(userId: string): { totp: boolean; emailOtp: boolean } {
  const totpEnrolled = userTotpActive(userId);
  const emailOtpOptIn = (db.getSetting(userId, "security.email_otp_login") || "").trim().toLowerCase();
  const emailOtpEnabled =
    emailOtpOptIn === "1" || emailOtpOptIn === "true" || emailOtpOptIn === "on";
  return { totp: totpEnrolled, emailOtp: emailOtpEnabled };
}

function parseTotpBackupHashesJson(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function buildTotpLoginResponse(userId: string) {
  db.deleteExpiredLoginTotpChallenges();
  db.deleteOpenLoginTotpChallengesForUser(userId);
  const totpToken = randomHex(32);
  const tokenHash = hashOpaqueToken(totpToken);
  const expiresAtIso = new Date(
    Date.now() + config.server.totpLoginPendingMinutes * 60 * 1000,
  ).toISOString();
  db.insertLoginTotpChallenge({ tokenHash, userId, expiresAtIso });
  return {
    success: false as const,
    totpRequired: true as const,
    totpToken,
    expiresInSeconds: config.server.totpLoginPendingMinutes * 60,
  };
}

/** After password (and optional email OTP when required): session, TOTP step, or 503 if server cannot verify 2FA. */
function completePrimaryLogin(res: express.Response, req: express.Request, userId: string) {
  if (!userTotpActive(userId)) {
    const sess = issueSession(res, userId, req);
    recordSecurityEvent(req, "auth.login_success", "info", { userId, sessionId: sess.sessionId });
    return res.json({ success: true, userId, sessionId: sess.sessionId });
  }
  if (!totpMasterKeyConfigured()) {
    return res.status(503).json({
      error:
        "This account has two-factor authentication enabled, but the server is missing TOTP_ENCRYPTION_KEY. Add it to the API .env and restart.",
      code: "totp_server_misconfigured",
    });
  }
  return res.json(buildTotpLoginResponse(userId));
}

function commitDecisionActive(
  userId: string,
  decisionId: string,
  justification?: string,
  options?: { approvalId?: string; emergencyOverride?: boolean; emergencyReason?: string },
  authKind?: AuthKind | string,
) {
  return authorizeAndExecuteMutation(
    {
      userId,
      authKind,
      permission: "decision:commit",
      actionType: "commit_decision",
      toolName: "commit_decision",
      toolArgs: { decisionId, justification: justification ?? "" },
      resourceTenantId: db.getDecisionTenant(decisionId),
      approvalId: options?.approvalId,
      emergencyOverride: options?.emergencyOverride,
      emergencyReason: options?.emergencyReason,
    },
    () => mutationCommitDecision(userId, decisionId, justification, options),
  );
}

function appendAuthorityLedgerEvent(params: {
  req: express.Request;
  orgId: string;
  aggregateType: LedgerAggregateType;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  policyVersion?: string;
}) {
  const actorId = String((params.req as any).userId || "system");
  const authKind = String((params.req as any).authKind || "");
  const actorType: LedgerActorType =
    actorId === "system" ? "system" : authKind === "api_token" ? "agent" : "user";
  const previousHash = db.getLastLedgerEventHash(
    params.orgId,
    params.aggregateType,
    params.aggregateId,
  );
  const input = {
    orgId: params.orgId,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    eventType: params.eventType,
    payload: params.payload,
    actorType,
    actorId,
    policyVersion: params.policyVersion || "local-v1",
    capabilityId: null,
    causationEventId: null,
    correlationId: getRequestId(params.req) || uuidv4(),
    previousHash,
  };
  const eventHash = hashLedgerEvent(input);
  db.appendLedgerEvent({
    id: uuidv4(),
    ...input,
    payloadJson: canonicalJson(params.payload),
    eventHash,
    signature: signLedgerEvent(eventHash, config.server.ledgerSigningKey),
  });
}

/** SQL fragment + params for tenant-scoped external_signals. */
function signalsTenant(userId: string): { sql: string; params: unknown[] } {
  if (!userId || userId === "system") {
    return { sql: " AND 1 = 0", params: [] };
  }
  return tenantSqlScope(resolveTenantContext(userId));
}

/** Tenant scope for decision_ledger joins (`d` alias). */
function ledgerTenantScope(userId: string): { sql: string; params: unknown[] } {
  const scope = tenantSqlScope(resolveTenantContext(userId));
  return {
    sql: scope.sql.replace(/\borg_id\b/g, "d.org_id").replace(/\buser_id\b/g, "d.user_id"),
    params: scope.params,
  };
}

function assertKnownTenantUserId(tenantUserId: string, res: express.Response): boolean {
  const id = String(tenantUserId || "").trim();
  if (!id || !db.getUserById(id)) {
    res.status(404).json({ ok: false, error: "unknown_tenant" });
    return false;
  }
  return true;
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
  wssSingleton = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false,
  });
  wireWebSocketHandlers(wssSingleton);
}

app.use(requestContextMiddleware);
app.use(requireHttpsMiddleware);
app.use(securityHeadersMiddleware);
app.use(cors(buildCorsOptions()));
app.use("/api", globalApiLimiter);
app.use(cookieParser());
/** Slack Events API requires raw body + HMAC signature — must run before express.json(). */
app.post(
  "/api/integrations/slack/events",
  express.raw({ type: "application/json" }),
  handleSlackEventsRequest,
);

/**
 * GitHub webhooks. Mounted BEFORE express.json() because HMAC-SHA256
 * verification needs the unmodified raw body. Tenant resolution: the URL
 * carries the tenant id (`/api/ingest/github/:tenant`) — caller must own
 * the GitHub App configuration that signs payloads with the matching secret.
 *
 * Express 5 / path-to-regexp does not accept optional `:tenant?`; register
 * `/api/ingest/github` and `/api/ingest/github/:tenant` separately.
 */
function handleGithubIngest(req: express.Request, res: express.Response) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    res.status(503).json({ ok: false, error: "missing_github_secret" });
    return;
  }
  const raw = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifyGithubSignature(raw, sig, secret)) {
    res.status(401).send("");
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    res.status(400).send("invalid_json");
    return;
  }
  const event = (req.headers["x-github-event"] as string) || "unknown";
  const deliveryId = (req.headers["x-github-delivery"] as string) || `${event}-${Date.now()}`;
  /**
   * Tenant resolution priority:
   *   1. URL path  (`/:tenant`) — what the auto-registered webhooks always use.
   *   2. Repo full_name matched against any user's monitored-repo subscription
   *      (covers manual installs that don't carry the tenant in the URL).
   *   3. GITHUB_DEFAULT_TENANT env (single-tenant fallback for development).
   */
  let tenantUserId = (
    (req.params as Record<string, string | undefined>).tenant || ""
  ).trim();
  if (!tenantUserId) {
    const repoFullName = (payload.repository as { full_name?: string } | undefined)?.full_name;
    if (repoFullName) {
      const sub = (db.rawGet(
        `SELECT user_id FROM oauth_subscriptions
         WHERE provider = 'github' AND kind = 'repo_webhook'
           AND external_resource = ?
         ORDER BY updated_at DESC LIMIT 1`,
        [repoFullName],
      ) as { user_id: string }[])[0];
      if (sub?.user_id) tenantUserId = sub.user_id;
    }
  }
  if (!tenantUserId) {
    tenantUserId = (process.env.GITHUB_DEFAULT_TENANT || "").trim();
  }
  if (!tenantUserId) {
    res.status(400).json({ ok: false, error: "missing_tenant" });
    return;
  }
  if (!assertKnownTenantUserId(tenantUserId, res)) return;

  try {
    const recs = transformGithubWebhook(payload, { userId: tenantUserId, deliveryId, event });
    const out = ingestExternalBatch(recs);
    res.status(200).json({ ok: true, accepted: out.results.length, errors: out.errors.length });
  } catch (e: any) {
    console.error("[ingest/github] failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "internal" });
  }
}

const githubRawBody = express.raw({ type: "application/json", limit: "5mb" });
app.post("/api/ingest/github", githubRawBody, handleGithubIngest);
app.post("/api/ingest/github/:tenant", githubRawBody, handleGithubIngest);

/**
 * Microsoft Graph change-notifications. Mounts both GET (validation handshake)
 * and POST (notifications). Must run BEFORE express.json() so we can parse
 * the raw buffer ourselves with explicit error handling.
 */
mountMicrosoftWebhook(app);

/**
 * Linear webhooks. HMAC-SHA256 signed with a per-webhook secret returned by
 * `webhookCreate`. We look the secret up by tenant (URL path), verify, then
 * dispatch through the standard ingest router.
 */
const linearRawBody = express.raw({ type: "application/json", limit: "5mb" });
async function handleLinearIngest(req: express.Request, res: express.Response): Promise<void> {
  const { getLinearConnectionForUser } = await import("./integrations/linearConnector.js");
  const { transformLinearWebhook, verifyLinearSignature } = await import(
    "./integrations/webhookTransforms.js"
  );

  const tenantUserId = String((req.params as Record<string, string | undefined>).tenant || "").trim();
  if (!tenantUserId) {
    res.status(400).json({ ok: false, error: "missing_tenant" });
    return;
  }
  if (!assertKnownTenantUserId(tenantUserId, res)) return;
  const ownership = getLinearConnectionForUser(tenantUserId);
  if (!ownership) {
    res.status(401).json({ ok: false, error: "unknown_connection" });
    return;
  }

  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const sig = String(req.headers["linear-signature"] || "");
  if (!verifyLinearSignature(rawBody, sig, ownership.secret)) {
    res.status(401).json({ ok: false, error: "bad_signature" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ ok: false, error: "invalid_json" });
    return;
  }

  try {
    const recs = transformLinearWebhook(payload, {
      userId: tenantUserId,
      connectionId: ownership.connectionId,
    });
    const out = ingestExternalBatch(recs);
    res.json({ ok: true, accepted: out.results.length, errors: out.errors.length });
  } catch (e: any) {
    console.error("[ingest/linear] failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "internal" });
  }
}
app.post("/api/ingest/linear/:tenant", linearRawBody, handleLinearIngest);

/**
 * Google Calendar push-notification ingress. Body is empty; identity comes
 * from headers (x-goog-channel-id + x-goog-channel-token). Mounted before
 * express.json() because the body type is "*\/*" and we want raw bytes only
 * for size capping.
 */
mountGoogleWebhook(app);

/** Jira webhook. Bearer secret authenticates the caller (Jira can't HMAC out of the box). */
function handleJiraIngest(req: express.Request, res: express.Response) {
  const secret = process.env.JIRA_WEBHOOK_BEARER?.trim();
  if (!secret) {
    res.status(503).json({ ok: false, error: "missing_jira_secret" });
    return;
  }
  if (!verifyJiraBearer(req.headers.authorization as string | undefined, secret)) {
    res.status(401).send("");
    return;
  }
  const tenantUserId = (
    (req.params as Record<string, string | undefined>).tenant ||
    process.env.JIRA_DEFAULT_TENANT ||
    ""
  ).trim();
  if (!tenantUserId) {
    res.status(400).json({ ok: false, error: "missing_tenant" });
    return;
  }
  if (!assertKnownTenantUserId(tenantUserId, res)) return;
  try {
    const recs = transformJiraWebhook(req.body as Record<string, unknown>, {
      userId: tenantUserId,
      bearerSecret: secret,
      deliveryId: (req.headers["atl-request-id"] as string) || undefined,
    });
    const out = ingestExternalBatch(recs);
    res.json({ ok: true, accepted: out.results.length, errors: out.errors.length });
  } catch (e: any) {
    console.error("[ingest/jira] failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "internal" });
  }
}

const jiraJsonBody = express.json({ limit: "5mb" });
app.post("/api/ingest/jira", jiraJsonBody, handleJiraIngest);
app.post("/api/ingest/jira/:tenant", jiraJsonBody, handleJiraIngest);

/** Generic CRM webhook (HubSpot/Salesforce/Pipedrive). `:vendor` becomes the source_subtype prefix. */
function handleCrmIngest(req: express.Request, res: express.Response) {
  const secret = process.env.CRM_WEBHOOK_BEARER?.trim();
  if (!secret) {
    res.status(503).json({ ok: false, error: "missing_crm_secret" });
    return;
  }
  if (!verifyCrmBearer(req.headers.authorization as string | undefined, secret)) {
    res.status(401).send("");
    return;
  }
  const params = req.params as Record<string, string | undefined>;
  const vendor = String(params.vendor || "crm").toLowerCase();
  const tenantUserId = (params.tenant || process.env.CRM_DEFAULT_TENANT || "").trim();
  if (!tenantUserId) {
    res.status(400).json({ ok: false, error: "missing_tenant" });
    return;
  }
  if (!assertKnownTenantUserId(tenantUserId, res)) return;
  try {
    const recs = transformCrmWebhook(req.body as Record<string, unknown>, {
      userId: tenantUserId,
      bearerSecret: secret,
      vendor,
    });
    const out = ingestExternalBatch(recs);
    res.json({ ok: true, accepted: out.results.length, errors: out.errors.length });
  } catch (e: any) {
    console.error("[ingest/crm] failed:", e);
    res.status(500).json({ ok: false, error: e?.message ?? "internal" });
  }
}

const crmJsonBody = express.json({ limit: config.server.requestBodyLimit });
app.post("/api/ingest/crm/:vendor", crmJsonBody, handleCrmIngest);
app.post("/api/ingest/crm/:vendor/:tenant", crmJsonBody, handleCrmIngest);

app.use(express.json({ limit: config.server.requestBodyLimit }));
app.use(jsonErrorHandler);
app.use(express.static(path.join(config.paths.apiRoot, "public"), { index: false }));

// --- Global Request Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logJson("http.request", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      requestId: getRequestId(req),
      userId: (req as any).userId,
      authKind: (req as any).authKind,
    });
  });
  next();
});
app.use(csrfOriginGuard);

app.post("/api/early-access", earlyAccessRouteLimiter, handleEarlyAccessRequest);
app.post("/api/contact", marketingContactRouteLimiter, handleMarketingContactRequest);

// --- Auth Endpoints ---
app.get("/api/auth/providers", (_req, res) => {
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_REDIRECT_URI?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  const githubConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_REDIRECT_URI?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
  res.json({
    google: googleConfigured,
    github: githubConfigured,
    googleHint: "Set Google OAuth variables on the API server (see .env.example).",
    githubHint: "Set GitHub OAuth variables on the API server (see .env.example).",
  });
});

/** Signup OTP: request a code (email when SMTP is set; otherwise dev console in non-production). */
app.post("/api/auth/otp/request", authRouteLimiter, async (req, res) => {
  try {
    const { username, purpose } = req.body as { username?: string; purpose?: string };
    const u = String(username || "").trim();
    if (!u) return res.status(400).json({ error: "Email required" });
    if (purpose !== "signup") {
      return res.status(400).json({ error: "Only purpose \"signup\" is supported on this endpoint" });
    }
    const uEmail = normalizeEmail(u);
    if (!isValidEmailFormat(uEmail)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const taken =
      db.getUser(u) ||
      (isValidEmailFormat(uEmail) ? db.findUserIdByEmail(uEmail) : null);
    if (taken) {
      recordSecurityEvent(req, "auth.signup_otp_existing_user", "warning", { username: u });
      return res.status(400).json({ error: "An account with this email already exists" });
    }

    db.deleteExpiredEmailOtpChallenges();
    db.deleteOpenSignupOtpForEmail(uEmail);
    const challengeToken = randomHex(24);
    const code = randomOtpDigits();
    const codeHash = hashEmailOtpCode(challengeToken, code);
    const expires = new Date(Date.now() + config.email.otpTtlMinutes * 60 * 1000).toISOString();
    db.insertEmailOtpChallenge({
      challengeToken,
      username: uEmail,
      purpose: "signup",
      userId: null,
      codeHash,
      expiresAtIso: expires,
    });
    const deliveryMode = await deliverSignupOtp(uEmail, code);
    res.json({
      success: true,
      challengeToken,
      expiresInSeconds: config.email.otpTtlMinutes * 60,
      deliveryMode,
    });
  } catch (e: any) {
    if (e?.code === "EMAIL_UNCONFIGURED") {
      return res.status(503).json({ error: "Email verification is not configured on this server" });
    }
    console.error("[auth/otp/request]", e);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

app.post("/api/auth/register", authRouteLimiter, (req, res) => {
  try {
    const { email, password, displayName, otp, challengeToken } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      otp?: string;
      challengeToken?: string;
    };
    const rawEmail = String(email || "").trim();
    const emailNorm = normalizeEmail(rawEmail);
    const p = String(password || "");
    if (!emailNorm || !p) return res.status(400).json({ error: "Email and password required" });
    if (!isValidEmailFormat(emailNorm)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (p.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (db.findUserIdByEmail(emailNorm)) {
      recordSecurityEvent(req, "auth.register_existing_user", "warning", { username: emailNorm });
      return res.status(400).json({
        error: "Could not create account. If you already have one, sign in instead.",
      });
    }

    const ct = String(challengeToken || "").trim();
    const otpStr = String(otp || "").trim();
    if (!ct || !/^\d{6}$/.test(otpStr)) {
      return res.status(400).json({
        error: "Email verification required",
        otpRequired: true,
      });
    }
    const row = db.getEmailOtpChallenge(ct);
    if (!row || row.purpose !== "signup" || normalizeEmail(row.username) !== emailNorm || row.consumed_at) {
      return res.status(400).json({ error: "Invalid or expired verification" });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Verification code expired" });
    }
    if (row.attempts >= config.email.otpMaxAttempts) {
      return res.status(429).json({ error: "Too many incorrect attempts" });
    }
    if (!verifyEmailOtpCode(row.code_hash, ct, otpStr)) {
      db.incrementEmailOtpAttempts(ct);
      return res.status(401).json({ error: "Invalid verification code" });
    }
    db.consumeEmailOtpChallenge(ct);

    const id = uuidv4();
    const hash = hashPassword(p);
    const disp = String(displayName || "").trim();
    const uniqueUsername = db.allocateUsername({ email: emailNorm, orgName: null });
    db.createUser(id, uniqueUsername, hash, emailNorm);
    db.updateSetting(id, "profile.email", emailNorm);
    if (disp) db.updateSetting(id, "profile.display_name", disp.slice(0, 400));
    db.updateSetting(id, "security.password_credential_set", "1");
    stampOrgOwnerIfUnset(id);
    const sess = issueSession(res, id, req);
    recordSecurityEvent(req, "auth.register_success", "info", { userId: id });
    res.json({ success: true, userId: id, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", authRouteLimiter, async (req, res) => {
  try {
    const { username, password, otp, challengeToken } = req.body as {
      username?: string;
      password?: string;
      otp?: string;
      challengeToken?: string;
    };
    const u = String(username || "").trim();
    const p = String(password || "");
    const uEmail = normalizeEmail(u);
    let user = db.getUser(u) as { id: string; password_hash: string } | undefined;
    if (!user && uEmail.includes("@") && isValidEmailFormat(uEmail)) {
      user = db.getUserByEmail(uEmail) as { id: string; password_hash: string } | undefined;
    }
    if (!user) {
      recordSecurityEvent(req, "auth.login_failed", "warning", { username: u, reason: "unknown_user" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    let ok = verifyBcrypt(p, user.password_hash);
    if (!ok) ok = verifyLegacySha256(p, user.password_hash);
    if (!ok) {
      recordSecurityEvent(req, "auth.login_failed", "warning", { userId: user.id, username: u, reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!user.password_hash.startsWith("$2")) {
      db.updateUserPasswordHash(user.id, hashPassword(p));
    }
    db.updateSetting(user.id, "security.password_credential_set", "1");

    const sf = loginRequiresSecondFactor(user.id);
    if (sf.totp) {
      return completePrimaryLogin(res, req, user.id);
    }

    if (sf.emailOtp && smtpConfigured()) {
      const ctIn = String(challengeToken || "").trim();
      const otpStr = String(otp || "").trim();
      if (ctIn && otpStr) {
        if (!/^\d{6}$/.test(otpStr)) {
          return res.status(400).json({ error: "Enter the 6-digit code from your email" });
        }
        const row = db.getEmailOtpChallenge(ctIn);
        const rowName = String(row?.username || "");
        const challengedMatches =
          rowName === u || normalizeEmail(rowName) === uEmail || rowName === (user as { username?: string }).username;
        if (
          !row ||
          row.purpose !== "login" ||
          row.user_id !== user.id ||
          !challengedMatches ||
          row.consumed_at
        ) {
          return res.status(400).json({ error: "Invalid verification" });
        }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          return res.status(400).json({ error: "Code expired" });
        }
        if (row.attempts >= config.email.otpMaxAttempts) {
          return res.status(429).json({ error: "Too many incorrect attempts" });
        }
        if (!verifyEmailOtpCode(row.code_hash, ctIn, otpStr)) {
          db.incrementEmailOtpAttempts(ctIn);
          recordSecurityEvent(req, "auth.email_otp_failed", "warning", { userId: user.id, username: u });
          return res.status(401).json({ error: "Invalid verification code" });
        }
        db.consumeEmailOtpChallenge(ctIn);
        return completePrimaryLogin(res, req, user.id);
      }

      db.deleteExpiredEmailOtpChallenges();
      db.deleteOpenLoginOtpForUser(user.id);
      const fullUser = user as { id: string; password_hash: string; username: string; email?: string | null };
      const mailTo =
        isValidEmailFormat(uEmail)
          ? uEmail
          : fullUser.email && isValidEmailFormat(fullUser.email)
            ? normalizeEmail(String(fullUser.email))
            : fullUser.username.includes("@")
              ? normalizeEmail(fullUser.username)
              : "";
      if (!mailTo) {
        return res.status(400).json({
          error:
            "This account has no email address on file. Add an email in onboarding or profile, then try again.",
        });
      }
      const challengeTokenNew = randomHex(24);
      const code = randomOtpDigits();
      const codeHash = hashEmailOtpCode(challengeTokenNew, code);
      const expires = new Date(Date.now() + config.email.otpTtlMinutes * 60 * 1000).toISOString();
      db.insertEmailOtpChallenge({
        challengeToken: challengeTokenNew,
        username: u,
        purpose: "login",
        userId: user.id,
        codeHash,
        expiresAtIso: expires,
      });
      try {
        await sendOtpEmail(mailTo, code, "login");
      } catch (mailErr: unknown) {
        console.error("[auth/login] sendOtpEmail", mailErr);
        return res.status(502).json({ error: "Could not send sign-in code. Try again later." });
      }
      return res.json({
        success: false,
        otpRequired: true,
        challengeToken: challengeTokenNew,
        expiresInSeconds: config.email.otpTtlMinutes * 60,
      });
    }

    return completePrimaryLogin(res, req, user.id);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login/totp", authRouteLimiter, (req, res) => {
  try {
    const body = req.body as { totpToken?: string; totpCode?: string; backupCode?: string };
    const totpToken = String(body.totpToken || "").trim();
    const totpCode = String(body.totpCode || "").trim();
    const backupCode = String(body.backupCode || "").trim();
    if (!totpToken) return res.status(400).json({ error: "totpToken required" });
    if (!totpMasterKeyConfigured()) {
      return res.status(503).json({
        error: "Server is missing TOTP_ENCRYPTION_KEY — cannot verify two-factor sign-in.",
        code: "totp_server_misconfigured",
      });
    }
    const th = hashOpaqueToken(totpToken);
    const row = db.getLoginTotpChallenge(th);
    if (!row || row.consumed_at) {
      return res.status(400).json({
        error: "Invalid or already used sign-in token. Enter your username and password again.",
      });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Authenticator step expired. Sign in again." });
    }
    if (row.attempts >= config.server.totpLoginMaxAttempts) {
      return res.status(429).json({ error: "Too many failed attempts. Sign in again." });
    }
    const urow = db.getUserTotpRow(row.user_id);
    if (!urow?.totp_secret_encrypted) {
      return res.status(400).json({ error: "Two-factor authentication is not active for this account." });
    }
    let secret: string;
    try {
      secret = decryptTotpPayload(urow.totp_secret_encrypted, getTotpMasterKeyBytes());
    } catch {
      return res.status(500).json({
        error: "Cannot decrypt stored 2FA secret. If you recently changed TOTP_ENCRYPTION_KEY, restore the previous key or reset 2FA in the database.",
      });
    }
    if (backupCode) {
      const norm = normalizeBackupCode(backupCode);
      const hashes = parseTotpBackupHashesJson(urow.totp_backup_hashes);
      const want = hashOpaqueToken(norm);
      const idx = hashes.indexOf(want);
      if (idx === -1) {
        db.incrementLoginTotpAttempts(th);
        recordSecurityEvent(req, "auth.totp_failed", "warning", { userId: row.user_id, method: "backup_code" });
        return res.status(401).json({ error: "Invalid backup code" });
      }
      hashes.splice(idx, 1);
      db.updateUserTotpBackupHashes(row.user_id, JSON.stringify(hashes));
    } else if (totpCode) {
      if (!verifyTotpToken(secret, totpCode)) {
        db.incrementLoginTotpAttempts(th);
        recordSecurityEvent(req, "auth.totp_failed", "warning", { userId: row.user_id, method: "totp" });
        return res.status(401).json({ error: "Invalid authenticator code" });
      }
    } else {
      return res.status(400).json({ error: "Provide totpCode or backupCode" });
    }
    db.consumeLoginTotpChallenge(th);
    const sess = issueSession(res, row.user_id, req);
    recordSecurityEvent(req, "auth.login_success", "info", { userId: row.user_id, sessionId: sess.sessionId });
    return res.json({ success: true, userId: row.user_id, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/totp/status", authMiddleware, (req, res) => {
  const userId = String((req as any).userId || "");
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const row = db.getUserTotpRow(userId);
  if (!row) return res.status(404).json({ error: "User not found" });
  res.json({
    totpServerReady: totpMasterKeyConfigured(),
    totpEnabled: userTotpActive(userId),
    totpPendingSetup: Boolean(row.totp_pending_encrypted),
  });
});

app.post(
  "/api/auth/totp/setup/start",
  authMiddleware,
  requirePermission("security:manage"),
  authRouteLimiter,
  (req, res) => {
  try {
    if (!totpMasterKeyConfigured()) {
      return res.status(503).json({
        error:
          "Set TOTP_ENCRYPTION_KEY in the API .env (same host as this server) before enabling authenticator-based 2FA.",
        code: "totp_config_missing",
      });
    }
    const userId = String((req as any).userId || "");
    const row = db.getUserTotpRow(userId);
    if (!row) return res.status(404).json({ error: "User not found" });
    if (userTotpActive(userId)) return res.status(400).json({ error: "Two-factor authentication is already enabled" });
    const secret = generateTotpSecret();
    const enc = encryptTotpPayload(secret, getTotpMasterKeyBytes());
    db.setUserTotpPendingEncrypted(userId, enc);
    const otpauthUrl = buildTotpKeyUri({
      issuer: config.server.totpIssuer,
      accountName: row.username,
      secret,
    });
    res.json({ secret, otpauthUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post(
  "/api/auth/totp/setup/confirm",
  authMiddleware,
  requirePermission("security:manage"),
  authRouteLimiter,
  (req, res) => {
  try {
    if (!totpMasterKeyConfigured()) {
      return res.status(503).json({
        error: "Set TOTP_ENCRYPTION_KEY in the API .env before enabling 2FA.",
        code: "totp_config_missing",
      });
    }
    const userId = String((req as any).userId || "");
    const code = String((req.body as { code?: string }).code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 6-digit code from your authenticator app" });
    }
    const row = db.getUserTotpRow(userId);
    if (!row?.totp_pending_encrypted) {
      return res.status(400).json({ error: "No setup in progress. Open “Begin setup” first." });
    }
    let secret: string;
    try {
      secret = decryptTotpPayload(row.totp_pending_encrypted, getTotpMasterKeyBytes());
    } catch {
      return res.status(500).json({ error: "Cannot read pending 2FA secret" });
    }
    if (!verifyTotpToken(secret, code)) {
      return res.status(401).json({ error: "Invalid authenticator code" });
    }
    const plains = generateBackupCodesPlain(config.server.totpBackupCodeCount);
    const hashes = plains.map((p) => hashOpaqueToken(normalizeBackupCode(p)));
    const ok = db.activateUserTotpFromPending(userId, JSON.stringify(hashes));
    if (!ok) {
      return res.status(500).json({ error: "Could not activate 2FA (missing pending secret)" });
    }
    db.updateSetting(userId, "security.totp_enabled", "true");
    res.json({ success: true, backupCodes: plains });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/totp/setup/cancel", authMiddleware, requirePermission("security:manage"), (req, res) => {
  const userId = String((req as any).userId || "");
  if (userTotpActive(userId)) {
    return res.status(400).json({ error: "Disable 2FA first to cancel a new setup" });
  }
  db.setUserTotpPendingEncrypted(userId, null);
  res.json({ success: true });
});

app.post(
  "/api/auth/totp/disable",
  authMiddleware,
  requirePermission("security:manage"),
  authRouteLimiter,
  (req, res) => {
  try {
    const userId = String((req as any).userId || "");
    const { password, totpCode, backupCode } = req.body as {
      password?: string;
      totpCode?: string;
      backupCode?: string;
    };
    const pwd = String(password || "");
    if (!pwd) return res.status(400).json({ error: "Password required" });
    const stored = db.getUserPasswordHash(userId);
    if (!stored) return res.status(400).json({ error: "No password on file" });
    let pwdOk = verifyBcrypt(pwd, stored);
    if (!pwdOk) pwdOk = verifyLegacySha256(pwd, stored);
    if (!pwdOk) return res.status(401).json({ error: "Invalid password" });

    if (!userTotpActive(userId)) {
      db.setUserTotpPendingEncrypted(userId, null);
      db.updateSetting(userId, "security.totp_enabled", "false");
      return res.json({ success: true, totpEnabled: false });
    }
    if (!totpMasterKeyConfigured()) {
      return res.status(503).json({
        error: "Server is missing TOTP_ENCRYPTION_KEY — cannot verify 2FA to disable.",
        code: "totp_config_missing",
      });
    }
    const row = db.getUserTotpRow(userId)!;
    let secret: string;
    try {
      secret = decryptTotpPayload(row.totp_secret_encrypted!, getTotpMasterKeyBytes());
    } catch {
      return res.status(500).json({ error: "Cannot decrypt 2FA secret" });
    }
    const bc = String(backupCode || "").trim();
    const tc = String(totpCode || "").trim();
    if (bc) {
      const norm = normalizeBackupCode(bc);
      const hashes = parseTotpBackupHashesJson(row.totp_backup_hashes);
      if (!hashes.includes(hashOpaqueToken(norm))) {
        return res.status(401).json({ error: "Invalid backup code" });
      }
    } else if (tc) {
      if (!verifyTotpToken(secret, tc)) {
        return res.status(401).json({ error: "Invalid authenticator code" });
      }
    } else {
      return res.status(400).json({ error: "Provide totpCode or backupCode to confirm turning off 2FA" });
    }
    db.disableUserTotp(userId);
    db.updateSetting(userId, "security.totp_enabled", "false");
    res.json({ success: true, totpEnabled: false });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sessionCookie = req.cookies?.hustronix_session as string | undefined;
  if (sessionCookie) {
    const sess = db.getSessionByTokenHash(hashOpaqueToken(sessionCookie));
    if (sess && !sess.revoked_at) db.revokeSession(sess.id, sess.user_id);
    if (sess) recordSecurityEvent(req, "auth.logout", "info", { userId: sess.user_id, sessionId: sess.id });
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(LEGACY_UID_COOKIE, { path: "/" });
  res.json({ success: true });
});

/** Link OAuth subject to existing user by email, or create a password-backed user. */
function findOrCreateUserFromOAuth(
  provider: "google" | "github",
  providerUserId: string,
  email: string | null,
): string {
  let userId = db.findOAuthUserId(provider, providerUserId);
  if (userId) return userId;

  const norm = email ? normalizeEmail(email) : "";
  if (norm && isValidEmailFormat(norm)) {
    userId = db.findUserIdByEmail(norm) ?? db.findUserIdByUsername(norm);
    if (userId) {
      db.insertOAuthIdentity(provider, providerUserId, userId, email);
      db.updateUserEmail(userId, norm);
      return userId;
    }
  } else if (email) {
    userId = db.findUserIdByUsername(email.trim());
    if (userId) {
      db.insertOAuthIdentity(provider, providerUserId, userId, email);
      return userId;
    }
  }

  const handleEmail =
    norm && isValidEmailFormat(norm) ? norm : `${provider}-${providerUserId}@oauth.invalid`;
  const username = db.allocateUsername({ email: handleEmail, orgName: null });
  userId = uuidv4();
  const emailForRow = norm && isValidEmailFormat(norm) ? norm : null;
  db.createUser(userId, username, "", emailForRow);
  db.updateSetting(userId, "security.password_credential_set", "0");
  db.insertOAuthIdentity(provider, providerUserId, userId, email);
  if (emailForRow) {
    db.updateSetting(userId, "profile.email", emailForRow);
  }
  stampOrgOwnerIfUnset(userId);
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
  const sess = issueSession(res, userId, req);
  recordSecurityEvent(req, "auth.oauth_login_success", "info", { userId, sessionId: sess.sessionId });
  return res.redirect(302, `${origin}/onboarding?signed_in=1`);
}

/** Social login callbacks must match the browser origin (Next.js :3000), not the API port. */
function socialLoginRedirectUri(provider: "google" | "github"): string {
  const envKey = provider === "google" ? "GOOGLE_REDIRECT_URI" : "GITHUB_REDIRECT_URI";
  return (
    process.env[envKey]?.trim() ||
    `${config.server.appOrigin}/api/auth/${provider}/callback`
  );
}

app.get("/api/auth/google/start", authRouteLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = socialLoginRedirectUri("google");
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
  const redirectUri = socialLoginRedirectUri("google");
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
  const redirectUri = socialLoginRedirectUri("github");
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
  const redirectUri = socialLoginRedirectUri("github");
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

app.post(
  "/api/auth/password",
  authMiddleware,
  requirePermission("security:manage"),
  passwordRouteLimiter,
  (req, res) => {
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
    if (!neu) return res.status(400).json({ error: "newPassword required" });
    if (neu.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const storedRaw = db.getUserPasswordHash(userId);
    const stored = storedRaw ?? "";
    const credFlag = db.getSetting(userId, "security.password_credential_set");
    const acct = db.getUserById(userId) as { username: string; email: string | null } | undefined;
    const hasAccountEmail =
      (acct?.email && isValidEmailFormat(String(acct.email))) ||
      Boolean(acct?.username && acct.username.includes("@"));
    const allowInitialSetWithoutCurrent =
      credFlag === "0" || (!hasAccountEmail && credFlag !== "1");
    if (allowInitialSetWithoutCurrent) {
      db.updateUserPasswordHash(userId, hashPassword(neu));
      db.updateSetting(userId, "security.password_credential_set", "1");
      db.revokeAllUserSessions(userId);
      const sess = issueSession(res, userId, req);
      recordSecurityEvent(req, "auth.password_set_initial", "critical", { userId, sessionId: sess.sessionId });
      return res.json({ success: true, sessionId: sess.sessionId });
    }
    if (!cur) return res.status(400).json({ error: "currentPassword and newPassword required" });
    if (!stored) return res.status(400).json({ error: "No password on file" });
    let ok = verifyBcrypt(cur, stored);
    if (!ok) ok = verifyLegacySha256(cur, stored);
    if (!ok) {
      recordSecurityEvent(req, "auth.password_change_failed", "warning", { userId });
      return res.status(401).json({ error: "Current password incorrect" });
    }
    db.updateUserPasswordHash(userId, hashPassword(neu));
    db.revokeAllUserSessions(userId);
    const sess = issueSession(res, userId, req);
    recordSecurityEvent(req, "auth.password_changed", "critical", { userId, sessionId: sess.sessionId });
    res.json({ success: true, sessionId: sess.sessionId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/api-keys", authMiddleware, requirePermission("security:manage"), (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId || userId === "system") return res.status(400).json({ error: "API keys require a user account." });
    const name = String((req.body as { name?: string }).name || "API Key").trim().slice(0, 120);
    const plain = newApiAccessTokenPlain();
    const prefix = plain.slice(0, 16);
    db.createApiAccessToken(userId, name, prefix, hashOpaqueToken(plain));
    recordSecurityEvent(req, "auth.api_key_created", "critical", { userId, name, prefix });
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

app.delete("/api/auth/api-keys/:id", authMiddleware, requirePermission("security:manage"), (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const ok = db.revokeApiAccessToken(String(req.params.id), userId);
  if (!ok) return res.status(404).json({ error: "Key not found." });
  recordSecurityEvent(req, "auth.api_key_revoked", "critical", { userId, tokenId: String(req.params.id) });
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

app.delete("/api/auth/sessions/:id", authMiddleware, requirePermission("security:manage"), (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const ok = db.revokeSession(String(req.params.id), userId);
  if (!ok) return res.status(404).json({ error: "Session not found." });
  recordSecurityEvent(req, "auth.session_revoked", "critical", { userId, sessionId: String(req.params.id) });
  res.json({ success: true });
});

app.post("/api/auth/sessions/revoke-all", authMiddleware, requirePermission("security:manage"), (req, res) => {
  const userId = (req as any).userId as string;
  const keepCurrent = Boolean((req.body as { keepCurrent?: boolean })?.keepCurrent);
  if (!userId || userId === "system") return res.status(400).json({ error: "Invalid user." });
  const current = keepCurrent ? ((req as any).sessionId as string | undefined) : undefined;
  db.revokeAllUserSessions(userId, current);
  recordSecurityEvent(req, "auth.sessions_revoked_all", "critical", { userId, keepCurrent });
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

app.get("/api/audit-log", authMiddleware, requirePermission("audit:run"), (req, res) => {
  const userId = (req as any).userId as string;
  try {
    if (!userId || userId === "system") {
      return res.status(403).json({ error: "Audit export requires a signed-in user account." });
    }
    const data = db.rawGet(
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
    const normalizeExecutions = (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({
        ...row,
        last_update: sqliteDatetimeToIso(row.last_update) ?? row.last_update,
        started_at: sqliteDatetimeToIso(row.started_at) ?? row.started_at,
        completed_at: sqliteDatetimeToIso(row.completed_at) ?? row.completed_at,
      }));
    if (scope === "all") {
      const data = db.rawGet(
        `SELECT e.*, d.vow as decision_vow ${baseJoin} ORDER BY e.last_update DESC`,
        [userId],
      ) as Record<string, unknown>[];
      return res.json({ executions: normalizeExecutions(data) });
    }
    const data = db.rawGet(
      `SELECT e.*, d.vow as decision_vow ${baseJoin}
       AND e.status IN ('PENDING', 'ACTIVE', 'BLOCKED')
       ORDER BY e.last_update DESC`,
      [userId],
    ) as Record<string, unknown>[];
    res.json({ executions: normalizeExecutions(data) });
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
    const { sql: ledgerSql, params: ledgerParams } = ledgerTenantScope(userId);
    const decisionScope = tenantSqlScope(resolveTenantContext(userId));
    const ownerFromExec = db.rawGet(
      `SELECT e.owner FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE 1=1${ledgerSql} AND e.status IN ('ACTIVE','PENDING')
       ORDER BY e.last_update DESC LIMIT 1`,
      ledgerParams,
    )[0] as { owner: string } | undefined;
    const owner =
      (req.query.owner as string)?.trim() ||
      ownerFromExec?.owner ||
      "system";

    const activeDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE status = 'ACTIVE'${decisionScope.sql} ORDER BY created_at DESC LIMIT 1`,
      decisionScope.params,
    )[0] as Record<string, unknown> | undefined;

    const fallbackDecision = db.rawGet(
      `SELECT * FROM decision_ledger WHERE 1=1${decisionScope.sql} ORDER BY created_at DESC LIMIT 1`,
      decisionScope.params,
    )[0] as Record<string, unknown> | undefined;

    const decision = activeDecision || fallbackDecision;

    const statusCounts = db.rawGet(
      `SELECT e.status, COUNT(*) as n
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE 1=1${ledgerSql}
       GROUP BY e.status`,
      ledgerParams,
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
      `SELECT sum(e.weight) as total_weight FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE e.owner = ? AND e.status = 'ACTIVE'${ledgerSql}`,
      [owner, ...ledgerParams],
    ) as { total_weight: number | null }[];
    const currentLoad = Number(activeTasks[0]?.total_weight || 0);
    const loadPct =
      cap.capacity > 0 ? Math.round((currentLoad / cap.capacity) * 100) : 0;

    const mcRows = db.rawGet(
      `SELECT e.task_id, e.owner, e.weight, e.status, e.success_condition, e.last_update, d.vow as decision_vow
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE 1=1${ledgerSql} AND e.status IN ('ACTIVE','BLOCKED','PENDING')
       ORDER BY e.last_update DESC
       LIMIT 8`,
      ledgerParams,
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

    const decisionOwnerUserId =
      decision &&
      decision.user_id != null &&
      String(decision.user_id).trim() !== ""
        ? String(decision.user_id).trim()
        : userId;

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
      decisionOwner: {
        userId: decisionOwnerUserId,
        displayName: db.getAccountDisplayName(decisionOwnerUserId),
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
    const userId = (req as any).userId as string;
    const owner = (req.query.owner as string) || "system";
    const capacity = db.getOwnerCapacity(owner);
    const activeTasks = db.rawGet("SELECT sum(weight) as total_weight FROM execution_ledger WHERE owner = ? AND status = 'ACTIVE'", [owner]);
    const beliefs = listBeliefsForEntity(userId, "person", owner);
    const derived = computeDerivedCapacity(beliefs);
    const explanation = derived.loadCurve
      .filter((p) => p.nObs > 0)
      .map((p) => ({
        factor: `performance_at_load:${p.bucket}`,
        contribution: Math.round(p.successRate * p.confidence * 100) / 100,
        active_load: p.bucket === "3+" ? 3.5 : Number(p.bucket.split("-")[1] ?? 1),
      }));
    res.json({
      ...capacity,
      currentLoad: activeTasks[0]?.total_weight || 0,
      shadow: {
        derivedCapacity: derived.derivedCapacity,
        confidence: derived.confidence,
        uncertainty: derived.uncertainty,
        loadCurve: derived.loadCurve,
        explanation,
        legacyCapacity: capacity.capacity,
        modelVersion: MODEL_VERSION,
        featureVersion: FEATURE_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch capacity" });
  }
});

app.get("/api/intelligence/entities/:type/:id/beliefs", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const entityType = req.params.type;
  const entityId = req.params.id;
  try {
    const beliefs = listBeliefsForEntity(userId, entityType, entityId);
    res.json({ entityType, entityId, beliefs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/intelligence/entities/:type/:id/predictions", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const entityType = req.params.type;
  const entityId = req.params.id;
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20"), 10) || 20);
  try {
    const predictions = listPredictions(userId, entityType, entityId, limit);
    res.json({ entityType, entityId, predictions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/intelligence/entities/:type/:id/calibration", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const entityType = req.params.type;
  const entityId = req.params.id;
  try {
    const calibration = computeCalibration(userId, entityType, entityId);
    res.json({ entityType, entityId, calibration });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/intelligence/replay", authMiddleware, requirePermission("audit:run"), (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const result = replayBeliefsForTenant(userId);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/owners/profiles", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const entries = buildTeamEntries(userId).filter((e) => e.source === "ledger");
    const profiles = entries.map((e) => {
      const owner = e.id.replace(/^ledger:/, "");
      const legacy = db.getOwnerCapacity(owner);
      return buildOwnerProfile(userId, owner, legacy.capacity);
    });
    res.json({ profiles });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/owners/:owner/profile", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const owner = req.params.owner;
  try {
    const legacy = db.getOwnerCapacity(owner);
    const profile = buildOwnerProfile(userId, owner, legacy.capacity);
    const recentEvidence = listEvidenceForEntity(userId, "person", owner, 15);
    const neighbors = listGraphNeighbors(userId, "person", owner, 15);
    res.json({ ...profile, recentEvidence, graphNeighbors: neighbors });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/owners/:owner/calibration", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const owner = req.params.owner;
  try {
    const calibration = computeCalibration(userId, "person", owner);
    const predictions = listPredictions(userId, "person", owner, 30);
    res.json({ owner, calibration, predictions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/execution/transition", authMiddleware, requirePermission("execution:write"), mutationRouteLimiter, async (req, res) => {
  const { taskId, newState, reason, approvalId, emergencyOverride, emergencyReason } = req.body as {
    taskId?: string;
    newState?: string;
    reason?: string;
    approvalId?: string;
    emergencyOverride?: boolean;
    emergencyReason?: string;
  };
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  try {
    if (!taskId || !newState) return res.status(400).json({ error: "taskId and newState required" });
    const tenant = db.getExecutionTenantForTask(taskId);
    if (!tenant) return res.status(404).json({ error: "Task not found" });
    const result = await authorizeAndExecuteMutation(
      {
        userId,
        authKind,
        permission: "execution:write",
        actionType: "transition_execution",
        toolName: "transition_execution",
        toolArgs: { task_id: taskId, newState, reason: reason ?? "" },
        resourceTenantId: tenant,
        approvalId,
        emergencyOverride,
        emergencyReason,
      },
      () => mutationTransitionExecution(userId, { taskId, newState, reason }),
    );
    appendAuthorityLedgerEvent({
      req,
      orgId: tenant,
      aggregateType: "execution",
      aggregateId: taskId,
      eventType: "execution.transition",
      payload: {
        taskId,
        newState,
        reason: reason || null,
        result,
      },
    });
    res.json(result);
  } catch (err: any) {
    const status = err?.message?.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post("/api/execution/link", authMiddleware, requirePermission("execution:write"), mutationRouteLimiter, async (req, res) => {
  const { signalId, taskId } = req.body as { signalId?: string; taskId?: string };
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  try {
    if (!signalId || !taskId) return res.status(400).json({ error: "signalId and taskId required" });
    await authorizeAndExecuteMutation(
      {
        userId,
        authKind,
        permission: "execution:write",
        actionType: "link_execution_signal",
        toolName: "link_execution_signal",
        toolArgs: { signalId, taskId },
      },
      () => {
        mutationLinkSignal(userId, { signalId, taskId, linkMethod: "manual" });
      },
    );
    res.json({ success: true });
  } catch (err: any) {
    const status = err?.message?.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: err.message || "Failed to link signal" });
  }
});

app.post("/api/execution/unlink", authMiddleware, requirePermission("execution:write"), mutationRouteLimiter, async (req, res) => {
  const { signalId } = req.body as { signalId?: string };
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  try {
    if (!signalId) return res.status(400).json({ error: "signalId required" });
    await authorizeAndExecuteMutation(
      {
        userId,
        authKind,
        permission: "execution:write",
        actionType: "unlink_execution_signal",
        toolName: "link_execution_signal",
        toolArgs: { signalId, action: "unlink" },
      },
      () => mutationUnlinkSignal(userId, { signalId }),
    );
    res.json({ success: true, signalId });
  } catch (err: any) {
    const status = err?.message?.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: err.message || "Failed to unlink signal" });
  }
});

/** Operator: full auditor sweep (cron remains the safety net). */
app.post("/api/audit/run", authMiddleware, requirePermission("audit:run"), mutationRouteLimiter, (_req, res) => {
  try {
    auditor.evaluateAll();
    res.json({ success: true, scope: "full" });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "audit run failed" });
  }
});

// --- Intelligence Endpoints (signal-detector + context-engine + hybrid retrieval) ---

/**
 * Returns the same DecisionContext object the agent supervisor sees: active
 * decision, live executions, recent enriched signals. Intended for UI panels
 * and ops debugging — no LLM, no mutation.
 */
app.get("/api/intelligence/context", authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  try {
    const ctx = fetchDecisionContext(userId);
    res.json({ context: ctx });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to fetch context" });
  }
});

/** V7 trust metrics — memory confidence, contradictions, security posture. */
app.get("/api/trust/metrics", authMiddleware, requirePermission("decision:read"), (req, res) => {
  const orgId = String((req as any).orgId || (req as any).userId);
  try {
    res.json(computeTrustMetrics(orgId));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to compute trust metrics" });
  }
});

/** V8 organizational truth — what the company currently believes and why. */
app.get("/api/truth/current", authMiddleware, requirePermission("decision:read"), (req, res) => {
  const orgId = String((req as any).orgId || (req as any).userId);
  const workspaceId = (req as any).workspaceId as string | undefined;
  try {
    const snapshot = computeOrganizationalTruth(orgId, workspaceId);
    res.json(snapshot);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to compute organizational truth" });
  }
});

app.get("/api/truth/snapshots", authMiddleware, requirePermission("decision:read"), (req, res) => {
  const orgId = String((req as any).orgId || (req as any).userId);
  try {
    res.json({ truths: getCurrentOrganizationalTruth(orgId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to list truth snapshots" });
  }
});

/** V8 security observability dashboard. */
app.get("/api/security/dashboard", authMiddleware, requirePermission("audit:run"), (req, res) => {
  const orgId = String((req as any).orgId || (req as any).userId);
  try {
    res.json(getSecurityDashboard(orgId));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to load security dashboard" });
  }
});

/** Explain a memory fact — who, when, source, evidence, contradictions. */
app.get("/api/entities", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (type && !isEntityType(type)) {
      return res.status(400).json({ error: "Invalid entity type." });
    }
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const entities = listEntities(ctx, { type: type as any, limit });
    res.json({ entities });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/entities/:id/neighbors", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const entity = getEntity(ctx.orgId, String(req.params.id));
    if (!entity) return res.status(404).json({ error: "Entity not found." });
    assertResourceTenantAccess(ctx, entity.tenant_id);
    const neighbors = getEntityNeighbors(ctx.orgId, entity.id);
    res.json({ entity_id: entity.id, neighbors });
  } catch (e: any) {
    res.status(e?.code === "TENANT_ISOLATION" ? 403 : 500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/entities/:id/timeline", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const entity = getEntity(ctx.orgId, String(req.params.id));
    if (!entity) return res.status(404).json({ error: "Entity not found." });
    assertResourceTenantAccess(ctx, entity.tenant_id);
    const timeline = getEntityTimeline(ctx.orgId, entity.id);
    res.json({ entity_id: entity.id, timeline });
  } catch (e: any) {
    res.status(e?.code === "TENANT_ISOLATION" ? 403 : 500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/graph/impact", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const entityId = String(req.query.entityId ?? "").trim() || undefined;
    const refId = String(req.query.refId ?? "").trim() || undefined;
    const nodeType = String(req.query.nodeType ?? "").trim() || undefined;
    const direction = (String(req.query.direction ?? "both") as "upstream" | "downstream" | "both");
    const depth = parseInt(String(req.query.depth ?? "3"), 10);
    if (!entityId && !refId) {
      return res.status(400).json({ error: "entityId or refId required." });
    }
    const impact = getGraphImpact({
      tenantId: ctx.orgId,
      entityId,
      refId,
      nodeType: nodeType as any,
      direction,
      depth: Number.isFinite(depth) ? depth : 3,
    });
    res.json(impact);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/state/current", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const state = getOrganizationState(ctx.orgId, ctx.userId);
    const version = getCurrentStateVersion(ctx.orgId);
    res.json({
      version: version?.version ?? state.meta.version,
      compiled_at: state.meta.compiled_at,
      state,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/state/versions", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
    const versions = listStateVersions(ctx.orgId, limit).map((v) => ({
      version: v.version,
      parent_version: v.parent_version,
      compiled_at: v.compiled_at,
      trigger_event: v.trigger_event,
      author: v.author,
    }));
    res.json({ versions });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/state/diff", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const v1 = parseInt(String(req.query.v1 ?? ""), 10);
    const v2 = parseInt(String(req.query.v2 ?? ""), 10);
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) {
      return res.status(400).json({ error: "Query params v1 and v2 are required integers." });
    }
    const diff = diffStateVersions(ctx.orgId, v1, v2);
    if (!diff) return res.status(404).json({ error: "One or both versions not found." });
    res.json(diff);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.post("/api/state/rebuild", authMiddleware, mutationRouteLimiter, (req, res) => {
  try {
    const role = principalRole(req);
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Forbidden", requiredRole: "owner or admin" });
    }
    const ctx = resolveTenantContext((req as any).userId);
    const state = rebuildOrganizationState(ctx.orgId, ctx.userId);
    recordSecurityEvent(req, "STATE_REBUILD", "warning", {
      tenantId: ctx.orgId,
      version: state.meta.version,
    });
    res.json({
      success: true,
      version: state.meta.version,
      compiled_at: state.meta.compiled_at,
      state,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.post("/api/state/rollback", authMiddleware, mutationRouteLimiter, (req, res) => {
  try {
    if (principalRole(req) !== "owner") {
      return res.status(403).json({ error: "Forbidden", requiredRole: "owner" });
    }
    const ctx = resolveTenantContext((req as any).userId);
    const toVersion = parseInt(String(req.query.toVersion ?? req.body?.toVersion ?? ""), 10);
    if (!Number.isFinite(toVersion)) {
      return res.status(400).json({ error: "toVersion is required." });
    }
    const rolled = rollbackStateVersion(ctx.orgId, toVersion, ctx.userId);
    if (!rolled) return res.status(404).json({ error: "Target version not found." });
    recordSecurityEvent(req, "STATE_ROLLBACK", "critical", {
      toVersion,
      tenantId: ctx.orgId,
      newVersion: rolled.version,
    });
    const snapshot = parseSnapshot(rolled);
    res.json({ success: true, version: rolled.version, state: snapshot });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/doctrine", authMiddleware, requirePermission("memory:read"), (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const status = req.query.status === "SUPERSEDED" ? "SUPERSEDED" : "ACTIVE";
    res.json({ rules: listDoctrineRules(ctx, status) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.post("/api/doctrine", authMiddleware, requirePermission("settings:write"), mutationRouteLimiter, (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const statement = String(req.body?.statement ?? "").trim();
    if (!statement) return res.status(400).json({ error: "statement is required." });
    const priority = req.body?.priority === "constitutional" ? "constitutional" : "guidance";
    const entityScope = String(req.body?.entity_scope ?? req.body?.entityScope ?? "org-wide");
    const rule = createDoctrineRule({
      tenantId: ctx.orgId,
      statement,
      priority,
      entityScope,
    });
    res.status(201).json({ rule });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.patch("/api/doctrine/:id", authMiddleware, requirePermission("settings:write"), mutationRouteLimiter, (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const ruleId = String(req.params.id);
    const existing = getDoctrineRule(ctx.orgId, ruleId);
    if (!existing) return res.status(404).json({ error: "Doctrine rule not found." });
    const updated = updateDoctrineRule(ctx.orgId, ruleId, {
      statement: req.body?.statement ? String(req.body.statement) : undefined,
      priority: req.body?.priority === "constitutional" || req.body?.priority === "guidance"
        ? req.body.priority
        : undefined,
      status: req.body?.status === "SUPERSEDED" || req.body?.status === "ACTIVE" ? req.body.status : undefined,
      entity_scope: req.body?.entity_scope ? String(req.body.entity_scope) : undefined,
    });
    res.json({ rule: updated });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.delete("/api/doctrine/:id", authMiddleware, requirePermission("settings:write"), mutationRouteLimiter, (req, res) => {
  try {
    const ctx = resolveTenantContext((req as any).userId);
    const ruleId = String(req.params.id);
    const existing = getDoctrineRule(ctx.orgId, ruleId);
    if (!existing) return res.status(404).json({ error: "Doctrine rule not found." });
    const rule = supersedeDoctrineRule(ctx.orgId, ruleId);
    res.json({ rule });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/memory/facts/:id/explain", authMiddleware, requirePermission("memory:read"), (req, res) => {
  const orgId = String((req as any).orgId || (req as any).userId);
  const factId = String(req.params.id);
  try {
    const explanation = explainMemoryFact(factId);
    if (!explanation) return res.status(404).json({ error: "Memory fact not found." });
    const ctx = resolveTenantContext((req as any).userId);
    const factTenant = String((explanation as { tenant_id?: string }).tenant_id ?? orgId);
    assertResourceTenantAccess(ctx, factTenant);
    res.json(explanation);
  } catch (e: any) {
    res.status(e?.code === "TENANT_ISOLATION" ? 403 : 500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/beliefs", authMiddleware, requirePermission("decision:read"), (req, res) => {
  const userId = (req as any).userId as string;
  const status = req.query.status as string | undefined;
  try {
    const ctx = resolveTenantContext(userId);
    const beliefs = listBeliefs(ctx.orgId, status as any);
    res.json({ beliefs });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed" });
  }
});

app.get("/api/beliefs/:id/explain", authMiddleware, requirePermission("decision:read"), (req, res) => {
  const userId = (req as any).userId as string;
  const beliefId = String(req.params.id);
  try {
    const explanation = explainBelief(beliefId);
    if (!explanation) return res.status(404).json({ error: "Belief not found." });
    const ctx = resolveTenantContext(userId);
    assertResourceTenantAccess(ctx, String(explanation.tenant_id));
    res.json(explanation);
  } catch (e: any) {
    res.status(e?.code === "TENANT_ISOLATION" ? 403 : 500).json({ error: e?.message || "failed" });
  }
});

app.post("/api/decisions/simulate", authMiddleware, requirePermission("decision:read"), aiRouteLimiter, (req, res) => {
  const userId = (req as any).userId as string;
  const body = req.body as {
    decisionId?: string;
    vow?: string;
    capacityDelta?: Record<string, number>;
    revenueDeltaPct?: number;
    churnRiskDelta?: number;
  };
  try {
    const ctx = resolveTenantContext(userId);
    const vow = String(body.vow || "").trim();
    if (!vow && !body.decisionId) {
      return res.status(400).json({ error: "vow or decisionId required" });
    }
    let vowText = vow;
    if (!vowText && body.decisionId) {
      const row = db.getDecisionLedgerRow(body.decisionId);
      if (!row) return res.status(404).json({ error: "Decision not found" });
      vowText = String(row.vow || "");
    }
    const result = runCausalSimulation({
      tenantId: ctx.orgId,
      decisionId: body.decisionId,
      vow: vowText,
      capacityDelta: body.capacityDelta,
      revenueDeltaPct: body.revenueDeltaPct,
      churnRiskDelta: body.churnRiskDelta,
      createdBy: userId,
    });
    res.json({
      ...result,
      digital_twin: computeDigitalTwin(ctx.orgId),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "simulation failed" });
  }
});

app.get("/api/security/approvals/pending", authMiddleware, requirePermission("security:manage"), (req, res) => {
  const viewerId = (req as any).userId as string;
  const orgId = String((req as any).orgId || viewerId);
  try {
    res.json({ approvals: listPendingApprovals(orgId, viewerId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to list approvals" });
  }
});

app.get("/api/security/approvals/:id", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const orgId = String((req as any).orgId || userId);
  try {
    const row = getApprovalById(String(req.params.id), orgId);
    if (!row) return res.status(404).json({ error: "Approval not found." });
    if (row.actor_id !== userId && !userHasPermission(userId, (req as any).authKind, "security:manage")) {
      return res.status(403).json({ error: "Forbidden." });
    }
    res.json({ approval: row });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "failed to load approval" });
  }
});

app.post(
  "/api/security/approvals/:id/approve",
  authMiddleware,
  requirePermission("security:manage"),
  mutationRouteLimiter,
  (req, res) => {
    const approverId = (req as any).userId as string;
    const orgId = String((req as any).orgId || (req as any).userId);
    const ok = approvePendingAction(String(req.params.id), approverId, orgId);
    if (!ok) return res.status(400).json({ error: "Approval not found, expired, or already processed." });
    res.json({ success: true, approvalId: req.params.id });
  },
);

/**
 * Hybrid (FTS5 + cosine) retrieval across signals/executions/decisions.
 * Tenant-scoped. Query is required. `types` and `limit` are optional.
 *   GET /api/intelligence/search?q=onboarding&types=signal,execution&limit=10
 */
app.get("/api/intelligence/search", authMiddleware, aiRouteLimiter, async (req, res) => {
  const userId = (req as any).userId;
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "missing required query param 'q'" });
    return;
  }
  const typesRaw = String(req.query.types ?? "").trim();
  const validTypes = new Set(["signal", "execution", "decision"]);
  const types = typesRaw
    ? typesRaw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => validTypes.has(t))
    : undefined;
  let limit = Number(req.query.limit ?? 20);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > 100) limit = 100;

  try {
    const hits = await hybridSearch(userId, q, {
      types: types as ("signal" | "execution" | "decision")[] | undefined,
      limit,
    });
    res.json({ query: q, count: hits.length, hits });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "search failed" });
  }
});

/**
 * Re-run the intelligence pipeline (detector + auto-linker) on a single
 * signal. Used to recover from a missed enrichment or to re-evaluate a signal
 * after the active decision changed.
 *   POST /api/intelligence/relink  { signalId: "...", noLlm?: boolean }
 */
app.post("/api/intelligence/relink", authMiddleware, requirePermission("agent:invoke"), aiRouteLimiter, async (req, res) => {
  const userId = (req as any).userId;
  const signalId = String(req.body?.signalId ?? "").trim();
  if (!signalId) {
    res.status(400).json({ error: "signalId is required" });
    return;
  }
  /** Tenant scoping: verify the signal belongs to this user (system sees all). */
  const tenant = db.getSignalTenant(signalId);
  if (!tenant) {
    res.status(404).json({ error: "signal not found" });
    return;
  }
  if (userId !== "system" && tenant !== userId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    const result = await processSignal(signalId, { noLlm: !!req.body?.noLlm });
    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "relink failed" });
  }
});

/**
 * Warm embeddings for the active ledger surface. Idempotent — `ensureEmbedding`
 * skips work when text_hash matches. Useful right after enabling an OpenAI key
 * on an existing tenant.
 *   POST /api/intelligence/warm-embeddings  { limit?: number }
 */
app.post("/api/intelligence/warm-embeddings", authMiddleware, requirePermission("agent:invoke"), aiRouteLimiter, async (req, res) => {
  const userId = (req as any).userId;
  const limitRaw = Number(req.body?.limit ?? 200);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 1000 ? Math.floor(limitRaw) : 200;
  try {
    const result = await warmEmbeddingsForActiveLedger(userId, limit);
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "warm-embeddings failed" });
  }
});

// =====================================================================
// Manual ingest (for testing, ad-hoc events, internal tools)
//   POST /api/ingest/manual { provider, subtype?, content, owner, externalId? }
// =====================================================================
app.post("/api/ingest/manual", authMiddleware, requirePermission("signal:write"), mutationRouteLimiter, (req, res) => {
  const userId = (req as any).userId as string;
  const { provider, subtype, content, owner, externalId, meta } = req.body as {
    provider?: string;
    subtype?: string;
    content?: string;
    owner?: string;
    externalId?: string;
    meta?: Record<string, unknown>;
  };
  if (!provider || !content || !owner) {
    res.status(400).json({ error: "provider, content, owner required" });
    return;
  }
  try {
    const r = ingestExternal({
      provider,
      subtype,
      userId,
      content,
      owner,
      externalId,
      meta,
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof IngestError) {
      res.status(400).json({ ok: false, code: e.code, error: e.message });
      return;
    }
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// =====================================================================
// Meeting ingestion
//   POST /api/ingest/meeting { transcript, title?, attendees?, occurredAt?, sourceSubtype? }
// =====================================================================
app.post("/api/ingest/meeting", authMiddleware, requirePermission("signal:write"), aiRouteLimiter, async (req, res) => {
  const userId = (req as any).userId as string;
  const { transcript, title, attendees, occurredAt, sourceSubtype } = req.body as {
    transcript?: string;
    title?: string;
    attendees?: string[];
    occurredAt?: string;
    sourceSubtype?: string;
  };
  if (!transcript || typeof transcript !== "string") {
    res.status(400).json({ error: "transcript (string) is required" });
    return;
  }
  try {
    const r = await ingestMeeting({ userId, transcript, title, attendees, occurredAt, sourceSubtype });
    res.json({ ok: true, ...r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? "meeting ingest failed" });
  }
});

// =====================================================================
// Operational queries (drift, overload, conflicts, related, search)
// =====================================================================

app.get("/api/operational/drift", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const riskAtLeast = String(req.query.riskAtLeast ?? "high") as "high" | "medium" | "any";
  const minAgeMinutes = Number(req.query.minAgeMinutes ?? 10);
  const limit = Number(req.query.limit ?? 100);
  try {
    const rows = findDriftSignals(userId, {
      riskAtLeast: ["high", "medium", "any"].includes(riskAtLeast) ? riskAtLeast : "high",
      minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 10,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    res.json({ count: rows.length, rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "drift query failed" });
  }
});

app.get("/api/operational/overloaded", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const minTotal = Number(req.query.minTotal ?? 5);
  const minHighRiskSignals = Number(req.query.minHighRiskSignals ?? 1);
  const limit = Number(req.query.limit ?? 50);
  try {
    const rows = findOverloadedOwners(userId, {
      minTotal: Number.isFinite(minTotal) ? minTotal : 5,
      minHighRiskSignals: Number.isFinite(minHighRiskSignals) ? minHighRiskSignals : 1,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    res.json({ count: rows.length, rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "overload query failed" });
  }
});

app.get("/api/operational/conflicts", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const limit = Number(req.query.limit ?? 100);
  try {
    const rows = findConflictingExecutions(userId, Number.isFinite(limit) ? limit : 100);
    res.json({ count: rows.length, rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "conflicts query failed" });
  }
});

app.get("/api/operational/related", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as string;
  const taskId = String(req.query.taskId ?? "").trim();
  const k = Number(req.query.k ?? 10);
  if (!taskId) {
    res.status(400).json({ error: "taskId required" });
    return;
  }
  try {
    const rows = await findSignalsRelatedToTask(userId, taskId, Number.isFinite(k) ? k : 10);
    res.json({ count: rows.length, rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "related query failed" });
  }
});

app.get("/api/operational/search", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as string;
  const q = String(req.query.q ?? "").trim();
  const limit = Number(req.query.limit ?? 30);
  if (!q) {
    res.status(400).json({ error: "q required" });
    return;
  }
  try {
    const hits = await operationalSearch(userId, q, Number.isFinite(limit) ? limit : 30);
    res.json({ query: q, count: hits.length, hits });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "operational search failed" });
  }
});

// =====================================================================
// Reports (API-triggered; never cron)
// =====================================================================

app.get("/api/reports/weekly", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const windowDays = Number(req.query.windowDays ?? 7);
  const fmt = String(req.query.format ?? "json");
  try {
    const r = weeklyDriftReport(userId, Number.isFinite(windowDays) ? windowDays : 7);
    if (fmt === "markdown") {
      res.type("text/markdown").send(formatWeeklyDriftMarkdown(r));
      return;
    }
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "report failed" });
  }
});

app.get("/api/reports/health", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const fmt = String(req.query.format ?? "json");
  try {
    const r = operationalHealth(userId);
    if (fmt === "markdown") {
      res.type("text/markdown").send(formatHealthMarkdown(r));
      return;
    }
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "health report failed" });
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

app.post("/api/settings", authMiddleware, requirePermission("settings:write"), (req, res) => {
  const userId = (req as any).userId;
  if (!userId || userId === "system") {
    return res.status(400).json({ error: "Settings updates require a user account." });
  }
  const { key, value } = req.body;
  try {
    assertWritableSettingKey(String(key || ""));
    db.updateSetting(userId, key, value);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof InvalidSettingKeyError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to update setting" });
  }
});

app.post("/api/settings/bulk", authMiddleware, requirePermission("settings:write"), (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") {
    return res.status(400).json({ error: "Settings updates require a user account." });
  }
  const body = req.body as { settings?: Record<string, string> };
  try {
    const safe = filterWritableSettings(body.settings || {});
    const entries = Object.entries(safe);
    const keys = new Set(entries.map(([k]) => k));
    const orgRoleBefore =
      userId === "system" ? true : Boolean((db.getSetting(userId, "org.role") || "").trim());
    const wroteNonemptyOrgName = entries.some(
      ([k, v]) => k === "org.name" && String(v ?? "").trim() !== "",
    );
    for (const [k, v] of entries) {
      db.updateSetting(userId, k, String(v));
    }
    if (
      userId !== "system" &&
      !orgRoleBefore &&
      wroteNonemptyOrgName &&
      (db.getSetting(userId, "org.name") || "").trim()
    ) {
      stampOrgOwnerIfUnset(userId);
    }
    if (keys.has("org.name")) {
      try {
        db.refreshUsernameWithOrg(userId);
      } catch (e) {
        console.warn("[settings/bulk] refreshUsernameWithOrg:", e);
      }
    }
    res.json({ success: true, updated: entries.length });
  } catch (err: any) {
    if (err instanceof InvalidSettingKeyError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to bulk update settings" });
  }
});

function billingProviderConfigured(): boolean {
  const v = (process.env.BILLING_PROVIDER_CONFIGURED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

app.get("/api/settings/capacity-summary", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const rawTotal = userId && userId !== "system" ? db.getSetting(userId, "capacity.system_total") : "";
    const trimmed = String(rawTotal ?? "").trim();
    const configured = trimmed !== "";
    const systemTotal = configured ? Math.max(1, parseInt(trimmed, 10) || 1) : null;
    const team = {
      Leadership: db.getSetting(userId, "capacity.team_leadership"),
      Growth: db.getSetting(userId, "capacity.team_growth"),
      Product: db.getSetting(userId, "capacity.team_product"),
      Operations: db.getSetting(userId, "capacity.team_operations"),
    };
    const teamConfigured = Object.values(team).some((v) => String(v ?? "").trim() !== "");
    const currentLoad =
      userId && userId !== "system" ? db.getActiveExecutionWeightSumForDecisionOwner(userId) : 0;
    const usagePct =
      systemTotal != null && systemTotal > 0
        ? Math.min(100, Math.round((currentLoad / systemTotal) * 100))
        : null;
    res.json({
      configured,
      teamConfigured,
      systemTotal,
      teamAllocation: {
        leadership: team.Leadership != null && String(team.Leadership).trim() !== "" ? Number(team.Leadership) : null,
        growth: team.Growth != null && String(team.Growth).trim() !== "" ? Number(team.Growth) : null,
        product: team.Product != null && String(team.Product).trim() !== "" ? Number(team.Product) : null,
        operations: team.Operations != null && String(team.Operations).trim() !== "" ? Number(team.Operations) : null,
      },
      currentLoad,
      usagePct,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "capacity_summary_failed" });
  }
});

app.get("/api/billing", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const providerOn = billingProviderConfigured();
    if (!userId || userId === "system") {
      return res.json({
        providerConfigured: providerOn,
        planLabel: null,
        planPriceDisplay: null,
        billingEmail: null,
        taxId: null,
        address: null,
        invoiceContact: null,
        invoices: [],
      });
    }
    const g = (k: string) => {
      const v = (db.getSetting(userId, k) || "").trim();
      return v.length ? v : null;
    };
    res.json({
      providerConfigured: providerOn,
      planLabel: g("billing.plan_label"),
      planPriceDisplay: g("billing.plan_price_display"),
      billingEmail: g("billing.email"),
      taxId: g("billing.tax_id"),
      address: g("billing.address"),
      invoiceContact: g("billing.invoice_contact"),
      invoices: [] as { id: string; issuedAt: string; description: string; amountDisplay: string; status: string }[],
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "billing_read_failed" });
  }
});

app.post("/api/billing", authMiddleware, requirePermission("settings:write"), (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId || userId === "system") {
    return res.status(400).json({ error: "Billing preferences require a user account." });
  }
  const body = req.body as {
    planLabel?: string | null;
    planPriceDisplay?: string | null;
    billingEmail?: string | null;
    taxId?: string | null;
    address?: string | null;
    invoiceContact?: string | null;
  };
  try {
    const str = (v: unknown) => (v == null ? "" : String(v));
    const settings: Record<string, string> = {
      "billing.plan_label": str(body.planLabel),
      "billing.plan_price_display": str(body.planPriceDisplay),
      "billing.email": str(body.billingEmail),
      "billing.tax_id": str(body.taxId),
      "billing.address": str(body.address),
      "billing.invoice_contact": str(body.invoiceContact),
    };
    for (const [k, v] of Object.entries(settings)) {
      db.updateSetting(userId, k, v);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "billing_write_failed" });
  }
});

// --- Notifications (in-app row + optional email/Slack; digest via scheduler) ---
app.get("/api/notifications/unread-count", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    res.json({ count: db.countUnreadNotifications(userId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "unread_count_failed" });
  }
});

app.get("/api/notifications", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const limit = parseInt(String(req.query.limit || "50"), 10) || 50;
  const unreadOnly = String(req.query.unreadOnly || "0") === "1";
  try {
    const rows = db.listNotificationsForUser(userId, limit, unreadOnly);
    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        linkUrl: r.link_url,
        payloadJson: r.payload_json,
        deliveredInApp: Boolean(r.delivered_in_app),
        deliveredEmail: Boolean(r.delivered_email),
        deliveredSlack: Boolean(r.delivered_slack),
        readAt: r.read_at,
        digestSentAt: r.digest_sent_at,
        createdAt: r.created_at,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "list_failed" });
  }
});

app.post("/api/notifications/test", authMiddleware, mutationRouteLimiter, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const r = await notify(userId, {
      kind: "test",
      title: "Test notification",
      body: "If you see this in email, Slack, or in-app, your delivery path is working.",
      linkUrl: defaultAppLink("/settings?tab=notifications"),
    });
    res.json({ ok: true, id: r.id, channels: r.channels });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "notify_failed" });
  }
});

app.post("/api/notifications/read-all", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const updated = db.markAllNotificationsRead(userId);
    res.json({ success: true, updated });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "read_all_failed" });
  }
});

app.post("/api/notifications/:id/read", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const n = db.markNotificationRead(userId, id);
    if (!n) return res.status(404).json({ error: "not_found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "read_failed" });
  }
});

/**
 * Per-user integration wiring exposed on `GET /api/me` (see web Active Integrations).
 *
 * Backed by the generic `oauth_connections` table — every provider that
 * completes the new OAuth flow shows up here automatically. Legacy Slack bot
 * installs still live under `provider='slack'` so they continue to surface
 * even after the schema refactor.
 *
 * The shape exposed to the UI is intentionally a flat object keyed by the slug
 * the UI already uses (`googleCalendar`, `gmail`, `microsoftTeams`, etc.).
 * Multiple UI slugs may map onto a single backend provider (e.g. `google`
 * powers both `gmail` and `googleCalendar`).
 */
function buildIntegrationsBlock(userId: string) {
  if (userId === "system") {
    return {
      slack: { label: "Slack", connected: false },
      github: { label: "GitHub", connected: false },
      googleCalendar: { label: "Google Calendar", connected: false },
      gmail: { label: "Gmail", connected: false },
      microsoftTeams: { label: "Microsoft Teams", connected: false },
      outlookCalendar: { label: "Outlook Calendar", connected: false },
      outlookMail: { label: "Outlook Mail", connected: false },
      notion: { label: "Notion", connected: false },
      jira: { label: "Jira", connected: false },
      linear: { label: "Linear", connected: false },
    };
  }
  const statuses = Object.fromEntries(
    listConnectionStatuses(userId).map((s) => [s.provider, s]),
  );
  const slackLegacy =
    db.getSlackConnectionsForUser(userId).length > 0 ||
    !!statuses.slack?.connected;
  const google = !!statuses.google?.connected;
  const microsoft = !!statuses.microsoft?.connected;
  return {
    slack: {
      label: "Slack",
      connected: slackLegacy,
      meta: statuses.slack || null,
    },
    github: {
      label: "GitHub",
      connected: !!statuses.github?.connected,
      meta: statuses.github || null,
    },
    googleCalendar: {
      label: "Google Calendar",
      connected: google,
      meta: statuses.google || null,
    },
    gmail: {
      label: "Gmail",
      connected: google,
      meta: statuses.google || null,
    },
    microsoftTeams: {
      label: "Microsoft Teams",
      connected: microsoft,
      meta: statuses.microsoft || null,
    },
    outlookCalendar: {
      label: "Outlook Calendar",
      connected: microsoft,
      meta: statuses.microsoft || null,
    },
    outlookMail: {
      label: "Outlook Mail",
      connected: microsoft,
      meta: statuses.microsoft || null,
    },
    notion: {
      label: "Notion",
      connected: !!statuses.notion?.connected,
      meta: statuses.notion || null,
    },
    jira: {
      label: "Jira",
      connected: !!statuses.jira?.connected,
      meta: statuses.jira || null,
    },
    linear: {
      label: "Linear",
      connected: !!statuses.linear?.connected,
      meta: statuses.linear || null,
    },
  };
}

app.get("/api/me", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const row =
      userId === "system"
        ? { id: "system", username: "system", email: null as string | null, created_at: null }
        : (db.getUserById(userId) as
            | { id: string; username: string; email: string | null; created_at: string }
            | undefined);
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

    const username = (row?.username || userId || "").trim();
    const colEmail = (row?.email && String(row.email).trim()) || "";
    const emailFromAccount = colEmail || (username.includes("@") ? username : "");
    const profileEmail = (prof.email || "").trim();
    const resolvedEmail = colEmail || (username.includes("@") ? username : "") || profileEmail;

    const isSystem = userId === "system";
    const hasPassword = isSystem ? true : db.getSetting(userId, "security.password_credential_set") === "1";
    const hasAccountEmail =
      isSystem ||
      Boolean(colEmail && isValidEmailFormat(colEmail)) ||
      username.includes("@") ||
      (profileEmail.length > 0 && isValidEmailFormat(profileEmail));
    const credentialIncomplete =
      !isSystem && (!hasPassword || !hasAccountEmail);

    const orgName = (db.getSetting(userId, "org.name") || "").trim();
    const orgRoleRaw = (db.getSetting(userId, "org.role") || "").trim();
    const orgOwnerUserIdRaw = (db.getSetting(userId, "org.owner_user_id") || "").trim();
    const orgOwnerUserId = orgOwnerUserIdRaw || null;
    const orgRole = orgRoleRaw || null;
    const isOrgOwner = !isSystem && Boolean(orgOwnerUserIdRaw && orgOwnerUserIdRaw === userId);

    res.json({
      user: row || { id: userId, username: userId, email: null, created_at: null },
      hasPassword,
      hasAccountEmail,
      credentialIncomplete,
      profile: {
        displayName: db.getAccountDisplayName(userId),
        bio: prof.bio || "",
        email: resolvedEmail,
        phone: prof.phone || "",
        location: prof.location || "",
        department: prof.department || "",
        role: prof.role || "",
      },
      org: {
        name: orgName || "",
        role: orgRole,
        ownerUserId: orgOwnerUserId,
        isOwner: isOrgOwner,
      },
      stats: {
        decisionsCreated,
        executionsOwned,
        signalsLinked,
        successRatePct,
      },
      integrations: buildIntegrationsBlock(userId),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/me", authMiddleware, requirePermission("settings:write"), (req, res) => {
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
        role: string;
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
      ["role", "profile.role"],
    ];
    let n = 0;
    for (const [field, key] of entries) {
      const v = (p as Record<string, unknown>)[field];
      if (v !== undefined) {
        if (field === "email") {
          const raw = String(v).trim();
          if (raw) {
            const em = normalizeEmail(raw);
            if (!isValidEmailFormat(em)) {
              return res.status(400).json({ error: "Invalid email address" });
            }
            const clash = db.rawGet(`SELECT id FROM users WHERE email = ? AND id != ?`, [em, userId]) as {
              id: string;
            }[];
            if (clash?.length) {
              return res.status(409).json({ error: "That email is already in use by another account." });
            }
            db.updateUserEmail(userId, em);
          } else {
            db.updateUserEmail(userId, null);
          }
        }
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
    const scope = tenantSqlScope(resolveTenantContext(userId));
    let sql = `SELECT id, vow, status, confidence, created_at, expected_outcomes, decision_reasoning
               FROM decision_ledger WHERE 1=1${scope.sql}`;
    const params: unknown[] = [...scope.params];
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

app.post("/api/decisions/commit", authMiddleware, requirePermission("decision:commit"), mutationRouteLimiter, async (req, res) => {
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  const { decisionId, justification, approvalId, emergencyOverride, emergencyReason } = req.body as {
    decisionId?: string;
    justification?: string;
    approvalId?: string;
    emergencyOverride?: boolean;
    emergencyReason?: string;
  };
  if (!decisionId) return res.status(400).json({ error: "decisionId required" });
  try {
    const orgId = await commitDecisionActive(userId, decisionId, justification, {
      approvalId,
      emergencyOverride,
      emergencyReason,
    }, authKind);
    appendAuthorityLedgerEvent({
      req,
      orgId,
      aggregateType: "decision",
      aggregateId: decisionId,
      eventType: "decision.commit",
      payload: {
        decisionId,
        status: "ACTIVE",
        justification: justification || null,
      },
    });
    res.json({ success: true, decisionId, status: "ACTIVE" });
  } catch (e: any) {
    const msg = e.message || String(e);
    const status = msg.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: msg });
  }
});

/** Create a DRAFT decision (optional default task). */
app.post("/api/decisions", authMiddleware, requirePermission("decision:write"), mutationRouteLimiter, async (req, res) => {
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  const body = req.body as {
    vow?: string;
    expected_outcomes?: unknown[];
    tasks?: { type?: string; weight?: number; owner?: string }[];
    institutional_reasoning?: unknown;
    reversal_conditions?: string;
    constraints?: unknown[];
    approvalId?: string;
  };
  const vow = String(body.vow || "").trim();
  if (!vow) return res.status(400).json({ error: "vow required" });
  try {
    const created = await authorizeAndExecuteMutation(
      {
        userId,
        authKind,
        permission: "decision:write",
        actionType: "log_strategic_decision",
        toolName: "log_strategic_decision",
        toolArgs: { vow, ...body },
        approvalId: body.approvalId,
      },
      () => mutationCreateDraftDecision(userId, body),
    );
    const orgId = resolveTenantContext(userId).orgId;
    appendAuthorityLedgerEvent({
      req,
      orgId,
      aggregateType: "decision",
      aggregateId: created.id,
      eventType: "decision.create",
      payload: {
        decisionId: created.id,
        status: "DRAFT",
        vow: vow.slice(0, 4000),
      },
    });
    res.status(201).json(created);
  } catch (e: any) {
    const status = e?.message?.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: e.message || "Failed to create decision" });
  }
});

app.post("/api/execution/signals/kill", authMiddleware, requirePermission("signal:write"), mutationRouteLimiter, async (req, res) => {
  const userId = (req as any).userId as string;
  const authKind = (req as any).authKind as string | undefined;
  const { signalId } = req.body as { signalId?: string };
  if (!signalId) return res.status(400).json({ error: "signalId required" });
  try {
    await authorizeAndExecuteMutation(
      {
        userId,
        authKind,
        permission: "signal:write",
        actionType: "kill_signal",
        toolName: "kill_signal",
        toolArgs: { signalId },
        resourceTenantId: db.getSignalTenant(signalId),
      },
      () => mutationKillSignal(userId, { signalId }),
    );
    res.json({ success: true, signalId });
  } catch (e: any) {
    const status = e?.message?.includes("not found") ? 404 : e?.message?.includes("Forbidden") ? 403 : 400;
    res.status(status).json({ error: e.message || "Failed to kill signal" });
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
      `SELECT date(a.timestamp) as day,
          SUM(CASE WHEN a.reason LIKE '%New State: DONE%' THEN 1 ELSE 0 END) as wins,
          COUNT(*) as events
       FROM audit_log a
       LEFT JOIN decision_ledger d ON a.affected_entity_id = d.id
       LEFT JOIN execution_ledger e ON a.affected_entity_id = e.task_id
       LEFT JOIN decision_ledger d2 ON e.decision_id = d2.id
       WHERE a.timestamp > datetime('now', '-14 days')
         AND (d.user_id = ? OR d2.user_id = ?)
       GROUP BY date(a.timestamp)
       ORDER BY day ASC`,
      [userId, userId],
    ) as { day: string; wins: number; events: number }[];

    const chart = daily.map((d) => {
      const events = Number(d.events) || 0;
      const wins = Number(d.wins) || 0;
      const load = Math.min(100, events * 4);
      const success = events > 0 ? Math.round((wins / events) * 100) : 0;
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
      chart,
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
    const entries = buildTeamEntries(userId);
    const owners = db.rawGet(
      `SELECT e.owner as owner,
          SUM(CASE WHEN e.status = 'ACTIVE' THEN e.weight ELSE 0 END) as active_weight
       FROM execution_ledger e
       INNER JOIN decision_ledger d ON e.decision_id = d.id
       WHERE d.user_id = ?
       GROUP BY e.owner`,
      [userId],
    ) as { owner: string; active_weight: number }[];

    const members = entries.map((e) => {
      const base = {
        id: e.id,
        name: e.name,
        email: e.email,
        role: e.role,
        team: e.team,
        capacity: e.capacity,
        loadPct: e.loadPct,
        utilization: e.utilization,
        status: e.status,
        slackId: e.slackId,
        talentTier: e.talentTier,
        canRemove: e.canRemove,
        isOrgOwner: e.isOrgOwner,
      };
      if (!e.intelligence) return base;
      return {
        ...base,
        beliefs: e.intelligence.topBeliefs,
        derivedCapacity: {
          value: e.intelligence.derivedCapacity,
          confidence: e.intelligence.derivedConfidence,
          uncertainty: e.intelligence.uncertainty,
        },
        legacyCapacity: e.intelligence.legacyCapacity,
        trustScore: e.intelligence.trustScore,
        intelligenceAdvisory: true,
      };
    });

    let totalCap = 0;
    let totalLoad = 0;
    for (const o of owners) {
      const cap = db.getOwnerCapacity(o.owner).capacity;
      totalCap += cap;
      totalLoad += Number(o.active_weight || 0);
    }
    /** Same source as `GET /api/settings/capacity-summary`: org-wide points budget in `settings`. */
    const rawSystemTotal =
      userId && userId !== "system" ? String(db.getSetting(userId, "capacity.system_total") ?? "").trim() : "";
    const systemTotalParsed =
      rawSystemTotal !== "" ? Math.max(1, parseInt(rawSystemTotal, 10) || 1) : null;
    const budgetFromSettings = systemTotalParsed != null;
    const aggregateBudget = budgetFromSettings ? systemTotalParsed : totalCap;
    const usedPct =
      aggregateBudget > 0 ? Math.round((totalLoad / aggregateBudget) * 100) : 0;
    const over = Math.max(0, totalLoad - aggregateBudget);
    const available = Math.max(0, aggregateBudget - totalLoad);

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

    const rosterAdded = members.length - owners.length;
    const membersNote =
      owners.length > 0
        ? `${owners.length} execution owner(s)${rosterAdded > 0 ? `, ${rosterAdded} roster` : ""}`
        : rosterAdded > 0
          ? `${rosterAdded} roster member(s)`
          : "No ledger owners yet — add roster members below";

    res.json({
      metrics: {
        members: members.length,
        membersNote,
        utilization: usedPct,
        utilTrend:
          aggregateBudget > 0
            ? budgetFromSettings
              ? `Load ${totalLoad.toFixed(1)} / ${aggregateBudget} pts (Settings → Capacity)`
              : `Load ${totalLoad.toFixed(1)} / ${aggregateBudget.toFixed(1)} wt (owner reputation)`
            : "—",
        atRisk: riskN,
        overCapacity: overN,
        budgetSource: budgetFromSettings ? "settings_total" : "owner_reputation_sum",
        aggregateBudget,
      },
      members,
      donut: {
        total: Math.round(aggregateBudget * 10) || 0,
        used: Math.round(totalLoad * 10),
        usedPct,
        available: Math.round(available * 10),
        availablePct:
          aggregateBudget > 0 ? Math.round((available / aggregateBudget) * 100) : 0,
        over: Math.round(over * 10),
        overPct:
          aggregateBudget > 0 ? Math.round((over / aggregateBudget) * 100) : 0,
      },
      deptBars: deptBars.length ? deptBars : [{ dept: "system", pct: 0 }],
      insights,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/metrics/teams/entries", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const entries = buildTeamEntries(userId);
    res.json({
      entries,
      total: entries.length,
      rosterCount: entries.filter((e) => e.source === "roster").length,
      ledgerCount: entries.filter((e) => e.source === "ledger").length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/metrics/teams/roster", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const rows = db.listTeamRoster(userId);
    const entries = rows.map((r) => ({
      ...mapRosterRow(r),
      createdAt: r.created_at,
    }));
    res.json({ entries, total: entries.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/metrics/teams/roster/:id", authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  try {
    const row = db.getTeamRosterMember(userId, id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({
      entry: {
        ...mapRosterRow(row),
        createdAt: row.created_at,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/metrics/teams/roster", authMiddleware, requirePermission("settings:write"), (req, res) => {
  const userId = (req as any).userId as string;
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim();
  const role = String(b.role || "Member").trim() || "Member";
  const team = String(b.team || "General").trim() || "General";
  const capacity = String(b.capacity || "40h / week").trim() || "40h / week";
  const slackId = b.slackId != null ? String(b.slackId).trim() : "";
  const talentTier = b.talentTier != null ? String(b.talentTier).trim() : "";
  if (!name || !email) {
    return res.status(400).json({ error: "name and email are required" });
  }
  try {
    const id = db.insertTeamRosterMember(userId, {
      name,
      email,
      role,
      team,
      capacity,
      slackId: slackId || undefined,
      talentTier: talentTier || undefined,
    });
    res.json({ ok: true, id });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return res.status(409).json({ error: "A roster member with this email already exists" });
    }
    res.status(500).json({ error: msg });
  }
});

app.delete(
  "/api/metrics/teams/roster/:id",
  authMiddleware,
  requirePermission("settings:write"),
  (req, res) => {
  const userId = (req as any).userId as string;
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  try {
    const ok = db.deleteTeamRosterMember(userId, id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.patch(
  "/api/metrics/teams/roster/:id",
  authMiddleware,
  requirePermission("settings:write"),
  (req, res) => {
  const userId = (req as any).userId as string;
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  const b = req.body || {};
  try {
    const existing = db.getTeamRosterMember(userId, id);
    if (!existing) return res.status(404).json({ error: "not found" });

    const name =
      b.name !== undefined ? String(b.name).trim() : existing.name;
    const email =
      b.email !== undefined ? String(b.email).trim().toLowerCase() : existing.email;
    const role =
      b.role !== undefined ? String(b.role).trim() || "Member" : existing.role;
    const team =
      b.team !== undefined ? String(b.team).trim() || "General" : existing.team;
    const capacity =
      b.capacity !== undefined
        ? String(b.capacity).trim() || "40h / week"
        : existing.capacity;
    const slackId =
      b.slackId !== undefined
        ? String(b.slackId).trim() || undefined
        : existing.slack_id || undefined;
    const talentTier =
      b.talentTier !== undefined
        ? String(b.talentTier).trim() || undefined
        : existing.talent_tier || undefined;

    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }

    const ok = db.updateTeamRosterMember(userId, id, {
      name,
      email,
      role,
      team,
      capacity,
      slackId,
      talentTier,
    });
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, id, entry: mapRosterRow({ ...existing, name, email, role, team, capacity, slack_id: slackId ?? null, talent_tier: talentTier ?? null }) });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return res.status(409).json({ error: "A roster member with this email already exists" });
    }
    res.status(500).json({ error: msg });
  }
});

app.get("/api/metrics/teams/roster/schema", authMiddleware, (_req, res) => {
  res.json({ fields: ROSTER_FIELD_SCHEMA });
});

app.post("/api/metrics/teams/roster/parse", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as string;
  const b = req.body || {};
  try {
    if (b.kind === "rows" && Array.isArray(b.headers) && Array.isArray(b.rows)) {
      const headers = (b.headers as unknown[]).map((h) => String(h ?? ""));
      const rows = (b.rows as unknown[][]).map((r) =>
        Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
      );
      const parsed = rowsToRosterMembers(headers, rows);
      return res.json({ ...parsed, schema: ROSTER_FIELD_SCHEMA });
    }

    if (b.kind === "pdf" && typeof b.fileBase64 === "string") {
      const raw = String(b.fileBase64).replace(/^data:[^;]+;base64,/, "").trim();
      if (raw.length > 8_000_000) {
        return res.status(413).json({ error: "PDF too large (max ~6MB)" });
      }
      const buf = Buffer.from(raw, "base64");
      const text = await extractTextFromPdfBuffer(buf);
      const parsed = await parsePdfTextToRoster(userId, text);
      return res.json({ ...parsed, schema: ROSTER_FIELD_SCHEMA });
    }

    return res.status(400).json({
      error: 'Send kind "rows" with headers+rows (Excel/CSV) or kind "pdf" with fileBase64',
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.post(
  "/api/metrics/teams/roster/bulk",
  authMiddleware,
  requirePermission("settings:write"),
  (req, res) => {
  const userId = (req as any).userId as string;
  const members = Array.isArray(req.body?.members) ? req.body.members : [];
  if (!members.length) {
    return res.status(400).json({ error: "members array is required" });
  }
  const results: { email: string; id: string; created: boolean; error?: string }[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const raw of members) {
    const name = String(raw?.name || "").trim();
    const email = String(raw?.email || "").trim().toLowerCase();
    if (!name || !email) {
      failed++;
      results.push({ email: email || "?", id: "", created: false, error: "name and email required" });
      continue;
    }
    try {
      const r = db.upsertTeamRosterByEmail(userId, {
        name,
        email,
        role: String(raw?.role || "Member").trim() || "Member",
        team: String(raw?.team || "General").trim() || "General",
        capacity: String(raw?.capacity || "40h / week").trim() || "40h / week",
        slackId: raw?.slackId != null ? String(raw.slackId).trim() : undefined,
        talentTier: raw?.talentTier != null ? String(raw.talentTier).trim() : undefined,
      });
      if (r.created) created++;
      else updated++;
      results.push({ email, id: r.id, created: r.created });
    } catch (e: any) {
      failed++;
      results.push({
        email,
        id: "",
        created: false,
        error: String(e?.message || e),
      });
    }
  }
  res.json({ ok: true, created, updated, failed, results });
});

// --- Generic OAuth (every non-legacy provider plugs in here) ---
mountOAuthRoutes(app);

// --- Per-provider connector routes & lifecycle hooks ---
registerGithubLifecycleHooks();
mountGithubRoutes(app);
registerMicrosoftLifecycleHooks();
mountMicrosoftRoutes(app);
registerLinearLifecycleHooks();
registerJiraLifecycleHooks();
registerNotionLifecycleHooks();
registerGoogleLifecycleHooks();
mountGoogleRoutes(app);
mountConnectionsHealthRoute(app);

// --- Logs & Stats ---
app.get("/api/health", (_req, res) => {
  let dbOk = false;
  try {
    db.rawGet("SELECT 1 as ok");
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const base = {
    status: dbOk ? "online" : "degraded",
    db: dbOk,
    timestamp: new Date().toISOString(),
  };
  if (config.server.isProduction) {
    return res.status(dbOk ? 200 : 503).json(base);
  }
  const llmConfigured = hasLlmCredentials("system");
  return res.status(dbOk ? 200 : 503).json({
    ...base,
    llmConfigured,
    activeProvider: config.agent.activeProvider,
    anthropicPremiumModel: config.anthropic.premiumModel,
    anthropicFastModel: config.anthropic.fastModel,
    uptimeSec: Math.floor((Date.now() - serverStartedAt) / 1000),
  });
});

// --- WebSocket Orchestration ---
export type AgentWsReply = (payload: Record<string, unknown>) => void;

export type AgentMessageOptions = {
  planMode?: boolean;
  authKind?: AuthKind | string;
};

let onMessage:
  | ((
      userId: string,
      text: string,
      sessionId: string,
      reply: AgentWsReply,
      options?: AgentMessageOptions,
    ) => Promise<void>)
  | null = null;

export function setAgentMessageHandler(
  handler: (
    userId: string,
    text: string,
    sessionId: string,
    reply: AgentWsReply,
    options?: AgentMessageOptions,
  ) => Promise<void>,
) {
  onMessage = handler;
}

type HxWebSocket = WebSocket & { hxUserId?: string; hxAuthKind?: WsAuthContext["authKind"] };

export function broadcast(type: string, data: Record<string, unknown>, targetUserId?: string) {
  const payload = JSON.stringify({ type, ...data });
  wssSingleton?.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (targetUserId) {
      const uid = (client as HxWebSocket).hxUserId;
      if (uid !== targetUserId) return;
    }
    client.send(payload);
  });
}

function wireWebSocketHandlers(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
  const auth = resolveWsAuth(req);
  if (auth === null) {
    ws.send(JSON.stringify({ type: "auth_error", error: "Unauthorized WebSocket connection." }));
    ws.close(4401, "Unauthorized");
    return;
  }
  const { userId, authKind } = auth;
  (ws as HxWebSocket).hxUserId = userId;
  (ws as HxWebSocket).hxAuthKind = authKind;

  ws.on("error", (err) => {
    console.error("[WS] error", { userId, error: err.message });
  });

  // Send sessions list after the browser has fully settled the upgrade.
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const sessions = db.rawGet("SELECT DISTINCT session_id FROM messages WHERE user_id = ? ORDER BY timestamp DESC", [userId]);
    ws.send(JSON.stringify({ type: "sessions", data: sessions }));
  }, 0);

  ws.on("message", async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      const wsAction = wsActionFromPayload(payload);
      if (wsAction) {
        authorizeWsAction({ userId, authKind, action: wsAction });
      }

      if (payload.type === "load_session") {
        const sid = payload.sessionId || "default";
        const history = db.getRecentMessages(userId, sid, 200);
        ws.send(JSON.stringify({ type: "history", sessionId: sid, data: history }));
      }
      else if (payload.type === "text" && onMessage) {
        const textLimit = checkWsRateLimit(userId, "text");
        if (!textLimit.allowed) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Chat rate limit exceeded. Retry in ${Math.ceil((textLimit.retryAfterMs ?? 0) / 1000)}s.`,
              code: "RATE_LIMIT",
            }),
          );
          return;
        }
        const sid = payload.sessionId || "default";
        const reply: AgentWsReply = (obj) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
        };
        const planMode =
          payload.planMode === true ||
          payload.mode === "plan" ||
          payload.chatMode === "plan";
        await onMessage(userId, payload.text, sid, reply, { planMode, authKind });
      }
      else if (payload.type === "COMMIT_DECISION") {
        const commitLimit = checkWsRateLimit(userId, "commit_decision");
        if (!commitLimit.allowed) {
          broadcast(
            "DECISION_COMMIT_FAILED",
            {
              decisionId: payload.decisionId,
              error: `Rate limit exceeded. Retry in ${Math.ceil((commitLimit.retryAfterMs ?? 0) / 1000)}s.`,
            },
            userId,
          );
          return;
        }
        console.log(`🛡️ [Decision] Committing decision ${payload.decisionId}...`);
        try {
          await commitDecisionActive(userId, payload.decisionId, payload.justification, {
            approvalId: payload.approvalId,
            emergencyOverride: payload.emergencyOverride,
            emergencyReason: payload.emergencyReason,
          }, authKind);
          broadcast(
            "DECISION_COMMITTED",
            { decisionId: payload.decisionId, status: "ACTIVE" },
            userId,
          );
        } catch (err: any) {
          console.error("❌ [Decision] Commit failed:", err?.message || err);
          broadcast(
            "DECISION_COMMIT_FAILED",
            {
              decisionId: payload.decisionId,
              error: err?.message || String(err),
            },
            userId,
          );
        }
      }
      else if (payload.type === "SYNC_PROTOCOLS") {
        if (process.env.DEMO_MODE !== "1") {
          ws.send(JSON.stringify({ type: "error", error: "SYNC_PROTOCOLS requires DEMO_MODE=1.", code: "FORBIDDEN" }));
          return;
        }
        await connectionsManager.syncProtocols();
      }
      else if (payload.type === "new_session") {
        const channel = payload.channel === "assistant" ? "assistant" : "chat";
        const newSessId =
          channel === "assistant" ? `asst:${uuidv4()}` : uuidv4();
        ws.send(
          JSON.stringify({ type: "session_created", sessionId: newSessId, channel }),
        );
      }
      else if (payload.type === "CAPABILITY_OVERRIDE") {
        if (process.env.DEMO_MODE !== "1") {
          ws.send(JSON.stringify({ type: "error", error: "CAPABILITY_OVERRIDE requires DEMO_MODE=1.", code: "FORBIDDEN" }));
          return;
        }
        connectionsManager.updateStatus(payload.id, payload.status, payload.reason);
      }
    } catch (err) {
      if (err instanceof AuthorizationError) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: err.message,
            code: err.requiredPermission || "FORBIDDEN",
          }),
        );
        return;
      }
      console.error("❌ [Server] Inbound message error:", err);
    }
  });
  });
}

/**
 * Walk the provider registry and print a single line per integration with the
 * boot-time wire status. Designed to read like Stripe/Anthropic startup
 * banners — small, scannable, and present in production logs.
 */
function logIntegrationConfigSummary() {
  const slackOk = !!process.env.SLACK_CLIENT_ID?.trim() && !!process.env.SLACK_CLIENT_SECRET?.trim();
  const githubOk =
    !!process.env.GITHUB_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const googleIntegrationOk =
    !!process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const microsoftOk =
    !!process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const notionOk =
    !!process.env.NOTION_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  const jiraOk =
    !!process.env.JIRA_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.JIRA_OAUTH_CLIENT_SECRET?.trim();
  const linearOk =
    !!process.env.LINEAR_OAUTH_CLIENT_ID?.trim() &&
    !!process.env.LINEAR_OAUTH_CLIENT_SECRET?.trim();
  const smtpOk = !!process.env.SMTP_HOST?.trim() && !!process.env.SMTP_USER?.trim();

  const tick = (ok: boolean) => (ok ? "✅" : "⚠️ ");
  const lines = [
    `${tick(slackOk)} Slack            ${slackOk ? "configured" : "OAuth disabled (SLACK_CLIENT_ID/SECRET unset)"}`,
    `${tick(githubOk)} GitHub           ${githubOk ? "configured" : "OAuth disabled (GITHUB_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(googleIntegrationOk)} Google           ${googleIntegrationOk ? "configured (Calendar + Gmail)" : "OAuth disabled (GOOGLE_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(microsoftOk)} Microsoft 365    ${microsoftOk ? "configured (Teams + Outlook)" : "OAuth disabled (MICROSOFT_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(notionOk)} Notion           ${notionOk ? "configured" : "OAuth disabled (NOTION_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(jiraOk)} Jira             ${jiraOk ? "configured" : "OAuth disabled (JIRA_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(linearOk)} Linear           ${linearOk ? "configured" : "OAuth disabled (LINEAR_OAUTH_CLIENT_ID/SECRET unset)"}`,
    `${tick(smtpOk)} SMTP             ${smtpOk ? "configured" : "OTP/contact email disabled (SMTP_HOST/SMTP_USER unset)"}`,
  ];
  console.log("📡 Integrations:");
  for (const line of lines) console.log("   " + line);
}

/**
 * Boot all post-listen integration services: notification scheduler, OAuth
 * refresh + renewal workers, integration config banner. Idempotent enough
 * for the dual entry points (legacy `startServer` and `unified-server.ts`).
 * Kept side-effecting (console + worker start) on purpose — operators read
 * these lines to confirm the deploy is actually live, not just bound.
 */
export function bootIntegrationServices() {
  startNotificationDigestScheduler();
  try {
    assertOAuthEncryptionConfigured();
    startOAuthRefreshWorker();
    startMicrosoftRenewalWorker();
    startJiraRenewalWorker();
    startNotionPollWorker();
    startGoogleWorkers();
    console.log("✅ OAuth refresh worker started (proactive token rotation enabled).");
    console.log("✅ Microsoft Graph subscription renewal worker started.");
    console.log("✅ Jira webhook renewal worker started (30-day cycle).");
    console.log("✅ Notion poll worker started (5-minute cadence).");
    console.log("✅ Google workers started (calendar renewal + gmail poll).");
  } catch (err) {
    console.warn(
      `⚠️ OAuth integrations disabled: ${(err as Error).message}. Set OAUTH_TOKEN_ENCRYPTION_KEY in your environment to enable Slack/GitHub/Google/Microsoft/Notion/Jira/Linear connections.`,
    );
  }
  logIntegrationConfigSummary();
  const googleReady =
    !!process.env.GOOGLE_CLIENT_ID?.trim() && !!process.env.GOOGLE_REDIRECT_URI?.trim();
  if (googleReady) {
    console.log("✅ Google OAuth: GOOGLE_CLIENT_ID + GOOGLE_REDIRECT_URI are set.");
  } else {
    console.warn(
      "⚠️ Google OAuth disabled until repo root `.env` sets GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI (restart API after editing).",
    );
  }
}

export function startServer() {
  const PORT = config.server.port;
  const srv = createServer(app);
  attachWebSocketServer(srv);
  srv.listen(PORT, () => {
    console.log(`🌐 [Hustronix Server] Live on http://localhost:${PORT}`);
    bootIntegrationServices();
  });
}

export { app };
