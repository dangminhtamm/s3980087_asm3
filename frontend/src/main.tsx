import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';

import App from './App';
import { CloudFleetAuthProvider } from './auth/CloudFleetAuth';
import { ToastProvider } from './components/ui';
import './index.css';
import { flushOfflineOutbox } from './features/offline-sync';
import { startWebVitalsReporting } from './services/telemetry';

startWebVitalsReporting();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
    if (navigator.onLine) void flushOfflineOutbox();
  });
  window.addEventListener('online', () => void flushOfflineOutbox());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CloudFleetAuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </CloudFleetAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
