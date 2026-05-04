/**
 * Single process: Express API + WebSocket + Next.js UI on one PORT (default 3000).
 * Run `npm run dev:unified`. Requires `npm install` in repo root and in hustronix-ui.
 */
import { createServer } from "http";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node:url";

import { app, attachWebSocketServer } from "./server.js";
import { initializeCore, logHttpListening } from "./bootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiDir = path.join(repoRoot, "hustronix-ui");
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
    void handle(req, res, parse(req.url ?? "/", true));
  });

  const srv = createServer(app);
  attachWebSocketServer(srv);

  srv.listen(port, hostname, () => {
    logHttpListening(port, "Hustronix unified (API + WS + Next)");
    if (hostname === "0.0.0.0") {
      console.log(`   Next UI + /api on PORT=${port} (set APP_ORIGIN to public URL for OAuth)`);
    }
  });
}

main().catch((err) => {
  console.error("❌ Unified server failed:", err);
  process.exit(1);
});
