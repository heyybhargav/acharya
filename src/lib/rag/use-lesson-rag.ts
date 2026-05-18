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

export function useLessonRag(
  lessonId: string | null,
  transcript: string,
  segments?: NotebookSegment[],
): LessonRagHook {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [status, setStatus] = useState<IngestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!lessonId || !transcript) {
      activeIdRef.current = null;
      setIndex(null);
      setStatus(null);
      setError(null);
      return;
    }
    if (activeIdRef.current === lessonId) return;
    activeIdRef.current = lessonId;

    let cancelled = false;
    setError(null);
    setStatus(null);
    setIndex(null);

    (async () => {
      try {
        const existing = await loadLessonIndex(lessonId);
        if (cancelled) return;
        const stale = existing && (
          existing.dim !== EMBEDDING_DIM ||
          existing.model !== EMBEDDING_MODEL ||
          existing.chunks.length === 0
        );
        if (existing && !stale) {
          setIndex(existing);
          setStatus({ phase: 'done' });
          return;
        }
        if (stale) {
          await deleteLessonIndex(lessonId);
        }
        const built = await ingest(
          { lessonId, transcript, segments },
          (p) => { if (!cancelled) setStatus(p); },
        );
        if (cancelled) return;
        await saveLessonIndex(built);
        if (cancelled) return;
        setIndex(built);
        setStatus({ phase: 'done' });
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Indexing failed';
        console.error('Lesson RAG indexing failed:', e);
        setError(message);
        setStatus(null);
      }
    })();

    return () => { cancelled = true; };
  }, [lessonId, transcript, segments]);

  const runRetrieval = useCallback(async (query: string) => {
    if (!index) return null;
    return retrieve(query, index);
  }, [index]);

  return { index, status, error, ready: !!index, runRetrieval };
}
