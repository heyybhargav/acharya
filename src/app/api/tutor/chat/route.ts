import { NextRequest } from 'next/server';
import { TUTOR_INSTRUCTIONS } from '@/lib/tutor-instructions';
import { config } from '@/config/sarvam';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface IncomingChunk {
  index: number;
  text: string;
  startMs?: number;
  endMs?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatBody {
  userMessage: string;
  chunks: IncomingChunk[];
  history: ChatMessage[];
  groundingConfidence?: 'high' | 'medium' | 'low';
}

const SENTENCE_TERMINATOR = /([.!?।॥…])(\s|$)/;
const PHRASE_TERMINATOR = /([.!?।॥…,;:])(\s|$)/;
const FAST_FIRST_MIN_CHARS = 25;

function formatChunks(chunks: IncomingChunk[]): string {
  if (!chunks || chunks.length === 0) return '(no relevant context retrieved)';
  return chunks.map(c => {
    const ts = typeof c.startMs === 'number' ? `[${formatTimestamp(c.startMs)}] ` : '';
    return `${ts}${c.text}`;
  }).join('\n\n');
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function buildSystemPrompt(chunks: IncomingChunk[], grounding: 'high' | 'medium' | 'low'): string {
  const context = formatChunks(chunks);
  const groundingHint =
    grounding === 'low'
      ? 'IMPORTANT: The retrieval found no strongly relevant context for this question. Tell the user the lesson does not cover this and offer the closest topic the lesson does discuss. Do not invent specifics.'
      : grounding === 'medium'
      ? 'NOTE: The retrieved context is only loosely related. Be careful not to overstate certainty.'
      : 'The retrieved context is highly relevant. Answer confidently from it.';

  return `${TUTOR_INSTRUCTIONS}

--- RETRIEVED CONTEXT FROM THE LESSON ---
${context}
--- END CONTEXT ---

${groundingHint}`;
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamGroq(messages: any[], onDelta: (delta: string) => void): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      stream: true,
      temperature: 0.4,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Groq stream failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // skip malformed line
      }
    }
  }
  return full;
}

async function fallbackSarvam(messages: any[]): Promise<string> {
  const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-subscription-key': config.sarvamApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'sarvam-m', messages }),
  });
  if (!res.ok) throw new Error(`Sarvam fallback failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

function flushSentences(
  buffer: string,
  finalize: boolean,
  allowFastFirst: boolean,
): { sentences: string[]; remainder: string; firstFlushUsed: boolean } {
  const sentences: string[] = [];
  let working = buffer;
  let allowFast = allowFastFirst;
  let firstFlushUsed = false;
  while (true) {
    // For the first emission of a response, accept a phrase break (comma,
    // semicolon, colon) once the buffer is long enough. Gets audio playing
    // ~500ms faster on long opening sentences. Subsequent chunks use full
    // sentence boundaries so the cadence stays natural.
    const regex = allowFast ? PHRASE_TERMINATOR : SENTENCE_TERMINATOR;
    const match = working.match(regex);
    if (!match || match.index === undefined) break;
    if (allowFast && match.index < FAST_FIRST_MIN_CHARS) {
      // Phrase break too early; wait for a real sentence terminator or more text.
      const sentenceMatch = working.match(SENTENCE_TERMINATOR);
      if (!sentenceMatch || sentenceMatch.index === undefined) break;
      const endIdx = sentenceMatch.index + sentenceMatch[1].length;
      const sentence = working.slice(0, endIdx).trim();
      if (sentence) {
        sentences.push(sentence);
        firstFlushUsed = true;
        allowFast = false;
      }
      working = working.slice(endIdx).replace(/^\s+/, '');
      continue;
    }
    const endIdx = match.index + match[1].length;
    const sentence = working.slice(0, endIdx).trim();
    if (sentence) {
      sentences.push(sentence);
      firstFlushUsed = true;
      allowFast = false;
    }
    working = working.slice(endIdx).replace(/^\s+/, '');
  }
  if (finalize && working.trim().length > 0) {
    sentences.push(working.trim());
    working = '';
  }
  return { sentences, remainder: working, firstFlushUsed };
}

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { userMessage, chunks = [], history = [], groundingConfidence = 'medium' } = body;
  if (!userMessage || typeof userMessage !== 'string') {
    return new Response('userMessage required', { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(chunks, groundingConfidence);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentenceBuffer = '';
      let fullText = '';
      let firstSentenceEmitted = false;
      const emitSentences = (finalize: boolean) => {
        const { sentences, remainder, firstFlushUsed } = flushSentences(
          sentenceBuffer,
          finalize,
          !firstSentenceEmitted,
        );
        sentenceBuffer = remainder;
        if (firstFlushUsed) firstSentenceEmitted = true;
        for (const sentence of sentences) {
          controller.enqueue(sseEvent('sentence', { text: sentence }));
        }
      };

      try {
        try {
          fullText = await streamGroq(messages, (delta) => {
            sentenceBuffer += delta;
            fullText = fullText; // no-op; full text captured by streamGroq return
            controller.enqueue(sseEvent('token', { delta }));
            emitSentences(false);
          });
        } catch (groqErr) {
          console.warn('Groq streaming failed, falling back to Sarvam.', groqErr);
          const sarvamText = await fallbackSarvam(messages);
          fullText = sarvamText;
          sentenceBuffer = sarvamText;
          controller.enqueue(sseEvent('token', { delta: sarvamText }));
        }

        emitSentences(true);
        controller.enqueue(sseEvent('done', { fullText, groundingConfidence }));
      } catch (err: any) {
        console.error('Chat stream error:', err);
        controller.enqueue(sseEvent('error', { message: err?.message || 'Generation failed' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
