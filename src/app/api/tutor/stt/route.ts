import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/sarvam';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as File | null;
    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const sarvamForm = new FormData();
    sarvamForm.append('file', audio);
    sarvamForm.append('model', 'saaras:v3');

    const sttRes = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': config.sarvamApiKey },
      body: sarvamForm,
    });

    if (!sttRes.ok) {
      const errText = await sttRes.text();
      console.error('STT error:', errText);
      return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: 502 });
    }

    const data = await sttRes.json();
    const userMessage = (data.transcript || data.text || '').trim();
    if (!userMessage) {
      return NextResponse.json({ error: 'Could not extract text from audio' }, { status: 422 });
    }
    const languageCode = typeof data.language_code === 'string' ? data.language_code : null;
    return NextResponse.json({ userMessage, languageCode });
  } catch (error: any) {
    console.error('STT route error:', error);
    return NextResponse.json({ error: error.message || 'STT failure' }, { status: 500 });
  }
}
