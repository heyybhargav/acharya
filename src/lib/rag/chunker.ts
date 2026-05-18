import type { Chunk, TranscriptSegment } from './types';

const SENTENCE_BOUNDARY = /[^.!?।॥…]+[.!?।॥…]+\s*|\S[^.!?।॥…]*$/g;

export interface ChunkOptions {
  targetChars: number;
  overlapChars: number;
}

const DEFAULTS: ChunkOptions = { targetChars: 800, overlapChars: 150 };

interface SentenceWithTime {
  text: string;
  startMs?: number;
  endMs?: number;
}

function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_BOUNDARY);
  return matches ? matches.map(s => s.trim()).filter(Boolean) : (text.trim() ? [text.trim()] : []);
}

function sentencesFromSegments(segments: TranscriptSegment[]): SentenceWithTime[] {
  const sentences: SentenceWithTime[] = [];
  let buffer = '';
  let bufferStart: number | undefined;
  let bufferEnd: number | undefined;

  for (const seg of segments) {
    const segStart = seg.startMs;
    const segEnd = seg.startMs + seg.durationMs;
    if (buffer.length === 0) bufferStart = segStart;
    bufferEnd = segEnd;
    buffer += (buffer && !buffer.endsWith(' ') ? ' ' : '') + seg.text;

    const parts = splitSentences(buffer);
    if (parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i++) {
        sentences.push({ text: parts[i], startMs: bufferStart, endMs: bufferEnd });
      }
      buffer = parts[parts.length - 1];
      bufferStart = segStart;
    }
  }

  if (buffer.trim()) sentences.push({ text: buffer.trim(), startMs: bufferStart, endMs: bufferEnd });
  return sentences;
}

function buildOverlap(prev: string, overlapChars: number): string {
  if (overlapChars <= 0 || !prev) return '';
  if (prev.length <= overlapChars) return prev;
  const tail = prev.slice(-overlapChars - 100);
  const sentences = splitSentences(tail);
  let overlap = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = sentences[i] + (overlap ? ' ' + overlap : '');
    if (candidate.length > overlapChars * 1.5) break;
    overlap = candidate;
    if (overlap.length >= overlapChars) break;
  }
  return overlap;
}

export function chunkPlainText(text: string, options: Partial<ChunkOptions> = {}): Chunk[] {
  const opts = { ...DEFAULTS, ...options };
  const sentences = splitSentences(text);
  const chunks: Chunk[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > opts.targetChars && current.length > 0) {
      chunks.push({ index: chunks.length, text: current.trim() });
      const overlap = buildOverlap(current, opts.overlapChars);
      current = overlap ? overlap + ' ' + sentence : sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push({ index: chunks.length, text: current.trim() });
  return chunks;
}

export function chunkSegments(segments: TranscriptSegment[], options: Partial<ChunkOptions> = {}): Chunk[] {
  const opts = { ...DEFAULTS, ...options };
  if (segments.length === 0) return [];

  const sentences = sentencesFromSegments(segments);
  const chunks: Chunk[] = [];
  let currentText = '';
  let currentStart: number | undefined;
  let currentEnd: number | undefined;

  const flush = () => {
    if (!currentText.trim()) return;
    chunks.push({
      index: chunks.length,
      text: currentText.trim(),
      startMs: currentStart,
      endMs: currentEnd,
    });
  };

  for (const sentence of sentences) {
    const next = currentText ? currentText + ' ' + sentence.text : sentence.text;
    if (next.length > opts.targetChars && currentText.length > 0) {
      flush();
      const overlap = buildOverlap(currentText, opts.overlapChars);
      currentText = overlap ? overlap + ' ' + sentence.text : sentence.text;
      currentStart = sentence.startMs;
      currentEnd = sentence.endMs;
    } else {
      if (currentText.length === 0) currentStart = sentence.startMs;
      currentEnd = sentence.endMs ?? currentEnd;
      currentText = next;
    }
  }
  flush();
  return chunks;
}
