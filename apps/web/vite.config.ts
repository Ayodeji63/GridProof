import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@sentry")) return "vendor-sentry";
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("socket.io") || id.includes("engine.io")) return "vendor-realtime";
          if (id.includes("zod")) return "vendor-zod";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
