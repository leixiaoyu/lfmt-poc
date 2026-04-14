/**
 * Side-by-Side Viewer Component
 *
 * Displays source and translated text in synchronized dual panes
 * with paragraph-by-paragraph comparison.
 * Implements requirements from GitHub Issue #27
 */

import React, { useRef, useEffect, useState } from 'react';
import { Box, Paper, Typography, Divider, IconButton, Tooltip } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import SyncDisabledIcon from '@mui/icons-material/SyncDisabled';

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
  const sourceRef = useRef<HTMLDivElement>(null);
  const translatedRef = useRef<HTMLDivElement>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);

  // Split text into paragraphs
  const sourceParagraphs = sourceText.split(/\n\n+/).filter((p) => p.trim());
  const translatedParagraphs = translatedText.split(/\n\n+/).filter((p) => p.trim());

  // Synchronized scrolling
  useEffect(() => {
    if (!syncEnabled || !sourceRef.current || !translatedRef.current) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
      if (isScrolling) return;

      setIsScrolling(true);
      const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
      target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        setIsScrolling(false);
      }, 100);
    };

    const sourceScrollHandler = () => {
      if (sourceRef.current && translatedRef.current) {
        handleScroll(sourceRef.current, translatedRef.current);
      }
    };

    const translatedScrollHandler = () => {
      if (translatedRef.current && sourceRef.current) {
        handleScroll(translatedRef.current, sourceRef.current);
      }
    };

    const sourceElement = sourceRef.current;
    const translatedElement = translatedRef.current;

    sourceElement.addEventListener('scroll', sourceScrollHandler);
    translatedElement.addEventListener('scroll', translatedScrollHandler);

    return () => {
      sourceElement.removeEventListener('scroll', sourceScrollHandler);
      translatedElement.removeEventListener('scroll', translatedScrollHandler);
      clearTimeout(scrollTimeout);
    };
  }, [syncEnabled, isScrolling]);

  const toggleSync = () => {
    setSyncEnabled((prev) => !prev);
  };

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
        <Tooltip title={syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'}>
          <IconButton onClick={toggleSync} color={syncEnabled ? 'primary' : 'default'}>
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
            ref={sourceRef}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 3,
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(0,0,0,0.05)',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: '4px',
              },
            }}
          >
            {sourceParagraphs.map((paragraph, index) => (
              <Typography
                key={`source-${index}`}
                variant="body1"
                paragraph
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                  mb: 3,
                }}
              >
                {paragraph.trim()}
              </Typography>
            ))}
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
            ref={translatedRef}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 3,
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(0,0,0,0.05)',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: '4px',
              },
            }}
          >
            {translatedParagraphs.map((paragraph, index) => (
              <Typography
                key={`translated-${index}`}
                variant="body1"
                paragraph
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                  mb: 3,
                }}
              >
                {paragraph.trim()}
              </Typography>
            ))}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};
