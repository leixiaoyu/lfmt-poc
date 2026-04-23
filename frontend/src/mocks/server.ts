/**
 * MSW Node Setup — `msw/node` server for Vitest.
 *
 * Imports the same `handlers` array as `browser.ts` so the contract
 * cannot drift between the unit-test layer and the browser-SW layer.
 * Vitest `setupTests.ts` is responsible for the lifecycle:
 *   - `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`
 *   - `afterEach(() => { server.resetHandlers(); resetState(); })`
 *   - `afterAll(() => server.close())`
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
