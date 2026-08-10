import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { domainEvents } from "../../lib/events.js";
import { verifyBearerToken } from "../auth/middleware.js";

export function attachRealtime(httpServer: HttpServer, corsOrigin: string | string[]) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin
    }
  });

  const unsubscribeEvidence = domainEvents.on("evidence.received", (event) => {
    io.to(`zone:${event.zoneId}`).emit("evidence.received", event);
    io.emit("zone.status_changed", {
      zoneId: event.zoneId,
      status: event.status,
      observedAt: event.observedAt
    });
  });

  const unsubscribeReview = domainEvents.on("review.required", (event) => {
    io.to("role:reviewer").emit("review.required", event);
  });

  const unsubscribeChain = domainEvents.on("chain.committed", (event) => {
    io.to(`zone:${event.zoneId}`).emit("chain.committed", event);
    io.emit("chain.committed", event);
  });

  io.on("connection", (socket) => {
    const zoneId = socket.handshake.query.zoneId;
    if (typeof zoneId === "string" && zoneId.length > 0) {
      socket.join(`zone:${zoneId}`);
    }

    const token = socket.handshake.auth.token;
    if (typeof token === "string" && token.length > 0) {
      try {
        const auth = verifyBearerToken(token);
        if (auth.user.role === "reviewer" || auth.user.role === "admin") {
          socket.join("role:reviewer");
        }
      } catch {
        // Realtime remains read-only; invalid reviewer auth simply means no reviewer-only room.
      }
    }
  });

  const close = io.close.bind(io);
  io.close = ((callback?: (err?: Error) => void) => {
    unsubscribeEvidence();
    unsubscribeReview();
    unsubscribeChain();
    return close(callback);
  }) as typeof io.close;

  return io;
}
