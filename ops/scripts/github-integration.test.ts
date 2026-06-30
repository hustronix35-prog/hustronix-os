/**
 * GitHub connector + routes integration tests.
 *
 * Run: npm run test:github (from apps/api)
 *
 * Covers:
 *   - githubConnector: listMonitoredRepos, register/unregister (mocked GitHub API)
 *   - githubRoutes: auth, 409 without connection, monitored/repos/select/add/delete
 */

process.env.OAUTH_TOKEN_ENCRYPTION_KEY =
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GITHUB_WEBHOOK_SECRET =
  process.env.GITHUB_WEBHOOK_SECRET || "test-github-webhook-secret-32chars-min";
process.env.MISSION_CONTROL_API_KEY =
  process.env.MISSION_CONTROL_API_KEY || "test-github-integration-api-key-local";
process.env.ALLOW_LOOPBACK_AUTH = "1";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../apps/api/src/database.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { encryptToken } from "../../apps/api/src/auth/oauthCrypto.js";
import { config } from "../../apps/api/src/config.js";
import {
  listMonitoredRepos,
  registerRepoWebhook,
  unregisterRepoWebhook,
  fetchGithubUser,
  listAdminRepos,
} from "../../apps/api/src/integrations/githubConnector.js";
import { mountGithubRoutes } from "../../apps/api/src/integrations/githubRoutes.js";
import type { LiveConnection } from "../../apps/api/src/auth/oauthConnections.js";

const TEST_RUN = uuidv4().slice(0, 8);

function ensureTestUser(suffix: string): string {
  const userId = `gh_${TEST_RUN}_${suffix}`;
  if (!db.getUserById(userId)) {
    try {
      db.createUser(userId, userId, hashPassword(`pw-${userId}`), `${userId}@test.local`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
      if (!db.getUserById(userId) && !db.getUser(userId)) throw err;
    }
  }
  assert.ok(db.getUserById(userId), `test user ${userId} must exist`);
  return userId;
}

function seedGithubConnection(userId: string): { connectionId: string; accessToken: string } {
  const accessToken = `gho_test_${uuidv4().replace(/-/g, "")}`;
  const connectionId = db.upsertOAuthConnection({
    userId,
    provider: "github",
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: "octocat-test",
    connectionLabel: "GitHub (test)",
    accessTokenEncrypted: encryptToken(accessToken),
    refreshTokenEncrypted: encryptToken(""),
    expiresAt: null,
    scope: "repo,read:user",
    tokenType: "bearer",
    rawInstallPayload: "{}",
  });
  return { connectionId, accessToken };
}

function liveConnectionFrom(userId: string, connectionId: string, accessToken: string): LiveConnection {
  return {
    id: connectionId,
    userId,
    provider: "github",
    externalTeamId: "",
    externalTeamName: null,
    externalUserId: "octocat-test",
    accessToken,
    refreshToken: null,
    expiresAt: null,
    scope: "repo",
    tokenType: "bearer",
  };
}

type FetchCall = { url: string; init?: RequestInit };

function withMockedFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; calls: FetchCall[] }> {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return fn()
    .then((result) => ({ result, calls }))
    .finally(() => {
      globalThis.fetch = original;
    });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const userId = String(req.headers["x-user-id"] || "").trim();
  if (!userId || userId === "system") {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!db.getUserById(userId)) {
    res.status(401).json({ error: "Unknown user for test header." });
    return;
  }
  (req as express.Request & { userId?: string }).userId = userId;
  next();
}

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  mountGithubRoutes(app, { auth: testAuthMiddleware });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function authHeaders(userId: string): Record<string, string> {
  return {
    "x-user-id": userId,
    "content-type": "application/json",
  };
}

/** Mock only GitHub API traffic; pass through local test server requests. */
function mockGithubApi(handler: (url: string, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("api.github.com")) {
      return original(input, init);
    }
    return handler(url, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("githubConnector — listMonitoredRepos", () => {
  const userId = ensureTestUser("monitored");
  let connectionId = "";

  before(() => {
    const seeded = seedGithubConnection(userId);
    connectionId = seeded.connectionId;
    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: "acme/widgets",
      externalSubscriptionId: "9001",
      expiresAt: null,
      meta: JSON.stringify({ deliveryUrl: "http://localhost/api/ingest/github/x" }),
    });
  });

  it("returns repo_webhook subscriptions for the connection", () => {
    const repos = listMonitoredRepos(connectionId);
    assert.equal(repos.length, 1);
    assert.equal(repos[0].repoFullName, "acme/widgets");
    assert.equal(repos[0].hookId, 9001);
  });
});

describe("githubConnector — registerRepoWebhook (mocked GitHub API)", () => {
  const userId = ensureTestUser("register");
  let connectionId = "";
  let accessToken = "";

  before(() => {
    const seeded = seedGithubConnection(userId);
    connectionId = seeded.connectionId;
    accessToken = seeded.accessToken;
  });

  it("creates a hook when none exists and records subscription", async () => {
    const repo = `acme/reg-${uuidv4().slice(0, 8)}`;
    const conn = liveConnectionFrom(userId, connectionId, accessToken);

    const { result, calls } = await withMockedFetch(async (url, init) => {
      if (url.includes(`/repos/${repo}/hooks`) && init?.method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes(`/repos/${repo}/hooks`) && init?.method === "POST") {
        return jsonResponse({
          id: 4242,
          url: `https://api.github.com/repos/${repo}/hooks/4242`,
          config: { url: `${config.server.appOrigin}/api/ingest/github/${userId}` },
          events: ["push"],
          active: true,
        });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    }, () => registerRepoWebhook(conn, repo));

    assert.equal(result.repoFullName, repo);
    assert.equal(result.hookId, 4242);
    assert.ok(calls.some((c) => c.init?.method === "POST"));
    const monitored = listMonitoredRepos(connectionId);
    assert.ok(monitored.some((r) => r.repoFullName === repo));
  });

  it("adopts an existing hook with matching delivery URL (idempotent)", async () => {
    const repo = `acme/adopt-${uuidv4().slice(0, 8)}`;
    const conn = liveConnectionFrom(userId, connectionId, accessToken);
    const deliveryUrl = `${config.server.appOrigin.replace(/\/$/, "")}/api/ingest/github/${encodeURIComponent(userId)}`;

    const { result, calls } = await withMockedFetch(async (url, init) => {
      if (url.includes(`/repos/${repo}/hooks`) && (!init?.method || init.method === "GET")) {
        return jsonResponse([
          {
            id: 7777,
            config: { url: deliveryUrl },
            events: ["push"],
            active: true,
          },
        ]);
      }
      return jsonResponse({ message: "unexpected" }, 404);
    }, () => registerRepoWebhook(conn, repo));

    assert.equal(result.hookId, 7777);
    assert.ok(!calls.some((c) => c.init?.method === "POST"), "should not POST when hook exists");
  });
});

describe("githubConnector — unregisterRepoWebhook (mocked GitHub API)", () => {
  const userId = ensureTestUser("unregister");
  let connectionId = "";
  let accessToken = "";

  before(() => {
    const seeded = seedGithubConnection(userId);
    connectionId = seeded.connectionId;
    accessToken = seeded.accessToken;
  });

  it("deletes hook on GitHub and removes subscription row", async () => {
    const repo = `acme/unreg-${uuidv4().slice(0, 8)}`;
    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: repo,
      externalSubscriptionId: "5555",
      expiresAt: null,
      meta: "{}",
    });

    const conn = liveConnectionFrom(userId, connectionId, accessToken);
    await withMockedFetch(async (url, init) => {
      if (url.includes(`/repos/${repo}/hooks/5555`) && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: "not found" }, 404);
    }, () => unregisterRepoWebhook(conn, repo));

    assert.equal(listMonitoredRepos(connectionId).filter((r) => r.repoFullName === repo).length, 0);
  });
});

describe("githubConnector — listAdminRepos (mocked GitHub API)", () => {
  it("filters out repos without admin permission", async () => {
    const token = "gho_list_test";
    const { result } = await withMockedFetch(async (url) => {
      if (url.includes("/user/repos")) {
        return jsonResponse([
          {
            full_name: "acme/admin-repo",
            name: "admin-repo",
            owner: { login: "acme" },
            private: false,
            default_branch: "main",
            pushed_at: "2026-01-01T00:00:00Z",
            stargazers_count: 3,
            permissions: { admin: true },
          },
          {
            full_name: "acme/read-only",
            name: "read-only",
            owner: { login: "acme" },
            private: true,
            default_branch: "main",
            pushed_at: null,
            stargazers_count: 0,
            permissions: { admin: false },
          },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    }, () => listAdminRepos(token));

    assert.equal(result.length, 1);
    assert.equal(result[0].fullName, "acme/admin-repo");
    assert.equal(result[0].stars, 3);
  });
});

describe("githubRoutes — HTTP API", () => {
  let baseUrl = "";
  let closeServer: () => Promise<void> = async () => {};

  before(async () => {
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    closeServer = srv.close;
  });

  after(async () => {
    await closeServer();
  });

  it("GET /monitored returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/api/integrations/github/monitored`);
    assert.equal(res.status, 401);
  });

  it("GET /monitored returns 409 when GitHub is not connected", async () => {
    const userId = ensureTestUser("no_github");
    const res = await fetch(`${baseUrl}/api/integrations/github/monitored`, {
      headers: authHeaders(userId),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; hint?: string };
    assert.match(body.error || "", /not connected/i);
    assert.ok(body.hint);
  });

  it("GET /monitored returns subscription list when connected", async () => {
    const userId = ensureTestUser("route_monitored");
    const { connectionId } = seedGithubConnection(userId);
    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: "hustronix/core",
      externalSubscriptionId: "111",
      expiresAt: null,
      meta: "{}",
    });

    const res = await fetch(`${baseUrl}/api/integrations/github/monitored`, {
      headers: authHeaders(userId),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { repos: { repoFullName: string }[] };
    assert.ok(body.repos.some((r) => r.repoFullName === "hustronix/core"));
  });

  it("GET /repos returns admin repos (mocked upstream)", async () => {
    const userId = ensureTestUser("route_repos");
    seedGithubConnection(userId);

    const restoreFetch = mockGithubApi(async (url) => {
      if (url.includes("/user/repos")) {
        return jsonResponse([
          {
            full_name: "hustronix/api",
            name: "api",
            owner: { login: "hustronix" },
            private: true,
            default_branch: "main",
            pushed_at: "2026-06-01T00:00:00Z",
            stargazers_count: 12,
            permissions: { admin: true },
          },
        ]);
      }
      if (url.includes("/user") && !url.includes("/repos")) {
        return jsonResponse({ login: "octocat", id: 1 });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });

    try {
      const res = await fetch(`${baseUrl}/api/integrations/github/repos`, {
        headers: authHeaders(userId),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { repos: { fullName: string }[] };
      assert.equal(body.repos.length, 1);
      assert.equal(body.repos[0].fullName, "hustronix/api");
    } finally {
      restoreFetch();
    }
  });

  it("POST /repos/select validates body shape", async () => {
    const userId = ensureTestUser("route_select_bad");
    seedGithubConnection(userId);
    const res = await fetch(`${baseUrl}/api/integrations/github/repos/select`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ repos: "not-an-array" }),
    });
    assert.equal(res.status, 400);
  });

  it("POST /repos/add requires owner/name form", async () => {
    const userId = ensureTestUser("route_add_bad");
    seedGithubConnection(userId);
    const res = await fetch(`${baseUrl}/api/integrations/github/repos/add`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ repo: "invalid-repo-name" }),
    });
    assert.equal(res.status, 400);
  });

  it("POST /repos/select reconciles monitored set (mocked GitHub)", async () => {
    const userId = ensureTestUser("route_select");
    const { connectionId, accessToken } = seedGithubConnection(userId);
    const keepRepo = `hustronix/keep-${uuidv4().slice(0, 6)}`;
    const addRepo = `hustronix/add-${uuidv4().slice(0, 6)}`;
    const removeRepo = `hustronix/remove-${uuidv4().slice(0, 6)}`;

    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: keepRepo,
      externalSubscriptionId: "10",
      expiresAt: null,
      meta: "{}",
    });
    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: removeRepo,
      externalSubscriptionId: "20",
      expiresAt: null,
      meta: "{}",
    });

    const deliveryUrl = `${config.server.appOrigin.replace(/\/$/, "")}/api/ingest/github/${encodeURIComponent(userId)}`;
    const restoreFetch = mockGithubApi(async (url, init) => {
      if (url.includes("/hooks") && (!init?.method || init.method === "GET")) {
        return jsonResponse([]);
      }
      if (url.includes("/hooks") && init?.method === "POST") {
        const repo = decodeURIComponent(url.split("/repos/")[1]?.split("/hooks")[0] || "");
        return jsonResponse({
          id: repo.includes("add") ? 9009 : 9010,
          config: { url: deliveryUrl },
          events: ["push"],
          active: true,
        });
      }
      if (url.includes("/hooks/20") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: "unexpected", url }, 404);
    });

    try {
      const res = await fetch(`${baseUrl}/api/integrations/github/repos/select`, {
        method: "POST",
        headers: authHeaders(userId),
        body: JSON.stringify({ repos: [keepRepo, addRepo] }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        added: string[];
        removed: string[];
        monitored: { repoFullName: string }[];
      };
      assert.equal(body.ok, true);
      assert.ok(body.added.includes(addRepo));
      assert.ok(body.removed.includes(removeRepo));
      const names = new Set(body.monitored.map((m) => m.repoFullName));
      assert.ok(names.has(keepRepo));
      assert.ok(names.has(addRepo));
      assert.ok(!names.has(removeRepo));
    } finally {
      restoreFetch();
    }
  });

  it("DELETE /repos/:owner/:name unregisters a repo (mocked GitHub)", async () => {
    const userId = ensureTestUser("route_delete");
    const { connectionId } = seedGithubConnection(userId);
    const repo = `hustronix/del-${uuidv4().slice(0, 6)}`;
    db.upsertOAuthSubscription({
      connectionId,
      userId,
      provider: "github",
      kind: "repo_webhook",
      externalResource: repo,
      externalSubscriptionId: "3030",
      expiresAt: null,
      meta: "{}",
    });

    const restoreFetch = mockGithubApi(async (url, init) => {
      if (url.includes("/hooks/3030") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: "unexpected" }, 404);
    });

    try {
      const [owner, name] = repo.split("/");
      const res = await fetch(`${baseUrl}/api/integrations/github/repos/${owner}/${name}`, {
        method: "DELETE",
        headers: authHeaders(userId),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
      assert.equal(listMonitoredRepos(connectionId).filter((r) => r.repoFullName === repo).length, 0);
    } finally {
      restoreFetch();
    }
  });
});

describe("githubConnector — fetchGithubUser (mocked)", () => {
  it("returns login from GET /user", async () => {
    const { result } = await withMockedFetch(async (url) => {
      if (url.endsWith("/user")) return jsonResponse({ login: "test-user", id: 99 });
      return jsonResponse({}, 404);
    }, () => fetchGithubUser("token-abc"));
    assert.equal(result.login, "test-user");
    assert.equal(result.id, 99);
  });
});
