/**
 * MSW Browser Setup — Service Worker for `npm run dev` and Playwright.
 *
 * `worker.start()` MUST be awaited before `App.tsx` is imported (see
 * `main.tsx` async dynamic-import refactor). Otherwise the apiClient
 * module-load can fire requests before the Service Worker is ready,
 * and those requests bypass the SW and hit the real network. This is
 * the "SW startup race" called out in design Decision 6.
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
