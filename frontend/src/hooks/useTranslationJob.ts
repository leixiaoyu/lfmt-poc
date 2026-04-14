/**
 * React Query hook for translation job status
 *
 * Implements adaptive polling with background sync:
 * - Automatic refetching when window regains focus
 * - Adaptive polling intervals (15s → 30s → 60s)
 * - Automatic stop when job reaches terminal state
 */

import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { translationService, TranslationJob } from '../services/translationService';

const TERMINAL_STATES = [
  'COMPLETED',
  'FAILED',
  'CHUNKING_FAILED',
  'TRANSLATION_FAILED',
] as const;

function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.includes(status as (typeof TERMINAL_STATES)[number]);
}

export function useTranslationJob(jobId: string | undefined) {
  const [pollingInterval, setPollingInterval] = useState(15000); // Start at 15 seconds
  const [startTime] = useState(Date.now());

  const query = useQuery({
    queryKey: ['translationJob', jobId],
    queryFn: async () => {
      if (!jobId) throw new Error('No job ID provided');
      return translationService.getJobStatus(jobId);
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      // Stop polling if terminal state reached
      if (job && isTerminalState(job.status)) {
        return false;
      }
      return pollingInterval;
    },
    refetchOnWindowFocus: true,
    staleTime: 0, // Always consider data stale for active polling
  });

  // Adaptive polling: adjust interval based on elapsed time
  useEffect(() => {
    const job = query.data;
    if (job && isTerminalState(job.status)) {
      return; // Stop adjusting if in terminal state
    }

    const interval = setInterval(() => {
      const elapsedTime = Date.now() - startTime;

      // Adaptive intervals: 15s → 30s after 2min → 60s after 5min
      if (elapsedTime > 300000 && pollingInterval < 60000) {
        setPollingInterval(60000); // 60 seconds
      } else if (elapsedTime > 120000 && pollingInterval < 30000) {
        setPollingInterval(30000); // 30 seconds
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [query.data, pollingInterval, startTime]);

  return {
    job: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isTerminal: query.data ? isTerminalState(query.data.status) : false,
  };
}

export function calculateProgress(job: TranslationJob): number {
  if (job.status === 'COMPLETED') return 100;
  if (
    job.status === 'FAILED' ||
    job.status === 'CHUNKING_FAILED' ||
    job.status === 'TRANSLATION_FAILED'
  )
    return 0;
  if (job.status === 'PENDING') return 5;
  if (job.status === 'CHUNKING') return 10;
  if (job.status === 'CHUNKED') return 15;

  // IN_PROGRESS - calculate based on completed chunks
  if (job.totalChunks && job.completedChunks !== undefined) {
    const chunkProgress = (job.completedChunks / job.totalChunks) * 85; // 85% of progress bar
    return 15 + chunkProgress; // Add 15% for pre-translation steps
  }

  return 20; // Default for IN_PROGRESS without chunk info
}
