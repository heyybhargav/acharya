import { NextRequest, NextResponse } from 'next/server';
import { tutorAgent } from '@/lib/mastra/agent';
import { config } from '@/config/sarvam';

function detectLanguageCode(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return 'hi-IN'; // Hindi / Marathi
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN'; // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn-IN'; // Kannada
  if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN'; // Bengali
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml-IN'; // Malayalam
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu-IN'; // Gujarati
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa-IN'; // Punjabi
  if (/[\u0B00-\u0B7F]/.test(text)) return 'or-IN'; // Odia
  return 'en-IN'; // Default to Indian English
}

function isGlobalQuery(query: string): boolean {
  const globalKeywords = [
    'summary', 'summarize', 'insight', 'insights', 'overview', 'outline', 
    'main topic', 'main points', 'what is this video', 'what is the video',
    'about this video', 'about this lecture', 'whole video', 'entire video',
    'complete video', 'full transcript', 'सारांश', 'मुख्य बिंदु', 'वीडियो किस बारे में है'
  ];
  const queryLower = query.toLowerCase();
  return globalKeywords.some(keyword => queryLower.includes(keyword));
}

/**
 * For global/summary queries, instead of naively taking the first N chars
 * (which only covers the intro of a long video), we sample proportionally
 * from the beginning, middle, and end of the transcript.
 * 
 * A 4-hour video transcript can be 80k–120k chars. Sampling distributed
 * sections gives the LLM a representative cross-section of the whole lecture
 * rather than just the first 5 minutes.
 */
function getGlobalContext(transcript: string, targetLength: number = 7500): string {
  if (transcript.length <= targetLength) return transcript;

  // Split into sentences for clean boundaries
  const sentences = transcript.match(/[^.!?।]+[.!?।]*\s*/g) || [transcript];
  const total = sentences.length;

  // Allocate roughly: 40% beginning, 35% middle, 25% end
  const beginCount = Math.floor(total * 0.40);
  const middleStart = Math.floor(total * 0.45);
  const middleCount = Math.floor(total * 0.35);
  const endStart = Math.floor(total * 0.75);
  const endCount = total - endStart;

  const beginSection = sentences.slice(0, beginCount).join('');
  const middleSection = sentences.slice(middleStart, middleStart + middleCount).join('');
  const endSection = sentences.slice(endStart, endStart + endCount).join('');

  // Trim each section to fit within targetLength budget (proportional allocation)
  const beginBudget = Math.floor(targetLength * 0.40);
  const middleBudget = Math.floor(targetLength * 0.35);
  const endBudget = Math.floor(targetLength * 0.25);

  const result = [
    beginSection.substring(0, beginBudget),
    '\n\n[...mid-lecture...]\n\n',
    middleSection.substring(0, middleBudget),
    '\n\n[...later in the lecture...]\n\n',
    endSection.substring(0, endBudget),
  ].join('');

  return result;
}

function splitTextIntoSafeChunks(text: string): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  
  // Split by sentence boundaries (periods, question marks, exclamations, Devanagari full stops)
  const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= 450) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      if (sentence.length > 450) {
        let sub = sentence;
        while (sub.length > 450) {
          chunks.push(sub.substring(0, 450).trim());
          sub = sub.substring(450);
        }
        currentChunk = sub;
      } else {
        currentChunk = sentence;
      }
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

function getRelevantContextChunks(transcript: string, query: string, topN: number = 3): string {
  // 1. Split transcript into paragraph chunks (blocks of 3 sentences)
  const sentences = transcript.match(/[^.!?।]+[.!?।]*\s*/g) || [transcript];
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (let i = 0; i < sentences.length; i++) {
    currentChunk += sentences[i];
    if ((i + 1) % 3 === 0 || i === sentences.length - 1) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = "";
    }
  }

  if (chunks.length <= topN) {
    return chunks.join("\n\n");
  }

  // 2. Tokenize user query to extract key terms (ignore basic stop words)
  const stopwords = new Set(["what", "is", "the", "a", "an", "and", "or", "but", "in", "on", "at", "for", "with", "about", "to", "of", "from", "by", "this", "that", "these", "those", "क्या", "है", "का", "की", "के", "और", "में", "से", "पर", "को", "भी"]);
  const queryTokens = query
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"।]/g, "")
    .split(/\s+/)
    .filter(token => token.length > 1 && !stopwords.has(token));

  if (queryTokens.length === 0) {
    return chunks.slice(0, topN).join("\n\n");
  }

  // 3. Score each chunk by term-frequency overlap
  const scoredChunks = chunks.map(chunk => {
    const chunkLower = chunk.toLowerCase();
    let score = 0;
    
    for (const token of queryTokens) {
      const escapedToken = token.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const matches = chunkLower.match(new RegExp(escapedToken, 'g'));
      if (matches) {
        score += matches.length;
      }
    }
    return { chunk, score };
  });

  // 4. Sort and reorder chronologically
  scoredChunks.sort((a, b) => b.score - a.score);
  const topScored = scoredChunks.slice(0, topN);
  const orderedChunks = topScored
    .map(sc => ({
      chunk: sc.chunk,
      index: chunks.indexOf(sc.chunk)
    }))
    .sort((a, b) => a.index - b.index)
    .map(x => x.chunk);

  return orderedChunks.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const transcript = formData.get('transcript') as string;
    const historyStr = formData.get('history') as string;
    
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (!transcript) {
      return NextResponse.json({ error: 'No transcript context provided' }, { status: 400 });
    }

    const history = historyStr ? JSON.parse(historyStr) : [];

    // Step 1: STT (Speech-to-Text) via Sarvam AI
    const sttFormData = new FormData();
    sttFormData.append('file', audioFile);
    sttFormData.append('model', 'saaras:v3'); // Sarvam STT Model v3
    
    const sttResponse = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': config.sarvamApiKey,
      },
      body: sttFormData,
    });

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      console.error('STT Error:', errorText);
      return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: 500 });
    }

    const sttData = await sttResponse.json();
    const userMessage = sttData.transcript || sttData.text || '';
    if (!userMessage) {
      return NextResponse.json({ error: 'Could not extract text from audio' }, { status: 400 });
    }

    // Check if this is a global summarization / high-level insight question
    const isGlobal = isGlobalQuery(userMessage);

    // Retrieve either a truncated global transcript or targeted RAG chunks based on the query type
    const relevantContext = isGlobal 
      ? getGlobalContext(transcript) 
      : getRelevantContextChunks(transcript, userMessage, 3);

    // Step 2: Mastra Agent + Groq (RAG Context Injection)
    const contextLabel = isGlobal 
      ? `Context (Representative samples from across the full video transcript — beginning, middle, and end sections):`
      : `Context (Most relevant sections from the video transcript):`;
    
    const prompt = `${contextLabel}
${relevantContext}

User Question: ${userMessage}

Remember your instructions:
1. Use ONLY the context above. If it's not in the context, politely refuse.
${isGlobal ? '2. Since this is a summary/insight question, draw insights from ALL sections of the context provided (beginning, mid-lecture, and later sections). Give a comprehensive answer that reflects the full arc of the video, not just the intro.' : '2. Answer specifically and directly from the relevant context above.'}
3. IMPORTANT: You MUST respond in the EXACT same language and script that the user asked their question in (e.g. if they ask in Hindi, respond in Hindi Devanagari script; if they ask in Tamil, respond in Tamil script; if they ask in Telugu, respond in Telugu script, etc.). Keep the response direct, natural, and matching the user's spoken language.`;

    const messagesArray = [
      ...history.map((msg: any) => ({
        role: msg.role === 'tutor' ? 'assistant' : 'user',
        content: msg.text,
      })),
      { role: 'user', content: prompt }
    ];

    // Mastra agent generation with robust Sarvam AI fallback
    let textResponse = '';
    try {
      const response = await tutorAgent.generate(messagesArray);
      textResponse = response.text;
    } catch (llmError) {
      console.warn("Groq agent generation failed, invoking Sarvam AI fallback...", llmError);
      
      let systemPrompt = '';
      try {
        const instResult = await tutorAgent.getInstructions();
        systemPrompt = typeof instResult === 'string' 
          ? instResult 
          : (instResult && typeof instResult === 'object' && 'content' in instResult)
            ? String((instResult as any).content || '')
            : String(instResult || '');
      } catch (instError) {
        console.error("Failed to dynamically fetch tutorAgent instructions, using hardcoded fallback", instError);
        systemPrompt = `You are Acharya, a tutor who helps a student learn from a single video lesson. The lesson transcript is available to you through retrieval. The student speaks to you and hears you back, so every reply is read aloud.`;
      }

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
              role: 'system',
              content: systemPrompt
            },
            ...messagesArray.map((msg: any) => ({
              role: msg.role,
              content: msg.content
            }))
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

    // Automatically detect the language of the LLM response to match the TTS engine
    const targetLanguage = detectLanguageCode(textResponse);

    // Split the text response into multiple safe chunks under 500 characters each to bypass Sarvam's API limits
    const safeChunks = splitTextIntoSafeChunks(textResponse);

    // Step 3: TTS (Text-to-Speech) via Sarvam AI
    const ttsResponse = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': config.sarvamApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: safeChunks,
        target_language_code: targetLanguage,
        speaker: 'ritu',
        pace: 1.0,
        model: 'bulbul:v3'
      }),
    });

    let audioBase64 = '';
    if (ttsResponse.ok) {
      const ttsData = await ttsResponse.json();
      audioBase64 = ttsData.audios?.[0] || '';
    } else {
      console.error('TTS Error:', await ttsResponse.text());
      // Proceed even if TTS fails, returning text only
    }

    return NextResponse.json({ 
      textResponse, 
      userMessage,
      audioBase64 
    });
  } catch (error: any) {
    console.error('Voice loop error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
