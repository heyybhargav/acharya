export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface Chunk {
  index: number;
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface BM25Index {
  docLens: number[];
  avgDocLen: number;
  df: Record<string, number>;
  docTokens: string[][];
  totalDocs: number;
}

export interface LessonIndex {
  lessonId: string;
  model: string;
  dim: number;
  createdAt: number;
  chunks: Chunk[];
  vectors: Float32Array;
  bm25: BM25Index;
}

export interface RetrievalResult {
  chunks: Chunk[];
  topCosine: number;
  topRRF: number;
  groundingConfidence: 'high' | 'medium' | 'low';
}
