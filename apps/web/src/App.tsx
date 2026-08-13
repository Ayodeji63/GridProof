import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  ClipboardCheck,
  FilePlus2,
  FlaskConical,
  Gauge,
  RadioTower,
  Settings,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { GridProofMark } from "./components/GridProofMark.js";

const queryClient = new QueryClient();
const AlertsFeed = lazy(() => import("./features/alerts/AlertsFeed.js").then((module) => ({ default: module.AlertsFeed })));
const Dashboard = lazy(() => import("./features/dashboard/Dashboard.js").then((module) => ({ default: module.Dashboard })));
const DemoLab = lazy(() => import("./features/demo-lab/DemoLab.js").then((module) => ({ default: module.DemoLab })));
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
        <aside className="app-sidebar">
          <Link className="brand" to="/" aria-label="GridProof dashboard">
            <span className="brand-mark"><GridProofMark /></span>
            <span><strong>GridProof</strong><small>Verified grid intelligence</small></span>
          </Link>
          <nav className="nav" aria-label="Primary navigation">
            <NavItem icon={<Gauge />} label="Dashboard" to="/" end />
            <NavItem icon={<FlaskConical />} label="Demo Lab" to="/demo" />
            <NavItem icon={<Activity />} label="Alerts" to="/alerts" />
            <NavItem icon={<FilePlus2 />} label="Report" to="/report" />
            <NavItem icon={<UsersRound />} label="Providers" to="/providers" />
            <NavItem icon={<Bell />} label="Notifications" to="/notifications" />
            <NavItem icon={<ClipboardCheck />} label="Review queue" to="/review" />
            <NavItem icon={<RadioTower />} label="Operations" to="/operations" />
            <NavItem icon={<Settings />} label="Settings" to="/settings" />
          </nav>
          <div className="sidebar-status">
            <ShieldCheck aria-hidden="true" size={18} />
            <span><strong>Proof network</strong><small>BOT Chain connected</small></span>
          </div>
        </aside>
        <div className="app-content">
          <Suspense fallback={<div className="screen-loader" role="status"><span />Loading GridProof screen…</div>}>
            <Routes>
              <Route element={<Dashboard />} path="/" />
              <Route element={<DemoLab />} path="/demo" />
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
      </div>
    </QueryClientProvider>
  );
}

function NavItem({ icon, label, to, end = false }: { icon: ReactNode; label: string; to: string; end?: boolean }) {
  return <NavLink end={end} to={to}>{icon}<span>{label}</span></NavLink>;
}
