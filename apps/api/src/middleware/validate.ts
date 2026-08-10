import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next({
        statusCode: 400,
        code: "VALIDATION_FAILED",
        message: "Request body failed validation",
        issues: result.error.issues
      });
    }

    req.body = result.data;
    return next();
  };
}
