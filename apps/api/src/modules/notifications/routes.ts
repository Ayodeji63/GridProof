import { Router } from "express";
import { notificationsResponseSchema } from "@gridproof/shared-types";
import { requireAuth } from "../auth/middleware.js";
import { listNotifications } from "./service.js";

export const notificationsRouter = Router();

notificationsRouter.get("/admin/notifications", requireAuth("reviewer"), async (_req, res, next) => {
  try {
    res.json(notificationsResponseSchema.parse({ notifications: await listNotifications() }));
  } catch (error) {
    next(error);
  }
});
