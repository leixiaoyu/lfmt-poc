/**
 * MockModeBanner — unit tests.
 *
 * The banner is Layer 1 of the three production-safety layers
 * (per add-local-mock-api-foundation Decision 5). The contract:
 *
 *   - Renders ONLY when `import.meta.env.VITE_MOCK_API === 'true'`.
 *   - Returns `null` otherwise (no DOM footprint in normal mode).
 *   - When rendered, has `role="status"`, `aria-live="polite"`, and
 *     a `data-testid="mock-mode-banner"` for selector-stability.
 *   - Carries the spec-exact text `MOCK API MODE — DO NOT DEMO TO USERS`.
 *
 * These tests guard the safety contract: a regression that breaks the
 * `'true'` strict-equality check or removes the test-id would let the
 * banner silently disappear in mock mode.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MockModeBanner } from '../MockModeBanner';

describe('MockModeBanner', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('renders the banner with spec text + a11y attributes when VITE_MOCK_API=true', () => {
    vi.stubEnv('VITE_MOCK_API', 'true');
    render(<MockModeBanner />);
    const banner = screen.getByTestId('mock-mode-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner.textContent).toBe('MOCK API MODE — DO NOT DEMO TO USERS');
  });

  it('returns null (no DOM footprint) when VITE_MOCK_API is not set', () => {
    vi.stubEnv('VITE_MOCK_API', '');
    const { container } = render(<MockModeBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('mock-mode-banner')).toBeNull();
  });

  it('returns null when VITE_MOCK_API=false', () => {
    vi.stubEnv('VITE_MOCK_API', 'false');
    const { container } = render(<MockModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses strict equality — common string variants do NOT enable the banner', () => {
    // Non-string-true values must not enable the banner. This guards
    // against regressions that switch to `Boolean(env)` or `env != null`.
    for (const variant of ['TRUE', 'True', '1', ' true ', 'yes', 'on']) {
      vi.stubEnv('VITE_MOCK_API', variant);
      const { container } = render(<MockModeBanner />);
      expect(
        container,
        `variant=${JSON.stringify(variant)} must NOT render the banner`
      ).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it('renders with the maximum z-index so MUI overlays cannot occlude it', () => {
    vi.stubEnv('VITE_MOCK_API', 'true');
    render(<MockModeBanner />);
    const banner = screen.getByTestId('mock-mode-banner');
    // 2147483647 is the 32-bit MAX_SAFE_INTEGER per design Decision 5.
    expect(banner).toHaveStyle({ zIndex: '2147483647' });
  });
});
