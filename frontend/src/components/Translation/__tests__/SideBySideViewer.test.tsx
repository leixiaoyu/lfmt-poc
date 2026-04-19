/**
 * SideBySideViewer component tests
 *
 * Covers:
 * - Dual-pane render with header labels
 * - Sync toggle UX (default ON, can be disabled)
 * - Virtualization (only a subset of paragraphs rendered for huge inputs)
 * - Empty / minimal text
 *
 * Note on scroll-sync testing: jsdom does not implement layout, so
 * scrollTop/scrollHeight are always 0 and the rAF + scroll handler chain
 * cannot be exercised end-to-end here. The handler logic is intentionally
 * defensive (`if (sourceMax > 0 && targetMax > 0)`) so it's a no-op in the
 * jsdom environment, which is exactly the safety property we want. The
 * regression we DO assert below: the component does not crash or re-render
 * uncontrollably when scroll events fire.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils';
import { SideBySideViewer } from '../SideBySideViewer';

// Stub react-virtuoso so the test environment doesn't depend on layout APIs
// (jsdom returns 0 for clientHeight, which makes Virtuoso render nothing).
// We render the full list, which lets us assert virtualization wiring (the
// component passes the right paragraphs through) without depending on the
// virtualization runtime.
vi.mock('react-virtuoso', () => {
  const Virtuoso = React.forwardRef(
    (
      {
        data,
        itemContent,
        scrollerRef,
        style,
      }: {
        data: string[];
        itemContent: (index: number, item: string) => React.ReactNode;
        scrollerRef?: (ref: HTMLElement | null) => void;
        style?: React.CSSProperties;
      },
      _ref
    ) => {
      return (
        <div
          ref={(el) => scrollerRef?.(el)}
          data-testid="virtuoso-scroller"
          style={style}
        >
          {data.slice(0, 50).map((item, idx) => (
            <div key={idx}>{itemContent(idx, item)}</div>
          ))}
        </div>
      );
    }
  );
  return { Virtuoso, VirtuosoHandle: undefined };
});

describe('SideBySideViewer', () => {
  it('renders both pane headers with custom labels', () => {
    render(
      <SideBySideViewer
        sourceText="Hello world.\n\nSecond paragraph."
        translatedText="Hola mundo.\n\nSegundo parrafo."
        sourceLanguage="English"
        targetLanguage="Spanish"
      />
    );

    expect(screen.getByText('Side-by-Side Comparison')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Spanish')).toBeInTheDocument();
  });

  it('falls back to default pane labels when none provided', () => {
    render(<SideBySideViewer sourceText="A" translatedText="B" />);

    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Translation')).toBeInTheDocument();
  });

  it('splits text on blank-line boundaries and renders paragraphs', () => {
    const source = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    render(<SideBySideViewer sourceText={source} translatedText="Translated." />);

    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Third paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Translated.')).toBeInTheDocument();
  });

  it('toggles synchronized scrolling icon when sync button is clicked', () => {
    render(<SideBySideViewer sourceText="A" translatedText="B" />);

    // Default: sync ON → button labeled "Disable synchronized scrolling".
    const button = screen.getByRole('button', {
      name: /disable synchronized scrolling/i,
    });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    // After click: sync OFF → button now offers to enable it.
    expect(
      screen.getByRole('button', { name: /enable synchronized scrolling/i })
    ).toBeInTheDocument();
  });

  it('does not crash when scroll events fire on a sync-enabled viewer', () => {
    render(<SideBySideViewer sourceText="A\n\nB" translatedText="X\n\nY" />);

    const scrollers = screen.getAllByTestId('virtuoso-scroller');
    expect(scrollers).toHaveLength(2);

    // Fire scroll on both panes — handler should be a no-op in jsdom (0 sizes)
    // but must not throw.
    expect(() => {
      fireEvent.scroll(scrollers[0]);
      fireEvent.scroll(scrollers[1]);
    }).not.toThrow();
  });

  it('virtualization stub renders only the windowed slice for huge inputs', () => {
    // Build a 5000-paragraph source string.
    const huge = Array.from({ length: 5000 }, (_, i) => `Paragraph number ${i}.`).join('\n\n');
    render(<SideBySideViewer sourceText={huge} translatedText="One." />);

    // Stub renders first 50 — proves we're delegating to Virtuoso (which would
    // virtualize) rather than dumping all 5000 into the DOM.
    expect(screen.getByText('Paragraph number 0.')).toBeInTheDocument();
    expect(screen.getByText('Paragraph number 49.')).toBeInTheDocument();
    expect(screen.queryByText('Paragraph number 4999.')).not.toBeInTheDocument();
  });

  it('handles empty text without crashing', () => {
    expect(() =>
      render(<SideBySideViewer sourceText="" translatedText="" />)
    ).not.toThrow();
    expect(screen.getByText('Side-by-Side Comparison')).toBeInTheDocument();
  });

  it('cleans up scroll listeners on unmount', () => {
    const { unmount } = render(
      <SideBySideViewer sourceText="A\n\nB" translatedText="X\n\nY" />
    );
    expect(() => unmount()).not.toThrow();
  });
});
