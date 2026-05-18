import { chunkPlainText, chunkSegments } from './chunker';
import { embedBatch, EMBEDDING_MODEL, EMBEDDING_DIM } from './embedder';
import { buildBM25 } from './bm25';
import type { Chunk, LessonIndex, TranscriptSegment } from './types';

export interface IngestProgress {
  phase: 'chunking' | 'embedding' | 'indexing' | 'done';
  loaded?: number;
  total?: number;
  message?: string;
}

export interface IngestInput {
  lessonId: string;
  segments?: TranscriptSegment[];
  transcript?: string;
}

export async function ingest(
  input: IngestInput,
  onProgress?: (p: IngestProgress) => void,
): Promise<LessonIndex> {
  onProgress?.({ phase: 'chunking' });
  let chunks: Chunk[];
  if (input.segments && input.segments.length > 0) {
    chunks = chunkSegments(input.segments);
  } else if (input.transcript) {
    chunks = chunkPlainText(input.transcript);
  } else {
    throw new Error('ingest requires segments or transcript');
  }

  if (chunks.length === 0) throw new Error('No chunks produced from input');

  // No `loaded` yet → UI shows indeterminate pulse instead of a frozen 0% bar
  onProgress?.({ phase: 'embedding', total: chunks.length });
  const vectors = await embedBatch(
    chunks.map(c => c.text),
    (done, total) => onProgress?.({ phase: 'embedding', loaded: done, total }),
  );

  onProgress?.({ phase: 'indexing' });
  const bm25 = buildBM25(chunks.map(c => c.text));

  const index: LessonIndex = {
    lessonId: input.lessonId,
    model: EMBEDDING_MODEL,
    dim: EMBEDDING_DIM,
    createdAt: Date.now(),
    chunks,
    vectors,
    bm25,
  };
  onProgress?.({ phase: 'done' });
  return index;
}
