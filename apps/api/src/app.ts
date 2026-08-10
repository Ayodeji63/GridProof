import cors from "cors";
import express from "express";
import helmet from "helmet";
import { corsOptionsFromConfig, getCorsConfig } from "./lib/cors.js";
import { dashboardRouter } from "./modules/dashboard/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { ingestionRouter } from "./modules/ingestion/routes.js";
import { notFoundHandler } from "./middleware/error.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { providersRouter } from "./modules/providers/routes.js";
import { systemRouter } from "./routes/system.js";

export function createApp() {
  const app = express();
  const corsConfig = getCorsConfig();

  app.use(helmet());
  app.use(cors(corsOptionsFromConfig(corsConfig)));
  app.use(
    express.json({
      limit: "256kb",
      verify(req, _res, buffer) {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    })
  );

  app.use("/api/v1", systemRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", notificationsRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/ingest", ingestionRouter);
  app.use("/api/v1/providers", providersRouter);

  app.use((_req, _res, next) => {
    next({ statusCode: 404, code: "NOT_FOUND", message: "Route not found" });
  });
  app.use(notFoundHandler);

  return app;
}
