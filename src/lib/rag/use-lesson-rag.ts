'use client';

/* eslint-disable react-hooks/set-state-in-effect */
// This hook intentionally calls setState inside an effect because it manages
// async work (model download, embedding) that has no synchronous source of truth.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ingest,
  retrieve,
  saveLessonIndex,
  loadLessonIndex,
  deleteLessonIndex,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  type LessonIndex,
  type RetrievalResult,
  type IngestProgress,
} from '@/lib/rag';
import type { NotebookSegment } from '@/lib/notebooks';

export interface LessonRagHook {
  index: LessonIndex | null;
  status: IngestProgress | null;
  error: string | null;
  ready: boolean;
  runRetrieval: (query: string) => Promise<RetrievalResult | null>;
}

interface IngestJob {
  lessonId: string;
  cancelled: boolean;
  completed: boolean;
}

export function useLessonRag(
  lessonId: string | null,
  transcript: string,
  segments?: NotebookSegment[],
): LessonRagHook {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [status, setStatus] = useState<IngestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<IngestJob | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!lessonId || !transcript) {
      setIndex(null);
      setStatus(null);
      setError(null);
      return;
    }

    // Skip if we already have a non-cancelled or completed job for this lesson.
    // This allows React strict-mode's mount → cleanup → mount cycle to restart
    // the ingest after the first run gets cancelled, while still preventing
    // genuine duplicate ingests when only transcript/segments references shift.
    const existingJob = jobRef.current;
    if (existingJob && existingJob.lessonId === lessonId) {
      if (existingJob.completed) return;
      if (!existingJob.cancelled) return;
      // cancelled and not completed → fall through to restart
    }

    const myJob: IngestJob = { lessonId, cancelled: false, completed: false };
    jobRef.current = myJob;

    setError(null);
    setStatus(null);
    setIndex(null);

    (async () => {
      try {
        const existing = await loadLessonIndex(lessonId);
        if (myJob.cancelled) return;
        const stale = existing && (
          existing.dim !== EMBEDDING_DIM ||
          existing.model !== EMBEDDING_MODEL ||
          existing.chunks.length === 0
        );
        if (existing && !stale) {
          myJob.completed = true;
          setIndex(existing);
          setStatus({ phase: 'done' });
          return;
        }
        if (stale) {
          await deleteLessonIndex(lessonId);
        }
        const built = await ingest(
          { lessonId, transcript, segments },
          (p) => { if (!myJob.cancelled) setStatus(p); },
        );
        if (myJob.cancelled) return;
        await saveLessonIndex(built);
        if (myJob.cancelled) return;
        myJob.completed = true;
        setIndex(built);
        setStatus({ phase: 'done' });
      } catch (e: unknown) {
        if (myJob.cancelled) return;
        const message = e instanceof Error ? e.message : 'Indexing failed';
        console.error('Lesson RAG indexing failed:', e);
        setError(message);
        setStatus(null);
      }
    })();

    return () => {
      // Only mark as cancelled if the work didn't already finish. A completed
      // job stays cached so subsequent effect re-runs (segments reference
      // changes, etc.) don't trigger a fresh ingest.
      if (!myJob.completed) myJob.cancelled = true;
    };
  }, [lessonId, transcript, segments]);

  const runRetrieval = useCallback(async (query: string) => {
    if (!index) return null;
    return retrieve(query, index);
  }, [index]);

  return { index, status, error, ready: !!index, runRetrieval };
}
