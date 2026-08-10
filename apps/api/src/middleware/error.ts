import type { ErrorRequestHandler } from "express";
import { counters } from "../lib/metrics.js";
import { logger } from "../lib/logger.js";
import { captureApiException } from "../lib/observability.js";

type HttpError = Error & {
  statusCode?: number;
  code?: string;
  issues?: unknown;
};

export const notFoundHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = err as HttpError;
  counters.failures += 1;

  const status = error.statusCode ?? 500;
  if (status >= 500) {
    logger.error({ err: error }, "Unhandled API error");
    captureApiException(error, {
      status,
      code: error.code,
      method: req.method,
      path: req.path
    });
  }

  res.status(status).json({
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: error.message ?? "Unexpected error",
      issues: error.issues ?? undefined
    }
  });
};
