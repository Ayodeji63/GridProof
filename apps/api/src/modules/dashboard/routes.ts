import { Router } from "express";
import {
  alertsResponseSchema,
  proofResponseSchema,
  reviewDecisionRequestSchema,
  reviewQueueResponseSchema,
  zoneHistoryResponseSchema,
  zonesResponseSchema
} from "@gridproof/shared-types";
import { validateBody } from "../../middleware/validate.js";
import { currentAuth, requireAuth } from "../auth/middleware.js";
import { getProof, getZoneHistory, listZones } from "./repository.js";
import { indexPendingConfirmations, submitPendingCommitments } from "../blockchain/service.js";
import { listAlertItems, listReviewItems, resolveReviewDecision } from "../pipeline/service.js";

export const dashboardRouter = Router();

dashboardRouter.get("/zones", async (_req, res, next) => {
  try {
    res.json(zonesResponseSchema.parse({ zones: await listZones() }));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/zones/:id/history", async (req, res, next) => {
  try {
    res.json(zoneHistoryResponseSchema.parse(await getZoneHistory(requireParam(req.params.id, "id"))));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/alerts", async (_req, res, next) => {
  try {
    res.json(alertsResponseSchema.parse({ alerts: await listAlertItems() }));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/chain/proof/:zoneId/:epoch", async (req, res, next) => {
  try {
    res.json(
      proofResponseSchema.parse(
        await getProof(requireParam(req.params.zoneId, "zoneId"), requireParam(req.params.epoch, "epoch"))
      )
    );
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/admin/review-queue", requireAuth("reviewer"), async (_req, res, next) => {
  try {
    const items = await listReviewItems();
    res.json(
      reviewQueueResponseSchema.parse({
        items
      })
    );
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post(
  "/admin/review/:id/decision",
  requireAuth("reviewer"),
  validateBody(reviewDecisionRequestSchema),
  async (req, res, next) => {
    try {
      const reviewId = requireParam(req.params.id, "id");
      const result = await resolveReviewDecision(reviewId, req.body.decision, req.body.note, currentAuth(req)?.user);
      res.json({
        accepted: true,
        reviewId,
        decision: result.decision,
        epochScore: result.epochScore,
        commitment: result.commitment
      });
    } catch (error) {
      next(error);
    }
  }
);

dashboardRouter.post("/chain/submit-pending", requireAuth("admin"), async (_req, res, next) => {
  try {
    res.json(await submitPendingCommitments());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post("/chain/index-confirmations", requireAuth("admin"), async (_req, res, next) => {
  try {
    res.json(await indexPendingConfirmations());
  } catch (error) {
    next(error);
  }
});

function requireParam(value: string | undefined, name: string): string {
  if (!value) {
    throw Object.assign(new Error(`Missing route parameter ${name}`), {
      statusCode: 400,
      code: "MISSING_ROUTE_PARAM"
    });
  }

  return value;
}
