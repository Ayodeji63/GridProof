import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient();
const AlertsFeed = lazy(() => import("./features/alerts/AlertsFeed.js").then((module) => ({ default: module.AlertsFeed })));
const Dashboard = lazy(() => import("./features/dashboard/Dashboard.js").then((module) => ({ default: module.Dashboard })));
const NotificationCenter = lazy(() =>
  import("./features/notifications/NotificationCenter.js").then((module) => ({ default: module.NotificationCenter }))
);
const OperationsHealth = lazy(() =>
  import("./features/operations/OperationsHealth.js").then((module) => ({ default: module.OperationsHealth }))
);
const ProofExplorer = lazy(() =>
  import("./features/proof-explorer/ProofExplorer.js").then((module) => ({ default: module.ProofExplorer }))
);
const ProviderRegistry = lazy(() =>
  import("./features/providers/ProviderRegistry.js").then((module) => ({ default: module.ProviderRegistry }))
);
const ReporterSubmission = lazy(() =>
  import("./features/reporter-submission/ReporterSubmission.js").then((module) => ({ default: module.ReporterSubmission }))
);
const ReviewQueue = lazy(() =>
  import("./features/review-queue/ReviewQueue.js").then((module) => ({ default: module.ReviewQueue }))
);
const AuthSettings = lazy(() =>
  import("./features/settings/AuthSettings.js").then((module) => ({ default: module.AuthSettings }))
);
const ZoneDetail = lazy(() =>
  import("./features/zone-detail/ZoneDetail.js").then((module) => ({ default: module.ZoneDetail }))
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-frame">
        <nav className="nav">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/alerts">Alerts</NavLink>
          <NavLink to="/report">Report</NavLink>
          <NavLink to="/providers">Providers</NavLink>
          <NavLink to="/notifications">Notifications</NavLink>
          <NavLink to="/review">Review</NavLink>
          <NavLink to="/operations">Operations</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <Suspense fallback={<p className="status-message">Loading GridProof screen…</p>}>
          <Routes>
            <Route element={<Dashboard />} path="/" />
            <Route element={<AlertsFeed />} path="/alerts" />
            <Route element={<ReporterSubmission />} path="/report" />
            <Route element={<ProviderRegistry />} path="/providers" />
            <Route element={<NotificationCenter />} path="/notifications" />
            <Route element={<ReviewQueue />} path="/review" />
            <Route element={<OperationsHealth />} path="/operations" />
            <Route element={<AuthSettings />} path="/settings" />
            <Route element={<ZoneDetail />} path="/zones/:zoneId" />
            <Route element={<ProofExplorer />} path="/proof/:zoneId/:epoch" />
          </Routes>
        </Suspense>
      </div>
    </QueryClientProvider>
  );
}
