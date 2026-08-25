/**
 * Nango OAuth bridge routes.
 *
 *   GET  /api/nango/providers              — full OAuth catalog (+ featured)
 *   GET  /api/nango/connections            — this user's connected providers
 *   POST /api/nango/connect-session        — short-lived Connect UI session token
 *   POST /api/nango/connections/sync       — persist connection id after Connect UI success
 *   DELETE /api/nango/connections/:provider — disconnect (Nango + local row)
 *   GET|POST /api/nango/webhook            — auth + sync webhooks (ACK fast; sync → async ingest)
 *   POST /api/nango/sync/process           — manual sync→ingest for a connection+model (pilot)
 *   POST /api/nango/bootstrap              — ensure featured (or all) integrations exist in Nango
 *
 * Architecture: docs/nango-to-signals-architecture.md
 * Local note: Nango Cloud cannot reach http://127.0.0.1 — set NANGO_WEBHOOK_URL to a
 * public tunnel (ngrok) and paste the same URL in Nango Environment Settings → Webhooks.
 * Docs: https://nango.dev/docs/guides/platform/webhooks-from-nango
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../security/authorization.js";
import {
  dispatchNangoSyncFireAndForget,
  fetchAndIngestSyncRecords,
} from "./dispatcher.js";
import {
  findCatalogEntry,
  getFeaturedOAuthCatalog,
  getNangoClient,
  getOAuthCatalog,
  integrationIdForProvider,
  isNangoConfigured,
} from "./nangoClient.js";
import {
  deleteNangoConnection,
  ensureNangoTables,
  getNangoConnection,
  listNangoConnections,
  upsertNangoConnection,
} from "./nangoStore.js";

function userIdOf(req: Request): string {
  return String((req as { userId?: string }).userId || "");
}

/** Public HTTPS URL Nango Cloud should POST to (tunnel). Never 127.0.0.1. */
function publicWebhookUrl(): string | undefined {
  const raw =
    process.env.NANGO_WEBHOOK_URL?.trim() ||
    process.env.NANGO_WEBHOOK_PUBLIC_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

function webhookSigningKey(): string {
  return (
    process.env.NANGO_WEBHOOK_SIGNING_KEY?.trim() ||
    process.env.NANGO_SECRET_KEY?.trim() ||
    process.env.NANGO_API_KEY?.trim() ||
    ""
  );
}

/**
 * Verify X-Nango-Hmac-Sha256 (preferred) per Nango docs.
 * Signing key = Environment Settings → Webhooks → Signing key (not the API key when they differ).
 */
function verifyNangoWebhook(req: Request): boolean {
  const key = webhookSigningKey();
  if (!key) return true; // allow in early local setup; set NANGO_WEBHOOK_SIGNING_KEY for prod
  const header =
    String(req.headers["x-nango-hmac-sha256"] || "").trim() ||
    String(req.headers["x-nango-signature"] || "").trim();
  if (!header) {
    // Local manual tests without signature
    if (process.env.NODE_ENV !== "production") return true;
    return false;
  }
  const raw =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac("sha256", key).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(header, "utf8"),
    );
  } catch {
    return expected === header;
  }
}

function parseWebhookBody(req: Request): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function ensureIntegrationExists(providerSlug: string): Promise<string> {
  const nango = getNangoClient();
  const uniqueKey = integrationIdForProvider(providerSlug);
  const entry = findCatalogEntry(providerSlug);
  if (!entry) throw new Error(`unknown_provider:${providerSlug}`);

  if (uniqueKey === "github") {
    try {
      await nango.getIntegration({ uniqueKey: "github-getting-started" });
      return "github-getting-started";
    } catch {
      /* fall through */
    }
  }

  try {
    await nango.getIntegration({ uniqueKey });
    return uniqueKey;
  } catch {
    /* create below */
  }

  const googleId =
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim();
  const useGoogle =
    /^(google|google-mail|google-drive|google-calendar|gmail|outlook)$/.test(
      uniqueKey,
    ) &&
    googleId &&
    googleSecret;

  await nango.createIntegration({
    provider: providerSlug,
    unique_key: uniqueKey,
    display_name: entry.name,
    credentials: {
      type: "OAUTH2",
      client_id: useGoogle ? googleId : "nango",
      client_secret: useGoogle ? googleSecret : "nango",
      ...(useGoogle ? { scopes: "openid,email,profile" } : {}),
    },
  } as Parameters<typeof nango.createIntegration>[0]);
  return uniqueKey;
}

export function mountNangoRoutes(app: Express): void {
  ensureNangoTables();

  app.get("/api/nango/status", authMiddleware, (_req, res) => {
    const webhookUrl = publicWebhookUrl();
    res.json({
      configured: isNangoConfigured(),
      host: process.env.NANGO_HOST?.trim() || "https://api.nango.dev",
      catalogSize: getOAuthCatalog().length,
      featuredSize: getFeaturedOAuthCatalog().length,
      webhookUrl: webhookUrl || null,
      webhookReachableFromNangoCloud: Boolean(
        webhookUrl && !/localhost|127\.0\.0\.1/i.test(webhookUrl),
      ),
      hint: webhookUrl
        ? undefined
        : "Set NANGO_WEBHOOK_URL to a public HTTPS tunnel (ngrok http 3005). Nango Cloud cannot POST to 127.0.0.1.",
    });
  });

  app.get("/api/nango/providers", authMiddleware, (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .toLowerCase();
    const category = String(req.query.category || "")
      .trim()
      .toLowerCase();
    const featuredOnly = String(req.query.featured || "") === "1";
    const connected = new Set(
      listNangoConnections(userIdOf(req)).map((c) => c.provider),
    );

    let list = featuredOnly ? getFeaturedOAuthCatalog() : getOAuthCatalog();
    if (category) {
      list = list.filter((p) =>
        p.categories.some((c) => c.toLowerCase() === category),
      );
    }
    if (q) {
      list = list.filter(
        (p) =>
          p.slug.includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.categories.some((c) => c.toLowerCase().includes(q)),
      );
    }

    const categories = [
      ...new Set(
        getOAuthCatalog().flatMap((p) => p.categories).filter(Boolean),
      ),
    ].sort();

    res.json({
      configured: isNangoConfigured(),
      total: getOAuthCatalog().length,
      categories,
      providers: list.map((p) => ({
        ...p,
        connected: connected.has(p.slug),
        description: descriptionFor(p.categories, p.name),
      })),
    });
  });

  app.get("/api/nango/connections", authMiddleware, (req, res) => {
    res.json({
      configured: isNangoConfigured(),
      connections: listNangoConnections(userIdOf(req)).map((c) => ({
        id: c.id,
        provider: c.provider,
        integrationId: c.integration_id,
        connectionId: c.connection_id,
        name: c.connection_name,
        lastSyncAt: c.last_sync_at ?? null,
        updatedAt: c.updated_at,
        catalog: findCatalogEntry(c.provider) || null,
      })),
    });
  });

  /**
   * Manual pilot: fetch Nango sync records for a model and write external_signals.
   * Body: { provider, model, syncName?, resetCursor? }
   */
  app.post(
    "/api/nango/sync/process",
    authMiddleware,
    requirePermission("signal:write"),
    async (req, res) => {
      if (!isNangoConfigured()) {
        return res.status(503).json({ error: "nango_not_configured" });
      }
      const provider = String(req.body?.provider || "").trim().toLowerCase();
      const model = String(req.body?.model || "").trim();
      if (!provider || !model) {
        return res.status(400).json({ error: "provider_and_model_required" });
      }
      const conn = getNangoConnection(userIdOf(req), provider);
      if (!conn) return res.status(404).json({ error: "not_connected" });

      try {
        const result = await fetchAndIngestSyncRecords({
          conn,
          integrationId: conn.integration_id,
          model,
          syncName: req.body?.syncName ? String(req.body.syncName) : undefined,
          resetCursor: Boolean(req.body?.resetCursor),
        });
        res.json({ ok: true, result });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[nango] sync/process failed:", msg);
        res.status(502).json({ error: "nango_sync_process_failed", detail: msg });
      }
    },
  );

  app.post("/api/nango/connect-session", authMiddleware, async (req, res) => {
    if (!isNangoConfigured()) {
      return res.status(503).json({
        error: "nango_not_configured",
        hint: "Set NANGO_SECRET_KEY (or NANGO_API_KEY) from app.nango.dev → Environment Settings → API Keys.",
      });
    }
    const provider = String(req.body?.provider || req.body?.integrationId || "")
      .trim()
      .toLowerCase();
    if (!provider || !findCatalogEntry(provider)) {
      return res.status(400).json({ error: "unknown_provider" });
    }

    try {
      const integrationId = await ensureIntegrationExists(provider);
      const nango = getNangoClient();
      const uid = userIdOf(req);
      const webhookOverride = publicWebhookUrl();
      const webhookFull = webhookOverride
        ? webhookOverride.includes("/api/nango/webhook")
          ? webhookOverride
          : `${webhookOverride}/api/nango/webhook`
        : undefined;
      const { data } = await nango.createConnectSession({
        tags: {
          end_user_id: uid,
          organization_id: uid,
        },
        allowed_integrations: [integrationId],
        // Per-connection override so local tunnels work without changing env webhook URLs.
        // https://nango.dev/docs/guides/platform/webhooks-from-nango
        ...(webhookFull ? { webhook_url_override: webhookFull } : {}),
      });
      res.status(201).json({
        sessionToken: data.token,
        connectLink: data.connect_link,
        expiresAt: data.expires_at,
        integrationId,
        provider,
        webhookUrlOverride: webhookFull || null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[nango] connect-session failed:", msg);
      res.status(502).json({ error: "nango_session_failed", detail: msg });
    }
  });

  app.post("/api/nango/connections/sync", authMiddleware, async (req, res) => {
    const provider = String(req.body?.provider || "").trim().toLowerCase();
    const connectionId = String(req.body?.connectionId || "").trim();
    const integrationId = String(
      req.body?.integrationId || integrationIdForProvider(provider),
    ).trim();
    if (!provider || !connectionId) {
      return res.status(400).json({ error: "provider_and_connectionId_required" });
    }
    if (!findCatalogEntry(provider)) {
      return res.status(400).json({ error: "unknown_provider" });
    }
    const row = upsertNangoConnection({
      userId: userIdOf(req),
      provider,
      integrationId,
      connectionId,
      connectionName: findCatalogEntry(provider)?.name || provider,
    });
    res.json({
      ok: true,
      connection: {
        provider: row.provider,
        integrationId: row.integration_id,
        connectionId: row.connection_id,
      },
    });
  });

  app.delete(
    "/api/nango/connections/:provider",
    authMiddleware,
    async (req, res) => {
      const provider = String(req.params.provider || "").trim().toLowerCase();
      const rows = listNangoConnections(userIdOf(req));
      const row = rows.find((r) => r.provider === provider);
      if (!row) return res.status(404).json({ error: "not_connected" });

      if (isNangoConfigured()) {
        try {
          const nango = getNangoClient();
          await nango.deleteConnection(row.integration_id, row.connection_id);
        } catch (e: unknown) {
          console.warn(
            "[nango] remote delete failed (continuing local):",
            e instanceof Error ? e.message : e,
          );
        }
      }
      deleteNangoConnection(userIdOf(req), provider);
      res.json({ ok: true, provider });
    },
  );

  /** Public webhook — Nango Cloud POSTs here. Requires a public URL (not 127.0.0.1). */
  const nangoWebhookGet = (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      method: "GET",
      note: "Nango sends POST. Use a public tunnel URL in Environment Settings.",
    });
  };
  const nangoWebhookPost = async (req: Request, res: Response) => {
    if (!verifyNangoWebhook(req)) {
      return res.status(401).json({ error: "invalid_webhook_signature" });
    }
    const body = parseWebhookBody(req);
    const type = String(body.type || "");
    const operation = String(body.operation || "");
    const success = body.success === true;
    const connectionId = body.connectionId != null ? String(body.connectionId) : "";
    const tags = (body.tags && typeof body.tags === "object"
      ? body.tags
      : {}) as Record<string, unknown>;
    const endUserId = String(tags.end_user_id || "").trim();
    const providerConfigKey = String(
      body.providerConfigKey || body.integrationId || "",
    ).trim();

    // Auth: update connection mapping only. Never touch evidence ledger on auth events.
    if (type === "auth" && operation === "creation" && success && connectionId) {
      if (endUserId && providerConfigKey) {
        upsertNangoConnection({
          userId: endUserId,
          provider: providerConfigKey,
          integrationId: providerConfigKey,
          connectionId,
          connectionName: findCatalogEntry(providerConfigKey)?.name || null,
        });
      }
    }
    if (type === "auth" && (operation === "deletion" || operation === "override")) {
      if (operation === "deletion" && endUserId && providerConfigKey) {
        deleteNangoConnection(endUserId, providerConfigKey);
      }
      if (operation === "override" && success && connectionId && endUserId && providerConfigKey) {
        upsertNangoConnection({
          userId: endUserId,
          provider: providerConfigKey,
          integrationId: providerConfigKey,
          connectionId,
          connectionName: findCatalogEntry(providerConfigKey)?.name || null,
        });
      }
    }

    // Sync: ACK immediately, then async listRecords → adapter → ingestExternal.
    // Intelligence runs via auditor.onWrite after ledger insert — not inside this request.
    if (type === "sync") {
      res.status(200).json({ ok: true, accepted: "sync" });
      dispatchNangoSyncFireAndForget({
        type,
        success: body.success !== false,
        connectionId,
        providerConfigKey,
        integrationId: providerConfigKey,
        syncName: body.syncName != null ? String(body.syncName) : undefined,
        model: body.model != null ? String(body.model) : undefined,
        modifiedAfter:
          body.modifiedAfter != null ? String(body.modifiedAfter) : undefined,
      });
      return;
    }

    // Ignore unknown webhook types (Nango adds new types without it being a breaking change).
    res.status(200).json({ ok: true });
  };

  app.get("/api/nango/webhook", nangoWebhookGet);
  app.post("/api/nango/webhook", nangoWebhookPost);
  app.get("/api/integrations/nango/webhook", nangoWebhookGet);
  app.post("/api/integrations/nango/webhook", nangoWebhookPost);

  /**
   * Create missing Nango integrations for featured (default) or all OAuth providers.
   * Uses Nango shared OAuth apps where available — no per-provider client secrets required for setup.
   */
  app.post(
    "/api/nango/bootstrap",
    authMiddleware,
    requirePermission("settings:write"),
    async (req, res) => {
      if (!isNangoConfigured()) {
        return res.status(503).json({ error: "nango_not_configured" });
      }
      const all = String(req.body?.all || "") === "true" || req.body?.all === true;
      const list = all ? getOAuthCatalog() : getFeaturedOAuthCatalog();
      const nango = getNangoClient();
      const results: {
        slug: string;
        status: "created" | "exists" | "error";
        detail?: string;
      }[] = [];

      for (const entry of list) {
        const uniqueKey = integrationIdForProvider(entry.slug);
        try {
          try {
            await nango.getIntegration({ uniqueKey });
            results.push({ slug: entry.slug, status: "exists" });
            continue;
          } catch {
            /* create */
          }
          await nango.createIntegration({
            provider: entry.slug,
            unique_key: uniqueKey,
            display_name: entry.name,
          } as Parameters<typeof nango.createIntegration>[0]);
          results.push({ slug: entry.slug, status: "created" });
        } catch (e: unknown) {
          results.push({
            slug: entry.slug,
            status: "error",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }

      res.json({
        ok: true,
        scope: all ? "all_oauth" : "featured",
        created: results.filter((r) => r.status === "created").length,
        exists: results.filter((r) => r.status === "exists").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      });
    },
  );
}

function descriptionFor(categories: string[], name: string): string {
  if (!categories.length) return `Connect ${name} via Nango OAuth.`;
  const label = categories
    .filter((c) => c !== "popular")
    .slice(0, 2)
    .join(" · ");
  return label
    ? `${name} — ${label}`
    : `Connect ${name} via Nango OAuth.`;
}
