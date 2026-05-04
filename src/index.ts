import { startServer } from "./server.js";
import { initializeCore } from "./bootstrap.js";

async function bootstrap() {
  initializeCore();
  startServer();
}

bootstrap().catch((err) => {
  console.error("❌ Critical Boot Failure:", err);
  process.exit(1);
});
