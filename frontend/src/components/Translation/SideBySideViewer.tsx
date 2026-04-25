/**
 * Side-by-Side Viewer Component
 *
 * Displays source and translated text in synchronized dual panes
 * with paragraph-by-paragraph comparison.
 *
 * Implementation notes (post-OMC review):
 * - Uses react-virtuoso for virtualization (supports 65-400K-word documents
 *   without freezing the main thread).
 * - Sync-scroll uses useRef + requestAnimationFrame + passive scroll listeners.
 *   Previous useState-based isScrolling flag triggered effect re-registration
 *   on every scroll tick — fixed by moving the flag to a ref.
 *
 * Implements requirements from GitHub Issue #27.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Box, Paper, Typography, Divider, IconButton, Tooltip } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import SyncDisabledIcon from '@mui/icons-material/SyncDisabled';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';

export interface SideBySideViewerProps {
  sourceText: string;
  translatedText: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export const SideBySideViewer: React.FC<SideBySideViewerProps> = ({
  sourceText,
  translatedText,
  sourceLanguage = 'Source',
  targetLanguage = 'Translation',
}) => {
  const sourceVirtuosoRef = useRef<VirtuosoHandle>(null);
  const translatedVirtuosoRef = useRef<VirtuosoHandle>(null);
  const sourceScrollerRef = useRef<HTMLElement | null>(null);
  const translatedScrollerRef = useRef<HTMLElement | null>(null);

  // isScrolling stored in a ref — synchronously readable, no re-render and
  // no useEffect re-registration on every scroll tick (the previous useState
  // approach rebuilt scroll listeners hundreds of times per second).
  const isScrollingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const scrollResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [syncEnabled, setSyncEnabled] = useState(true);

  // Split text into paragraphs (memoized — splitting 400K-word strings on every
  // render would be wasteful).
  const sourceParagraphs = useMemo(
    () => sourceText.split(/\n\n+/).filter((p) => p.trim()),
    [sourceText]
  );
  const translatedParagraphs = useMemo(
    () => translatedText.split(/\n\n+/).filter((p) => p.trim()),
    [translatedText]
  );

  // Synchronized scrolling. Reads the isScrolling flag from a ref so the
  // effect only re-registers when syncEnabled flips, not on every scroll tick.
  useEffect(() => {
    if (!syncEnabled) return;

    const sourceEl = sourceScrollerRef.current;
    const translatedEl = translatedScrollerRef.current;
    if (!sourceEl || !translatedEl) return;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (isScrollingRef.current) return;
      isScrollingRef.current = true;

      // Throttle scroll work to one frame to avoid layout thrash.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        const sourceMax = source.scrollHeight - source.clientHeight;
        const targetMax = target.scrollHeight - target.clientHeight;
        if (sourceMax > 0 && targetMax > 0) {
          const scrollPercentage = source.scrollTop / sourceMax;
          target.scrollTop = scrollPercentage * targetMax;
        }
        rafIdRef.current = null;
      });

      // Release the lock shortly after, so the OPPOSITE pane's scroll event
      // (caused by us programmatically setting scrollTop above) is ignored.
      if (scrollResetTimeoutRef.current) {
        clearTimeout(scrollResetTimeoutRef.current);
      }
      scrollResetTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 100);
    };

    const onSourceScroll = () => syncScroll(sourceEl, translatedEl);
    const onTranslatedScroll = () => syncScroll(translatedEl, sourceEl);

    // Passive listeners — we never preventDefault, and passive lets the browser
    // skip the "is this handler going to block scrolling?" check on every event.
    sourceEl.addEventListener('scroll', onSourceScroll, { passive: true });
    translatedEl.addEventListener('scroll', onTranslatedScroll, { passive: true });

    return () => {
      sourceEl.removeEventListener('scroll', onSourceScroll);
      translatedEl.removeEventListener('scroll', onTranslatedScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (scrollResetTimeoutRef.current) {
        clearTimeout(scrollResetTimeoutRef.current);
        scrollResetTimeoutRef.current = null;
      }
      isScrollingRef.current = false;
    };
  }, [syncEnabled]);

  const toggleSync = () => {
    setSyncEnabled((prev) => !prev);
  };

  const renderParagraph = (keyPrefix: string) => (index: number, paragraph: string) => (
    <Typography
      key={`${keyPrefix}-${index}`}
      variant="body1"
      sx={{
        whiteSpace: 'pre-wrap',
        lineHeight: 1.8,
        mb: 3,
        px: 3,
      }}
    >
      {paragraph.trim()}
    </Typography>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header with sync toggle */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Typography variant="h6">Side-by-Side Comparison</Typography>
        <Tooltip
          title={syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'}
        >
          <IconButton
            onClick={toggleSync}
            color={syncEnabled ? 'primary' : 'default'}
            aria-label={
              syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'
            }
          >
            {syncEnabled ? <SyncIcon /> : <SyncDisabledIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Dual pane container */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1px 1fr',
          gap: 0,
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Source pane */}
        <Paper
          elevation={1}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              p: 2,
              backgroundColor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {sourceLanguage}
            </Typography>
          </Box>
          <Divider />
          <Box
            data-testid="source-pane"
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              pt: 2,
            }}
          >
            <Virtuoso
              ref={sourceVirtuosoRef}
              data={sourceParagraphs}
              itemContent={renderParagraph('source')}
              scrollerRef={(ref) => {
                sourceScrollerRef.current = ref as HTMLElement | null;
              }}
              style={{ height: '100%' }}
            />
          </Box>
        </Paper>

        {/* Divider */}
        <Divider orientation="vertical" />

        {/* Translation pane */}
        <Paper
          elevation={1}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              p: 2,
              backgroundColor: 'secondary.main',
              color: 'secondary.contrastText',
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {targetLanguage}
            </Typography>
          </Box>
          <Divider />
          <Box
            data-testid="translated-pane"
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              pt: 2,
            }}
          >
            <Virtuoso
              ref={translatedVirtuosoRef}
              data={translatedParagraphs}
              itemContent={renderParagraph('translated')}
              scrollerRef={(ref) => {
                translatedScrollerRef.current = ref as HTMLElement | null;
              }}
              style={{ height: '100%' }}
            />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};
