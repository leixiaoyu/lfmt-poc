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
 *
 * CSP style-src nonce (#254): the App tree is wrapped in an Emotion
 * `CacheProvider` configured with the deploy-time nonce read from the
 * `<meta name="csp-nonce">` tag in `index.html`. Without this, MUI's
 * runtime CSS-in-JS injections (`document.head.appendChild('<style>')`)
 * ship without a `nonce=` attribute and are blocked by the production
 * CSP `style-src 'self' 'nonce-<value>'` policy. The helper returns
 * `undefined` in dev mode (where the placeholder is not replaced) so
 * Emotion gracefully falls back to no-nonce emission — Vite's dev
 * server does not enforce the production CSP header, so dev-mode
 * styling continues to work.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { getCspNonceFromMeta } from './utils/cspNonce';

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

  // Emotion cache wired to the per-deploy CSP nonce. The `key: 'css'`
  // is Emotion's standard default; the `nonce` option propagates to
  // every <style> tag Emotion injects at runtime. When `nonce` is
  // `undefined` (dev mode, missing meta tag, un-substituted placeholder)
  // Emotion omits the attribute entirely — exactly the desired fallback.
  const emotionCache = createCache({
    key: 'css',
    nonce: getCspNonceFromMeta(),
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <CacheProvider value={emotionCache}>
        <App />
      </CacheProvider>
    </React.StrictMode>
  );
}

void bootstrap();
