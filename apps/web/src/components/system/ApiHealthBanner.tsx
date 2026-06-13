"use client";

import { useEffect, useState } from "react";
import { describeApiOrigin, getApiBase } from "@/lib/api";

export function ApiHealthBanner() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/health`, {
          method: "GET",
          cache: "no-store",
        });
        if (!cancelled) setOk(res.ok);
      } catch {
        if (!cancelled) setOk(false);
      }
    };
    void ping();
    const id = setInterval(ping, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (ok !== false) return null;

  return (
    <div
      role="status"
      className="shrink-0 border-b border-hx-danger/40 bg-hx-danger/15 px-4 py-2 text-center text-xs font-medium text-hx-danger"
    >
      Cannot reach API ({describeApiOrigin()}
      {getApiBase() ? "" : " , try http://localhost:3000/api/health"}). Start the API (
      <code className="rounded bg-hx-bg px-1">{`npm run dev:api`}</code> in repo root, port 3005 by
      default), or run UI + API together:{" "}
      <code className="rounded bg-hx-bg px-1">{`npm run dev:stack`}</code> from repo root. If the
      API uses another origin/port, set{" "}
      <code className="rounded bg-hx-bg px-1">API_PROXY_TARGET</code> in{" "}
      <code className="rounded bg-hx-bg px-1">apps/web/.env.local</code> or{" "}
      <code className="rounded bg-hx-bg px-1">NEXT_PUBLIC_API_URL</code>.
    </div>
  );
}
