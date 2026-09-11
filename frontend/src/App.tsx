import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './components/auth/ProtectedRoute';

const DriverPage = lazy(() =>
  import('./pages/DriverPage').then((module) => ({ default: module.DriverPage })),
);
const HomePage = lazy(() =>
  import('./pages/HomePage').then((module) => ({ default: module.HomePage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const AuthCallbackPage = lazy(() =>
  import('./pages/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })),
);
const DriverLayout = lazy(() =>
  import('./components/driver/DriverLayout').then((module) => ({ default: module.DriverLayout })),
);
const DriverHistoryPage = lazy(() =>
  import('./pages/driver/DriverHistoryPage').then((module) => ({
    default: module.DriverHistoryPage,
  })),
);
const DriverProfilePage = lazy(() =>
  import('./pages/driver/DriverProfilePage').then((module) => ({
    default: module.DriverProfilePage,
  })),
);
const AdminLayout = lazy(() =>
  import('./components/admin/AdminLayout').then((module) => ({
    default: module.AdminLayout,
  })),
);
const AnalyticsOverview = lazy(() =>
  import('./pages/admin/AnalyticsOverview').then((module) => ({
    default: module.AnalyticsOverview,
  })),
);
const DispatchPage = lazy(() =>
  import('./pages/admin/DispatchPage').then((module) => ({ default: module.DispatchPage })),
);
const FleetPage = lazy(() =>
  import('./pages/admin/FleetPage').then((module) => ({ default: module.FleetPage })),
);
const OrdersPage = lazy(() =>
  import('./pages/admin/OrdersPage').then((module) => ({ default: module.OrdersPage })),
);
const OrderDetailPage = lazy(() =>
  import('./pages/admin/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })),
);
const FleetDetailPage = lazy(() =>
  import('./pages/admin/FleetDetailPage').then((module) => ({ default: module.FleetDetailPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/admin/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const RoutesPage = lazy(() =>
  import('./pages/admin/RoutesPage').then((module) => ({ default: module.RoutesPage })),
);
const RouteDetailPage = lazy(() =>
  import('./pages/admin/RouteDetailPage').then((module) => ({ default: module.RouteDetailPage })),
);
const ExceptionsPage = lazy(() =>
  import('./pages/admin/ExceptionsPage').then((module) => ({ default: module.ExceptionsPage })),
);
const TrackingPage = lazy(() =>
  import('./pages/TrackingPage').then((module) => ({ default: module.TrackingPage })),
);

export default function App() {
  return (
    <Suspense fallback={<RouteLoadingState />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/track/:trackingToken" element={<TrackingPage />} />
        <Route element={<ProtectedRoute allowedRoles={['DRIVER']} />}>
          <Route path="/driver" element={<DriverLayout />}>
            <Route index element={<DriverPage />} />
            <Route path="history" element={<DriverHistoryPage />} />
            <Route path="profile" element={<DriverProfilePage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AnalyticsOverview />} />
            <Route path="dispatch" element={<DispatchPage />} />
            <Route path="fleet" element={<FleetPage />} />
            <Route path="fleet/:driverId" element={<FleetDetailPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="routes/:routeId" element={<RouteDetailPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

const RouteLoadingState = () => (
  <div className="flex min-h-screen items-center justify-center bg-neutral-50">
    <div className="size-5 animate-spin rounded-full border border-neutral-300 border-t-neutral-950" />
    <span className="sr-only">Loading interface</span>
  </div>
);
