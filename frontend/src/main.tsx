import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';

import App from './App';
import { CloudFleetAuthProvider } from './auth/CloudFleetAuth';
import { ToastProvider } from './components/ui';
import './index.css';
import { flushOfflineOutbox } from './features/offline-sync';
import { startWebVitalsReporting } from './services/telemetry';

startWebVitalsReporting();

const usesS3LearnerLabRouting = window.location.pathname.endsWith('/index.html');
const oauthParameters = new URLSearchParams(window.location.search);
const isOauthCallback = oauthParameters.has('code') || oauthParameters.has('error');
if (usesS3LearnerLabRouting && isOauthCallback && !window.location.hash) {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#/auth/callback`,
  );
}
const Router = usesS3LearnerLabRouting ? HashRouter : BrowserRouter;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
    if (navigator.onLine) void flushOfflineOutbox();
  });
  window.addEventListener('online', () => void flushOfflineOutbox());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <CloudFleetAuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </CloudFleetAuthProvider>
    </Router>
  </StrictMode>,
);
