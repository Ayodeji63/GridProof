import { Router } from "express";
import { healthResponseSchema, metricsResponseSchema } from "@gridproof/shared-types";
import { metricsSnapshot } from "../lib/metrics.js";
import { readinessSnapshot } from "./readiness.js";

export const systemRouter = Router();

systemRouter.get("/health", (_req, res) => {
  res.json(
    healthResponseSchema.parse({
      ok: true,
      service: "gridproof-api",
      version: process.env.API_VERSION ?? "0.1.0",
      timestamp: new Date().toISOString()
    })
  );
});

systemRouter.get("/metrics", (_req, res) => {
  res.json(metricsResponseSchema.parse(metricsSnapshot()));
});

systemRouter.get("/readiness", (_req, res) => {
  const readiness = readinessSnapshot();
  res.status(readiness.ok ? 200 : 503).json(readiness);
});
