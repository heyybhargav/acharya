// Jina v3 embeddings, called via /api/tutor/embed in the browser and directly in Node.
// We never bundle a model into the browser — embeddings are a network call.

export const EMBEDDING_MODEL = 'jina-embeddings-v3';
export const EMBEDDING_DIM = 1024;

export type JinaTask = 'retrieval.passage' | 'retrieval.query';

const JINA_URL = 'https://api.jina.ai/v1/embeddings';

async function callJinaDirect(texts: string[], task: JinaTask): Promise<Float32Array[]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error('JINA_API_KEY is not set');
  const res = await fetch(JINA_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      task,
      input: texts,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Jina embeddings failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => new Float32Array(d.embedding));
}

async function callProxy(texts: string[], task: JinaTask): Promise<Float32Array[]> {
  const payload = JSON.stringify({ texts, task });
  const res = await fetch('/api/tutor/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[rag/embedder] proxy failed', {
      status: res.status,
      response: errText.slice(0, 300),
      textsCount: texts.length,
      payloadBytes: payload.length,
      firstTextPreview: texts[0]?.slice(0, 80),
      task,
    });
    throw new Error(`Embedding proxy failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.vectors as number[][]).map((v) => new Float32Array(v));
}

async function embedBlock(texts: string[], task: JinaTask): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (typeof window === 'undefined') return callJinaDirect(texts, task);
  return callProxy(texts, task);
}

export async function embedOne(text: string, task: JinaTask = 'retrieval.query'): Promise<Float32Array> {
  const [v] = await embedBlock([text], task);
  return v;
}

export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
  batchSize = 8,
): Promise<Float32Array> {
  const out = new Float32Array(texts.length * EMBEDDING_DIM);
  let done = 0;
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const vectors = await embedBlock(slice, 'retrieval.passage');
    for (let j = 0; j < vectors.length; j++) {
      out.set(vectors[j], (i + j) * EMBEDDING_DIM);
    }
    done += slice.length;
    onProgress?.(done, texts.length);
  }
  return out;
}

export function cosineSim(a: Float32Array, b: Float32Array, aOffset = 0, bOffset = 0, dim = EMBEDDING_DIM): number {
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += a[aOffset + i] * b[bOffset + i];
  return dot;
}
