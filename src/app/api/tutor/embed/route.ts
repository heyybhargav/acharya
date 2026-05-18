import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const MODEL = 'jina-embeddings-v3';
const ALLOWED_TASKS = new Set(['retrieval.passage', 'retrieval.query']);

export async function POST(req: NextRequest) {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'JINA_API_KEY not configured on the server.' },
      { status: 500 },
    );
  }

  let body: { texts?: unknown; task?: unknown };
  let rawText = '';
  try {
    rawText = await req.text();
    body = JSON.parse(rawText);
  } catch (e) {
    console.error('[embed] JSON parse failed. Content-Type:', req.headers.get('content-type'), 'length:', rawText.length, 'preview:', rawText.slice(0, 200));
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const texts = body.texts;
  const task = typeof body.task === 'string' ? body.task : 'retrieval.passage';
  if (!Array.isArray(texts) || texts.length === 0 || !texts.every(t => typeof t === 'string')) {
    console.error('[embed] Validation failed. typeof texts:', typeof texts, 'isArray:', Array.isArray(texts), 'length:', Array.isArray(texts) ? texts.length : 'n/a', 'task:', task);
    return NextResponse.json({ error: 'texts must be a non-empty string array' }, { status: 400 });
  }
  if (!ALLOWED_TASKS.has(task)) {
    console.error('[embed] Invalid task:', task);
    return NextResponse.json({ error: 'invalid task' }, { status: 400 });
  }
  if (texts.length > 256) {
    console.error('[embed] Too many texts:', texts.length);
    return NextResponse.json({ error: 'too many texts in one request (max 256)' }, { status: 400 });
  }

  try {
    const jinaRes = await fetch(JINA_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, task, input: texts }),
    });

    if (!jinaRes.ok) {
      const errText = await jinaRes.text().catch(() => '');
      console.error('Jina API error:', jinaRes.status, errText);
      return NextResponse.json(
        { error: `Embedding provider failed (${jinaRes.status})` },
        { status: 502 },
      );
    }

    const data = await jinaRes.json();
    const vectors = data.data.map((d: { embedding: number[] }) => d.embedding);
    return NextResponse.json({ vectors, model: MODEL });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Embed proxy error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
