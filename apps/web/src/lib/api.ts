/** Backend REST + WS (`apps/api/src/server.ts`). Requires Node 20+. */

export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") return "";
  return (
    process.env.API_PROXY_TARGET?.replace(/\/$/, "") || "http://127.0.0.1:3005"
  );
}

/** UI copy when API calls use relative `/api` (Next rewrite). */
export function describeApiOrigin(): string {
  const base = getApiBase();
  if (base) return base;
  if (typeof window !== "undefined") {
    return `same-origin /api → backend (set API_PROXY_TARGET or NEXT_PUBLIC_API_URL if needed)`;
  }
  return process.env.API_PROXY_TARGET || "http://127.0.0.1:3005";
}

export function getWsBase(): string {
  const ws = addDefaultWsPath(process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, ""));
  if (ws) return ws;
  const http = getApiBase();
  if (http) return addDefaultWsPath(http.replace(/^http/, "ws"));
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const wsProto = isHttps ? "wss" : "ws";
    /** Unified server: Next + Express share PORT → WS on same host. */
    const unified = process.env.NEXT_PUBLIC_UNIFIED_SERVER === "1";
    if (unified) {
      return `${wsProto}://${window.location.host}/ws`;
    }
    /**
     * Split dev: UI on :3000 via Next; Express WebSocket on API port (default 3005).
     * Set NEXT_PUBLIC_API_PORT if your API listens elsewhere.
     */
    const port = process.env.NEXT_PUBLIC_API_PORT || "3005";
    return `${wsProto}://${window.location.hostname}:${port}/ws`;
  }
  return "ws://127.0.0.1:3005/ws";
}

function addDefaultWsPath(base: string | undefined): string {
  if (!base) return "";
  try {
    const url = new URL(base);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/ws";
      return url.toString().replace(/\/$/, "");
    }
    return base;
  } catch {
    return base;
  }
}

/** Dev automation user id (only sent with NEXT_PUBLIC_API_KEY). */
export function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("hustronix_userId");
}

export function setStoredUserId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("hustronix_userId", id);
}

export function clearStoredUserId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("hustronix_userId");
}

export function buildApiHeaders(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  if (key) {
    h["x-api-key"] = key;
    const uid = getStoredUserId();
    if (uid) h["x-user-id"] = uid;
  }
  return h;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: buildApiHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || res.statusText);
  }
  return res.json() as Promise<T>;
}

function parseApiError(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error || body;
  } catch {
    return body;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: buildApiHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "PATCH",
    headers: buildApiHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Clears httpOnly session cookie (works even when the session is already invalid). */
export async function clearAuthSession(): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/auth/logout`, {
      method: "POST",
      headers: buildApiHeaders(),
      credentials: "include",
    });
  } catch {
    /* best-effort — cookie may already be gone */
  }
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "DELETE",
    headers: buildApiHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || res.statusText);
  }
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
