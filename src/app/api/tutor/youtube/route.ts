import { NextRequest, NextResponse } from 'next/server';
import { fetchTranscript } from '@/lib/yt-transcript';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'No YouTube URL provided' }, { status: 400 });
    }

    const items = await fetchTranscript(url, 'en');
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No transcript found for this video' }, { status: 404 });
    }

    const segments = items.map(item => ({
      text: item.text,
      startMs: item.offsetMs,
      durationMs: item.durationMs,
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
    const status = message.toLowerCase().includes('throttl') || message.toLowerCase().includes('rate')
      ? 502
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
