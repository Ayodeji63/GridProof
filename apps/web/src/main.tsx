import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { captureWebException, initWebObservability, ObservabilityErrorBoundary } from "./lib/observability.js";
import "./styles.css";

initWebObservability();

window.addEventListener("error", (event) => {
  captureWebException(event.error ?? event.message, {
    source: "window.error",
    filename: event.filename,
    lineno: event.lineno
  });
});

window.addEventListener("unhandledrejection", (event) => {
  captureWebException(event.reason, {
    source: "window.unhandledrejection"
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ObservabilityErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ObservabilityErrorBoundary>
  </React.StrictMode>
);
