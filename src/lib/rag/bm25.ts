import type { BM25Index } from './types';

const K1 = 1.5;
const B = 0.75;

const TOKEN_REGEX = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_REGEX);
  return matches ? matches : [];
}

export function buildBM25(docs: string[]): BM25Index {
  const docTokens = docs.map(tokenize);
  const docLens = docTokens.map(t => t.length);
  const totalLen = docLens.reduce((a, b) => a + b, 0);
  const avgDocLen = docLens.length ? totalLen / docLens.length : 0;
  const df: Record<string, number> = {};
  for (const tokens of docTokens) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df[t] = (df[t] || 0) + 1;
    }
  }
  return { docTokens, docLens, avgDocLen, df, totalDocs: docs.length };
}

function tf(tokens: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tokens) out[t] = (out[t] || 0) + 1;
  return out;
}

export function bm25Scores(query: string, idx: BM25Index): number[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return new Array(idx.totalDocs).fill(0);

  const scores: number[] = new Array(idx.totalDocs).fill(0);
  for (let docIdx = 0; docIdx < idx.totalDocs; docIdx++) {
    const tfMap = tf(idx.docTokens[docIdx]);
    const dl = idx.docLens[docIdx] || 1;
    let score = 0;
    for (const q of qTokens) {
      const f = tfMap[q];
      if (!f) continue;
      const n = idx.df[q] || 0;
      const idf = Math.log(1 + (idx.totalDocs - n + 0.5) / (n + 0.5));
      const denom = f + K1 * (1 - B + B * dl / (idx.avgDocLen || 1));
      score += idf * (f * (K1 + 1)) / denom;
    }
    scores[docIdx] = score;
  }
  return scores;
}
