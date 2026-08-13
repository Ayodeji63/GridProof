import { Router } from "express";
import {
  demoSimulationRequestSchema,
  demoSimulationResponseSchema,
  demoWalletChallengeRequestSchema,
  demoWalletChallengeResponseSchema
} from "@gridproof/shared-types";
import { rateLimit } from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validate.js";
import { createDemoWalletChallenge, getDemoSimulation, runDemoSimulation } from "./service.js";

export const demoRouter = Router();

demoRouter.use("/demo", (_req, _res, next) => {
  if (process.env.NODE_ENV === "production" && process.env.GRIDPROOF_DEMO_ENABLED !== "true") {
    return next({
      statusCode: 404,
      code: "DEMO_DISABLED",
      message: "Judge Demo Lab is not enabled on this deployment"
    });
  }
  return next();
});

demoRouter.post(
  "/demo/wallet-challenge",
  rateLimit({ name: "demo-wallet-challenge", key: (req) => String(req.body?.walletAddress ?? req.ip), max: 20 }),
  validateBody(demoWalletChallengeRequestSchema),
  (req, res) => {
    res.json(demoWalletChallengeResponseSchema.parse(createDemoWalletChallenge(req.body.walletAddress)));
  }
);

demoRouter.post(
  "/demo/simulations",
  rateLimit({ name: "demo-simulation", key: (req) => String(req.body?.walletAddress ?? req.ip), max: 10 }),
  validateBody(demoSimulationRequestSchema),
  async (req, res, next) => {
    try {
      res.status(202).json(demoSimulationResponseSchema.parse({ simulation: await runDemoSimulation(req.body) }));
    } catch (error) {
      next(error);
    }
  }
);

demoRouter.get("/demo/simulations/:id", async (req, res, next) => {
  try {
    res.json(demoSimulationResponseSchema.parse({ simulation: await getDemoSimulation(String(req.params.id)) }));
  } catch (error) {
    next(error);
  }
});
