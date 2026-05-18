import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from '@/lib/youtube-transcript';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'No YouTube URL provided' }, { status: 400 });
    }

    // Fetch transcript from YouTube
    const transcriptItems = await YoutubeTranscript.fetchTranscript(url, { lang: 'en' });

    if (!transcriptItems || transcriptItems.length === 0) {
      return NextResponse.json({ error: 'No transcript found for this video' }, { status: 404 });
    }

    // Format transcript with timestamps [MM:SS]
    const formattedTranscript = transcriptItems.map((item: any) => {
      const totalSeconds = Math.floor(item.offset / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      const mm = String(minutes).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      const timestamp = `[${mm}:${ss}]`;
      
      // Clean up text html entities if any
      const cleanText = item.text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      return `${timestamp} ${cleanText}`;
    }).join('\n');

    return NextResponse.json({ transcript: formattedTranscript });
  } catch (error: any) {
    console.error('YouTube transcript route error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch YouTube transcript' }, { status: 500 });
  }
}
