import { NextRequest, NextResponse } from 'next/server';
import { tutorAgent } from '@/lib/mastra/agent';
import { config } from '@/config/sarvam';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const transcript = body.transcript;
    
    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
    }

    const prompt = `Extract exactly 5 key educational topics from the following transcript. Output ONLY a raw JSON array of strings, with no markdown formatting or backticks.
    
    Transcript:
    ${transcript.substring(0, 5000)} // Truncating for safety if needed
    `;

    let textResponse = '';
    try {
      const response = await tutorAgent.generate(prompt);
      textResponse = response.text;
    } catch (llmError) {
      console.warn("Groq topics extraction failed, invoking Sarvam AI fallback...", llmError);
      
      const sarvamChatResponse = await fetch('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'api-subscription-key': config.sarvamApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sarvam-m',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!sarvamChatResponse.ok) {
        throw new Error("Both Groq and Sarvam fallback models failed: " + (await sarvamChatResponse.text()));
      }

      const sarvamChatData = await sarvamChatResponse.json();
      let rawContent = sarvamChatData.choices?.[0]?.message?.content || '';
      
      // Clean up reasoning thoughts if returned
      textResponse = rawContent.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
    }
    
    let topics = [];
    try {
      const cleanedText = textResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      topics = JSON.parse(cleanedText);
    } catch (e) {
      console.error('Failed to parse topics JSON:', textResponse);
      // Fallback
      topics = ['Topic Extraction Failed. Please try again.'];
    }

    return NextResponse.json({ topics });
  } catch (error: any) {
    console.error('Topics extraction error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
