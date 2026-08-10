import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["req.headers.authorization", "*.privateKey", "*.RELAYER_PRIVATE_KEY", "*.signature"],
    remove: true
  }
});
