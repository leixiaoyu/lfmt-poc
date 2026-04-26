/**
 * MockModeBanner — Layer 1 of the three production-safety layers.
 *
 * Per design Decision 5, this banner renders ONLY when
 * `import.meta.env.VITE_MOCK_API === 'true'`. It is intentionally:
 *   - Non-dismissible (no close button — anything dismissible WILL be
 *     dismissed by accident, and the demo team must always see that
 *     mock mode is on).
 *   - z-index 2147483647 (32-bit MAX_SAFE_INTEGER) — survives any
 *     z-index war from MUI Modal / Dialog / Snackbar overlays.
 *   - role="status" + aria-live="polite" — screen readers announce
 *     it on initial mount.
 *   - High-contrast yellow / black — survives a future dark-mode
 *     flag.
 *
 * Layers 2 (Vite build-time guard) and 3 (`closeBundle` SW cleanup)
 * live in `vite.config.ts`. All three layers are independent so a
 * failure in one cannot ship the mock to production.
 */

const BANNER_TEXT = 'MOCK API MODE — DO NOT DEMO TO USERS';

export function MockModeBanner(): JSX.Element | null {
  if (import.meta.env.VITE_MOCK_API !== 'true') {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mock-mode-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        backgroundColor: '#FFD600',
        color: '#000000',
        padding: '8px 16px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 700,
        fontSize: '14px',
        letterSpacing: '0.5px',
        borderBottom: '2px solid #000000',
        // No pointer-events:none — keep it accessible to assistive tech;
        // it does not block the underlying UI because it is `top: 0` and
        // only consumes its own height.
      }}
    >
      {BANNER_TEXT}
    </div>
  );
}

export default MockModeBanner;
