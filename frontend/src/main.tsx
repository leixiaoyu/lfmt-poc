/**
 * Application entry point.
 *
 * Per design Decision 6 (SW startup race fix): when
 * `VITE_MOCK_API=true`, the MSW Service Worker MUST be started BEFORE
 * `App.tsx` is evaluated. Otherwise the apiClient (which is imported
 * transitively by `App.tsx`) module-loads and can fire requests
 * before the SW is ready, and those requests bypass the SW and hit
 * the real network.
 *
 * The dynamic `await import('./App')` AFTER `await worker.start()` is
 * load-bearing: a static `import App from './App'` is hoisted by the
 * bundler and would evaluate `App.tsx` (and transitively `apiClient`)
 * at module-load time, BEFORE the await runs. Dynamic import defers
 * `App.tsx` evaluation until after the SW is ready.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_MOCK_API === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'warn',
    });
  }

  // Dynamic import — deferred until after worker.start() resolves.
  // Do NOT change to a static import; see file header.
  const { default: App } = await import('./App');

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
