import { embedOne, cosineSim, EMBEDDING_DIM } from './embedder';
import { bm25Scores } from './bm25';
import type { LessonIndex, RetrievalResult, Chunk } from './types';

export interface RetrieveOptions {
  topK: number;
  candidatePool: number;
  rrfK: number;
  cosineFloor: number;
  cosineMid: number;
}

const DEFAULTS: RetrieveOptions = {
  topK: 5,
  candidatePool: 20,
  rrfK: 60,
  cosineFloor: 0.20,
  cosineMid: 0.35,
};

function rankByCosine(query: Float32Array, vectors: Float32Array, count: number, pool: number) {
  const scored: { idx: number; score: number }[] = new Array(count);
  for (let i = 0; i < count; i++) {
    scored[i] = { idx: i, score: cosineSim(query, vectors, 0, i * EMBEDDING_DIM) };
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, pool);
}

function rankByBM25(scores: number[], pool: number) {
  const scored = scores.map((score, idx) => ({ idx, score }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, pool);
}

function reciprocalRankFusion(
  rankings: { idx: number; score: number }[][],
  rrfK: number,
): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((entry, rank) => {
      fused.set(entry.idx, (fused.get(entry.idx) || 0) + 1 / (rrfK + rank + 1));
    });
  }
  return fused;
}

export async function retrieve(
  query: string,
  lesson: LessonIndex,
  options: Partial<RetrieveOptions> = {},
): Promise<RetrievalResult> {
  const opts = { ...DEFAULTS, ...options };
  const chunkCount = lesson.chunks.length;
  if (chunkCount === 0) {
    return { chunks: [], topCosine: 0, topRRF: 0, groundingConfidence: 'low' };
  }

  const queryEmbedding = await embedOne(query);
  const cosineRanked = rankByCosine(queryEmbedding, lesson.vectors, chunkCount, opts.candidatePool);
  const bm25Raw = bm25Scores(query, lesson.bm25);
  const bm25Ranked = rankByBM25(bm25Raw, opts.candidatePool);

  const fused = reciprocalRankFusion([cosineRanked, bm25Ranked], opts.rrfK);
  const fusedSorted = Array.from(fused.entries())
    .map(([idx, score]) => ({ idx, score }))
    .sort((a, b) => b.score - a.score);

  const topCosine = cosineRanked[0]?.score ?? 0;
  const topRRF = fusedSorted[0]?.score ?? 0;

  const chosen = fusedSorted
    .slice(0, opts.topK)
    .map(s => lesson.chunks[s.idx])
    .filter((c): c is Chunk => Boolean(c))
    .sort((a, b) => a.index - b.index);

  const groundingConfidence: RetrievalResult['groundingConfidence'] =
    topCosine < opts.cosineFloor ? 'low' :
    topCosine < opts.cosineMid ? 'medium' : 'high';

  return { chunks: chosen, topCosine, topRRF, groundingConfidence };
}
