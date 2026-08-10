import { Router } from "express";
import {
  providersResponseSchema,
  registerProviderRequestSchema,
  registerProviderResponseSchema
} from "@gridproof/shared-types";
import { validateBody } from "../../middleware/validate.js";
import { currentAuth, requireAuth } from "../auth/middleware.js";
import { listProviders, registerProvider } from "./store.js";
import { providerChainRegistrationFor } from "./chain-registration.js";

export const providersRouter = Router();

providersRouter.get("/", async (_req, res, next) => {
  try {
    res.json(providersResponseSchema.parse({ providers: await listProviders() }));
  } catch (error) {
    next(error);
  }
});

providersRouter.post("/", requireAuth("reporter"), validateBody(registerProviderRequestSchema), async (req, res, next) => {
  try {
    const result = await registerProvider(req.body, currentAuth(req)?.user.id ?? null);
    const chainRegistration = await providerChainRegistrationFor(req.body);
    res.status(result.duplicate ? 200 : 201).json(registerProviderResponseSchema.parse({ ...result, chainRegistration }));
  } catch (error) {
    next(error);
  }
});
