import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/sarvam';

export const runtime = 'nodejs';

const SCRIPT_RANGES: { range: RegExp; code: string }[] = [
  { range: /[ऀ-ॿ]/, code: 'hi-IN' },
  { range: /[஀-௿]/, code: 'ta-IN' },
  { range: /[ఀ-౿]/, code: 'te-IN' },
  { range: /[ಀ-೿]/, code: 'kn-IN' },
  { range: /[ঀ-৿]/, code: 'bn-IN' },
  { range: /[ഀ-ൿ]/, code: 'ml-IN' },
  { range: /[઀-૿]/, code: 'gu-IN' },
  { range: /[਀-੿]/, code: 'pa-IN' },
  { range: /[଀-୿]/, code: 'or-IN' },
];

function detectLanguageCodeViaScript(text: string): string {
  for (const { range, code } of SCRIPT_RANGES) if (range.test(text)) return code;
  return 'en-IN';
}

async function detectLanguageViaSarvam(text: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.sarvam.ai/text-lid', {
      method: 'POST',
      headers: {
        'api-subscription-key': config.sarvamApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text.slice(0, 1000) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.language_code === 'string' && data.language_code.length > 0
      ? data.language_code
      : null;
  } catch {
    return null;
  }
}

function splitIntoSafeChunks(text: string, maxLen = 450): string[] {
  const out: string[] = [];
  const sentences = text.match(/[^.!?।॥…]+[.!?।॥…]+\s*|\S[^.!?।॥…]*$/g) || [text];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current.trim()) out.push(current.trim());
      if (sentence.length > maxLen) {
        let rest = sentence;
        while (rest.length > maxLen) {
          out.push(rest.slice(0, maxLen).trim());
          rest = rest.slice(maxLen);
        }
        current = rest;
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { text, languageCode } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // Prefer the explicit language code the client sent (carried from STT).
    // If absent, ask Sarvam's text-lid for authoritative detection.
    // Fall back to script-range regex if both miss.
    const target =
      (typeof languageCode === 'string' && languageCode.length > 0 ? languageCode : null) ||
      (await detectLanguageViaSarvam(text)) ||
      detectLanguageCodeViaScript(text);
    const inputs = splitIntoSafeChunks(text);
    if (inputs.length === 0) {
      return NextResponse.json({ error: 'empty text' }, { status: 400 });
    }

    const ttsRes = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': config.sarvamApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs,
        target_language_code: target,
        speaker: 'ritu',
        pace: 1.0,
        model: 'bulbul:v3',
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('TTS error:', errText);
      return NextResponse.json({ error: 'TTS failed' }, { status: 502 });
    }

    const data = await ttsRes.json();
    const audios: string[] = data.audios || [];
    return NextResponse.json({ audios, languageCode: target });
  } catch (error: any) {
    console.error('TTS route error:', error);
    return NextResponse.json({ error: error.message || 'TTS failure' }, { status: 500 });
  }
}
