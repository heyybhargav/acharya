import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

interface RawItem {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The library returns srv3 timestamps in ms (integers) and classic in seconds (floats).
// Detect and normalize to milliseconds.
function normalizeToMs(items: RawItem[]): RawItem[] {
  if (items.length === 0) return items;
  const sample = items[Math.floor(items.length / 2)];
  const alreadyMs = Number.isInteger(sample.offset) && sample.duration > 50;
  if (alreadyMs) return items;
  return items.map(item => ({
    ...item,
    offset: Math.round(item.offset * 1000),
    duration: Math.round(item.duration * 1000),
  }));
}

async function tryFetch(url: string, lang?: string): Promise<RawItem[]> {
  return await YoutubeTranscript.fetchTranscript(url, lang ? { lang } : undefined) as unknown as RawItem[];
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'No YouTube URL provided' }, { status: 400 });
    }

    let items: RawItem[] = [];
    try {
      items = await tryFetch(url, 'en');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      // If English isn't available, retry with the video's default caption track
      if (msg.includes('No transcripts are available in')) {
        items = await tryFetch(url);
      } else {
        throw err;
      }
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No transcript found for this video' }, { status: 404 });
    }

    const normalized = normalizeToMs(items);

    const segments = normalized.map(item => ({
      text: decodeEntities(item.text).trim(),
      startMs: item.offset,
      durationMs: item.duration,
    })).filter(s => s.text.length > 0);

    const transcript = segments.map(s => {
      const totalSeconds = Math.floor(s.startMs / 1000);
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      return `[${mm}:${ss}] ${s.text}`;
    }).join('\n');

    return NextResponse.json({ transcript, segments });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch YouTube transcript';
    console.error('YouTube transcript route error:', message);
    const status = message.toLowerCase().includes('captcha') ? 429
      : message.toLowerCase().includes('disabled') ? 404
      : message.toLowerCase().includes('no longer available') ? 404
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
