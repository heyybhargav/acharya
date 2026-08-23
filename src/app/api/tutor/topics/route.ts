import { NextRequest, NextResponse } from 'next/server';
import { tutorAgent } from '@/lib/mastra/agent';
import { config } from '@/config/sarvam';

const SENTENCE_REGEX = /[^.!?।॥…]+[.!?।॥…]+\s*|\S[^.!?।॥…]*$/g;

function stratifiedSample(transcript: string, targetLength = 8000): string {
  if (transcript.length <= targetLength) return transcript;
  const sentences = transcript.match(SENTENCE_REGEX) || [transcript];
  const total = sentences.length;
  const beginCount = Math.floor(total * 0.4);
  const middleStart = Math.floor(total * 0.4);
  const middleCount = Math.floor(total * 0.3);
  const endStart = Math.floor(total * 0.7);
  const beginBudget = Math.floor(targetLength * 0.4);
  const middleBudget = Math.floor(targetLength * 0.3);
  const endBudget = targetLength - beginBudget - middleBudget;
  const begin = sentences.slice(0, beginCount).join('').substring(0, beginBudget);
  const middle = sentences.slice(middleStart, middleStart + middleCount).join('').substring(0, middleBudget);
  const end = sentences.slice(endStart).join('').substring(0, endBudget);
  return [
    begin,
    '\n\n[...later in the lesson...]\n\n',
    middle,
    '\n\n[...towards the end of the lesson...]\n\n',
    end,
  ].join('');
}

function buildPrompt(sample: string): string {
  return `You are an expert tutor preparing study notes from a video lesson. Identify the 5 most important distinct topics covered and write a substantive summary for each.

Strict requirements:
- Output exactly 5 topics.
- Each title: 2 to 6 words, captures the essence of that topic.
- Each summary: 3 to 5 sentences, roughly 80 to 130 words. Explain what the lesson actually teaches about this topic. Cover the key concepts, arguments, examples, or insights presented. Write as if you are recapping the lesson for a learner who watched it.
- Stay grounded. Use only information present in the transcript. Do not invent facts, names, numbers, or claims not stated in the lesson.
- Write in the same language and script as the transcript. If the transcript is Hindi, the topics and summaries must be in Hindi. Same for Tamil, Bengali, etc.
- Do NOT include timestamps. Do NOT use markdown, bullets, or asterisks. Just clear prose.

Transcript:
${sample}

Output ONLY a raw JSON array. No markdown, no commentary, no leading or trailing text.
[
  {"title": "Topic title", "summary": "Substantive 3-5 sentence summary..."},
  {"title": "...", "summary": "..."},
  {"title": "...", "summary": "..."},
  {"title": "...", "summary": "..."},
  {"title": "...", "summary": "..."}
]`;
}

interface Topic { title: string; summary: string }

function safeParse(text: string): Topic[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  // Find the first [ and last ] to be resilient to occasional pre/post text
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array found');
  const slice = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(slice);
  if (!Array.isArray(parsed)) throw new Error('Parsed value is not an array');
  return parsed
    .map((t: unknown) => {
      if (t && typeof t === 'object' && 'title' in t) {
        const obj = t as Record<string, unknown>;
        return {
          title: String(obj.title || '').trim(),
          summary: String(obj.summary || '').trim(),
        };
      }
      return null;
    })
    .filter((t): t is Topic => Boolean(t && t.title));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const transcript: string = body.transcript;
    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
    }

    const sample = stratifiedSample(transcript);
    const prompt = buildPrompt(sample);

    let textResponse = '';
    try {
      const response = await tutorAgent.generate(prompt);
      textResponse = response.text;
    } catch (llmError) {
      console.warn('Groq topics+summaries failed, falling back to Sarvam.', llmError);
      const sarvamRes = await fetch('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'api-subscription-key': config.sarvamApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.sarvamChatModel, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!sarvamRes.ok) {
        throw new Error('Both Groq and Sarvam fallback failed: ' + await sarvamRes.text());
      }
      const sarvamData = await sarvamRes.json();
      const raw: string = sarvamData.choices?.[0]?.message?.content || '';
      textResponse = raw.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
    }

    let topics: Topic[] = [];
    try {
      topics = safeParse(textResponse).slice(0, 5);
    } catch (parseErr) {
      console.error('Failed to parse topics+summaries:', textResponse, parseErr);
      topics = [{ title: 'Could not extract topics', summary: 'Try again or paste a longer transcript.' }];
    }

    return NextResponse.json({ topics });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Topics extraction error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
