/**
 * Legal Pages Tests (issue #223)
 *
 * Verifies that the Terms of Service and Privacy Policy stub pages:
 * - Render their canonical headings
 * - Display the POC disclosure banner
 * - Include a back-link to the registration page
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsOfServicePage from '../TermsOfServicePage';
import PrivacyPolicyPage from '../PrivacyPolicyPage';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('TermsOfServicePage', () => {
  it('renders the canonical "Terms of Service" heading', () => {
    renderWithRouter(<TermsOfServicePage />);

    expect(
      screen.getByRole('heading', { name: /terms of service/i, level: 1 })
    ).toBeInTheDocument();
  });

  it('renders the demo / POC disclosure banner', () => {
    renderWithRouter(<TermsOfServicePage />);

    expect(screen.getByText(/demo \/ poc only/i)).toBeInTheDocument();
    expect(screen.getByText(/placeholder document/i)).toBeInTheDocument();
  });

  it('contains a back-link to the registration page', () => {
    renderWithRouter(<TermsOfServicePage />);

    const backLink = screen.getByRole('link', { name: /back to registration/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/register');
  });
});

describe('PrivacyPolicyPage', () => {
  it('renders the canonical "Privacy Policy" heading', () => {
    renderWithRouter(<PrivacyPolicyPage />);

    expect(screen.getByRole('heading', { name: /privacy policy/i, level: 1 })).toBeInTheDocument();
  });

  it('renders the demo / POC disclosure banner', () => {
    renderWithRouter(<PrivacyPolicyPage />);

    expect(screen.getByText(/demo \/ poc only/i)).toBeInTheDocument();
    expect(screen.getByText(/placeholder document/i)).toBeInTheDocument();
  });

  it('contains a back-link to the registration page', () => {
    renderWithRouter(<PrivacyPolicyPage />);

    const backLink = screen.getByRole('link', { name: /back to registration/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/register');
  });
});
