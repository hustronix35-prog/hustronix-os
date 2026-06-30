/**
 * GitHub-specific REST surface.
 *
 *   GET    /api/integrations/github/repos          → repos the user can administer
 *   GET    /api/integrations/github/monitored      → repos we're currently webhooking
 *   POST   /api/integrations/github/repos/select   → register webhooks on the chosen repos (and unregister anything not in the list)
 *   POST   /api/integrations/github/repos/add      → add a single repo
 *   DELETE /api/integrations/github/repos/:owner/:name → stop monitoring one repo
 *
 * All endpoints require an authenticated user with a live GitHub OAuth
 * connection. Returns 409 with a clear hint when the connection is missing so
 * the UI can prompt for re-connection.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  getGithubConnection,
  listAdminRepos,
  listMonitoredRepos,
  registerRepoWebhook,
  unregisterRepoWebhook,
} from "./githubConnector.js";

function userIdOrNull(req: Request): string | null {
  const u = (req as any).userId as string | undefined;
  if (!u || u === "system") return null;
  return u;
}

async function withConnection(
  req: Request,
  res: Response,
): Promise<{ userId: string; connection: NonNullable<Awaited<ReturnType<typeof getGithubConnection>>> } | null> {
  const userId = userIdOrNull(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  const connection = await getGithubConnection(userId);
  if (!connection) {
    res.status(409).json({
      error: "GitHub is not connected.",
      hint: "Connect GitHub from Settings → Connections, then retry.",
    });
    return null;
  }
  return { userId, connection };
}

export function mountGithubRoutes(
  app: Express,
  opts?: { auth?: (req: Request, res: Response, next: NextFunction) => void },
): void {
  const guard = opts?.auth ?? authMiddleware;
  app.get("/api/integrations/github/repos", guard, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    try {
      const repos = await listAdminRepos(ctx.connection.accessToken);
      res.json({ repos });
    } catch (err) {
      console.error("[github] listAdminRepos failed:", err);
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get("/api/integrations/github/monitored", guard, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    res.json({ repos: listMonitoredRepos(ctx.connection.id) });
  });

  /**
   * Select endpoint accepts an authoritative list. Compares against current
   * subscriptions and reconciles (creates new webhooks, deletes ones the user
   * unchecked). This is the call the Settings → GitHub picker fires.
   */
  app.post("/api/integrations/github/repos/select", guard, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { repos?: unknown };
    if (!Array.isArray(body.repos)) {
      return res.status(400).json({ error: "Body must include `repos: string[]`." });
    }
    const requested = (body.repos as unknown[])
      .map((s) => String(s || "").trim())
      .filter((s) => s.length && s.includes("/"));
    const current = new Set(
      listMonitoredRepos(ctx.connection.id).map((r) => r.repoFullName),
    );
    const wanted = new Set(requested);

    const toAdd = [...wanted].filter((r) => !current.has(r));
    const toRemove = [...current].filter((r) => !wanted.has(r));

    const failures: { repo: string; error: string }[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    for (const repo of toAdd) {
      try {
        await registerRepoWebhook(ctx.connection, repo);
        added.push(repo);
      } catch (err) {
        failures.push({ repo, error: (err as Error).message });
      }
    }
    for (const repo of toRemove) {
      try {
        await unregisterRepoWebhook(ctx.connection, repo);
        removed.push(repo);
      } catch (err) {
        failures.push({ repo, error: (err as Error).message });
      }
    }

    res.json({
      ok: failures.length === 0,
      added,
      removed,
      monitored: listMonitoredRepos(ctx.connection.id),
      failures,
    });
  });

  app.post("/api/integrations/github/repos/add", guard, async (req, res) => {
    const ctx = await withConnection(req, res);
    if (!ctx) return;
    const repo = String((req.body as { repo?: unknown })?.repo || "").trim();
    if (!repo.includes("/")) {
      return res.status(400).json({ error: "`repo` must be in `owner/name` form." });
    }
    try {
      const monitored = await registerRepoWebhook(ctx.connection, repo);
      res.json({ ok: true, monitored });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.delete(
    "/api/integrations/github/repos/:owner/:name",
    guard,
    async (req, res) => {
      const ctx = await withConnection(req, res);
      if (!ctx) return;
      const repo = `${req.params.owner}/${req.params.name}`;
      try {
        await unregisterRepoWebhook(ctx.connection, repo);
        res.json({ ok: true });
      } catch (err) {
        res.status(502).json({ error: (err as Error).message });
      }
    },
  );
}
