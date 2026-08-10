import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { getCorsConfig } from "./lib/cors.js";
import { logger } from "./lib/logger.js";
import { initApiObservability } from "./lib/observability.js";
import { attachNotifications } from "./modules/notifications/service.js";
import { startScheduler } from "./modules/pipeline/scheduler.js";
import { attachRealtime } from "./modules/realtime/socket.js";

initApiObservability();

const app = createApp();
const server = createServer(app);
const port = Number(process.env.PORT ?? 4000);
const corsConfig = getCorsConfig();

attachRealtime(server, corsConfig.origins);
attachNotifications();

// Drives the core loop between requests: detects heartbeat gaps that no inbound
// evidence would reveal, and moves approved epochs on to the chain.
const scheduler = startScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    scheduler.stopAll();
    server.close(() => {
      logger.info({ signal }, "GridProof API stopped");
      process.exit(0);
    });
  });
}

server.listen(port, () => {
  logger.info(
    { port, chainSweepsEnabled: scheduler.chainSweepsEnabled },
    "GridProof API listening"
  );
});
