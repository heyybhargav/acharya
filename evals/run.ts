import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkPlainText } from '../src/lib/rag/chunker';
import { embedBatch, EMBEDDING_MODEL, EMBEDDING_DIM } from '../src/lib/rag/embedder';
import { buildBM25 } from '../src/lib/rag/bm25';
import { retrieve } from '../src/lib/rag/retrieve';
import type { LessonIndex } from '../src/lib/rag/types';

interface Query {
  q: string;
  expectAllOf?: string[];
  expectAnyOf?: string[];
}

interface LessonEntry {
  name: string;
  language: string;
  transcript: string;
  queries: Query[];
}

interface GoldenSet {
  lessons: LessonEntry[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dirname, 'golden.json');
const golden: GoldenSet = JSON.parse(readFileSync(goldenPath, 'utf-8'));

function containsAll(text: string, needles: string[]): boolean {
  const haystack = text.toLowerCase();
  return needles.every(n => haystack.includes(n.toLowerCase()));
}

function containsAny(text: string, needles: string[]): boolean {
  const haystack = text.toLowerCase();
  return needles.some(n => haystack.includes(n.toLowerCase()));
}

async function buildIndex(lesson: LessonEntry): Promise<LessonIndex> {
  const chunks = chunkPlainText(lesson.transcript);
  const vectors = await embedBatch(chunks.map(c => c.text));
  const bm25 = buildBM25(chunks.map(c => c.text));
  return {
    lessonId: lesson.name,
    model: EMBEDDING_MODEL,
    dim: EMBEDDING_DIM,
    createdAt: Date.now(),
    chunks,
    vectors,
    bm25,
  };
}

interface QueryResult {
  q: string;
  passed: boolean;
  topCosine: number;
  groundingConfidence: string;
  retrievedSnippet: string;
}

async function runLesson(lesson: LessonEntry): Promise<{ name: string; queries: QueryResult[]; recall: number; chunkCount: number }> {
  const index = await buildIndex(lesson);
  const results: QueryResult[] = [];

  for (const query of lesson.queries) {
    const r = await retrieve(query.q, index);
    const text = r.chunks.map(c => c.text).join(' \n ');
    const allOk = query.expectAllOf ? containsAll(text, query.expectAllOf) : true;
    const anyOk = query.expectAnyOf ? containsAny(text, query.expectAnyOf) : true;
    const passed = allOk && anyOk;
    results.push({
      q: query.q,
      passed,
      topCosine: r.topCosine,
      groundingConfidence: r.groundingConfidence,
      retrievedSnippet: text.slice(0, 200),
    });
  }
  const passes = results.filter(r => r.passed).length;
  return { name: lesson.name, queries: results, recall: passes / results.length, chunkCount: index.chunks.length };
}

async function main(): Promise<void> {
  console.log(`Eval: ${golden.lessons.length} lessons, model ${EMBEDDING_MODEL}\n`);
  const allResults = [];
  let totalQueries = 0;
  let totalPassed = 0;
  for (const lesson of golden.lessons) {
    const result = await runLesson(lesson);
    allResults.push(result);
    totalQueries += result.queries.length;
    totalPassed += result.queries.filter(q => q.passed).length;
    console.log(`\n[${result.name}] chunks=${result.chunkCount} recall=${(result.recall * 100).toFixed(0)}%`);
    for (const q of result.queries) {
      const tag = q.passed ? 'PASS' : 'FAIL';
      console.log(`  ${tag} cos=${q.topCosine.toFixed(3)} (${q.groundingConfidence}) q="${q.q}"`);
      if (!q.passed) console.log(`        retrieved: ${q.retrievedSnippet}`);
    }
  }
  const overall = totalPassed / totalQueries;
  console.log(`\nOverall recall@k: ${(overall * 100).toFixed(1)}% (${totalPassed}/${totalQueries})`);
  if (overall < 0.8) {
    console.log('Recall below 80% threshold');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
