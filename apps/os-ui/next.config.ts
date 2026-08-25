import path from "path";
import type { NextConfig } from "next";

const apiPort = process.env.API_PROXY_PORT || "3005";
const apiOrigin =
  process.env.API_PROXY_TARGET?.replace(/\/$/, "") ||
  `http://127.0.0.1:${apiPort}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  env: {
    NEXT_PUBLIC_UNIFIED_SERVER:
      process.env.UNIFIED_SERVER === "1" ? "1" : "",
  },
  async redirects() {
    return [
      { source: "/tasks", destination: "/execute", permanent: false },
      { source: "/brain/signals", destination: "/signals", permanent: false },
    ];
  },
  async rewrites() {
    if (process.env.UNIFIED_SERVER === "1") return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
