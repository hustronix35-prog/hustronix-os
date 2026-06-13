/**
 * Single process: Express API + WebSocket + Next.js UI on one PORT (default 3000).
 * Run `npm run dev:unified`. Requires `npm install` from the workspace root.
 */
import { createServer } from "http";
import { createRequire } from "module";
import path from "path";
import { parse } from "node:url";

import { app, attachWebSocketServer, bootIntegrationServices } from "./server.js";
import { initializeCore, logHttpListening } from "./bootstrap.js";
import { config } from "./config.js";

const uiDir = config.paths.webRoot;
const requireUi = createRequire(path.join(uiDir, "package.json"));

async function main() {
  initializeCore();

  const dev = process.env.NODE_ENV !== "production";
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOST ?? "0.0.0.0";

  /** Disable Next `/api` → external rewrite; Express handles `/api` in this process. */
  process.env.UNIFIED_SERVER = "1";

  const next = requireUi("next");
  const nextApp = next({ dev, dir: uiDir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  app.use((req, res) => {
    // API CSP is intentionally strict; Next pages need their generated scripts/styles.
    res.removeHeader("Content-Security-Policy");
    void handle(req, res, parse(req.url ?? "/", true));
  });

  const srv = createServer(app);
  attachWebSocketServer(srv);

  srv.listen(port, hostname, () => {
    logHttpListening(port, "Hustronix unified (API + WS + Next)");
    if (hostname === "0.0.0.0") {
      console.log(`   Next UI + /api on PORT=${port} (set APP_ORIGIN to public URL for OAuth)`);
    }
    bootIntegrationServices();
  });
}

main().catch((err) => {
  console.error("❌ Unified server failed:", err);
  process.exit(1);
});
