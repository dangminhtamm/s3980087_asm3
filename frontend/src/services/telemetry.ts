import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

import { runtimeEnv } from '../config/runtime';

type PageName =
  | 'home'
  | 'login'
  | 'auth-callback'
  | 'tracking'
  | 'admin-orders'
  | 'admin-order'
  | 'admin-fleet'
  | 'admin-route'
  | 'admin-operations'
  | 'admin-analytics'
  | 'driver'
  | 'other';

export type FrontendTelemetry =
  | {
      type: 'WEB_VITAL';
      name: 'LCP' | 'INP' | 'CLS';
      value: number;
      delta: number;
      rating: 'good' | 'needs-improvement' | 'poor';
      page: PageName;
      deviceType: 'mobile' | 'desktop';
      navigationType: string;
    }
  | {
      type: 'OFFLINE_OUTBOX';
      event: 'queued' | 'flush';
      size: number;
      retryCount: number;
      conflictCount: number;
      completedCount: number;
      durationMs: number;
    }
  | {
      type: 'POD_UPLOAD';
      outcome: 'success' | 'error';
      durationMs: number;
      sizeBytes: number;
    };

const apiBaseUrl = () => runtimeEnv('VITE_API_BASE_URL') || 'http://localhost:3000';

const pageName = (path: string): PageName => {
  if (path === '/') return 'home';
  if (path === '/login') return 'login';
  if (path.includes('auth') && path.includes('callback')) return 'auth-callback';
  if (path.startsWith('/track/')) return 'tracking';
  if (path.startsWith('/driver')) return 'driver';
  if (path.startsWith('/admin/orders/')) return 'admin-order';
  if (path.startsWith('/admin/orders')) return 'admin-orders';
  if (path.startsWith('/admin/fleet')) return 'admin-fleet';
  if (path.startsWith('/admin/routes')) return 'admin-route';
  if (path.startsWith('/admin/exceptions')) return 'admin-operations';
  if (path.startsWith('/admin/analytics')) return 'admin-analytics';
  return 'other';
};

/** Fire-and-forget; telemetry must never delay or break a user workflow. */
export const sendFrontendTelemetry = (telemetry: FrontendTelemetry): void => {
  if (!navigator.onLine) return;
  void fetch(`${apiBaseUrl()}/api/telemetry/frontend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID() },
    body: JSON.stringify(telemetry),
    keepalive: true,
  }).catch(() => undefined);
};

const reportVital = (metric: Metric): void => {
  if (metric.name !== 'LCP' && metric.name !== 'INP' && metric.name !== 'CLS') return;
  sendFrontendTelemetry({
    type: 'WEB_VITAL',
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    page: pageName(window.location.pathname),
    deviceType: window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop',
    navigationType: metric.navigationType,
  });
};

export const startWebVitalsReporting = (): void => {
  onCLS(reportVital);
  onINP(reportVital);
  onLCP(reportVital);
};
