import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/sarvam';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No audio or video file provided' }, { status: 400 });
    }

    // Proxy the file to Sarvam STT API
    const sarvamFormData = new FormData();
    sarvamFormData.append('file', file);
    sarvamFormData.append('model', 'saaras:v3');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': config.sarvamApiKey,
      },
      body: sarvamFormData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Sarvam Ingest STT Error:', errText);
      return NextResponse.json({ error: 'Failed to transcribe source media' }, { status: response.status });
    }

    const data = await response.json();
    const transcriptText = data.transcript || data.text || '';

    if (!transcriptText) {
      return NextResponse.json({ error: 'Transcription resulted in empty text' }, { status: 400 });
    }

    return NextResponse.json({ transcript: transcriptText });
  } catch (error: any) {
    console.error('Ingest Transcription route error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
