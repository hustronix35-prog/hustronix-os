import type { NextConfig } from "next";
import path from "path";

const apiPort = process.env.API_PROXY_PORT || "3005";
const apiOrigin =
  process.env.API_PROXY_TARGET?.replace(/\/$/, "") ||
  `http://127.0.0.1:${apiPort}`;

const nextConfig: NextConfig = {
  env: {
    /** Mirrors UNIFIED_SERVER so client WS URL matches single-port runtime (see unified-server.ts). */
    NEXT_PUBLIC_UNIFIED_SERVER:
      process.env.UNIFIED_SERVER === "1" ? "1" : "",
  },
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  /**
   * Same-origin `/api/*` → Express. OAuth starts under `/oauth/*` on Next instead,
   * otherwise `/api/oauth/...` would be proxied and Express would 404 ("Cannot GET").
   */
  async rewrites() {
    if (process.env.UNIFIED_SERVER === "1") return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
