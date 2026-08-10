import { Router } from "express";
import {
  authLoginRequestSchema,
  authMeResponseSchema,
  authRegisterRequestSchema,
  authSessionResponseSchema
} from "@gridproof/shared-types";
import { validateBody } from "../../middleware/validate.js";
import { createSessionToken, currentAuth, optionalAuth } from "./middleware.js";
import { findUserForLogin, registerUser } from "./service.js";

export const authRouter = Router();

authRouter.get("/me", optionalAuth, (req, res) => {
  const payload = authMeResponseSchema.parse({ user: currentAuth(req)?.user ?? null });
  res.json(payload);
});

authRouter.post("/register", validateBody(authRegisterRequestSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    const session = createSessionToken(user);
    res.status(201).json(authSessionResponseSchema.parse({ user, ...session }));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", validateBody(authLoginRequestSchema), async (req, res, next) => {
  try {
    const user = await findUserForLogin(req.body.phoneOrEmail);
    if (!user) {
      return next(Object.assign(new Error("User is not registered"), { statusCode: 404, code: "USER_NOT_FOUND" }));
    }

    const session = createSessionToken(user);
    res.json(authSessionResponseSchema.parse({ user, ...session }));
  } catch (error) {
    next(error);
  }
});
