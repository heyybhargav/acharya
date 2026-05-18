import { NextRequest, NextResponse } from 'next/server';
import { tutorAgent } from '@/lib/mastra/agent';
import { config } from '@/config/sarvam';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const transcript = body.transcript;
    const history = body.history || [];
    
    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
    }

    const historyContext = history.map((h: any) => `${h.role}: ${h.text}`).join('\n');

    const prompt = `Generate a full quiz of exactly 3 Multiple-Choice Questions (MCQs) based on the following transcript and recent conversation context.
    
    Transcript:
    ${transcript.substring(0, 5000)}
    
    Recent Chat:
    ${historyContext}

    CRITICAL RULES FOR QUESTION QUALITY:
    1. CONCEPTUAL & APPLICATION FOCUS: The questions must test the student's understanding of the underlying principles, logical concepts, core theories, and main arguments of the lecture.
    2. STRICTLY NO TRIVIA OR LITERAL RECALLS: Do NOT ask literal or trivial recall questions about specific numbers, names, or minor details mentioned only as illustrative examples (e.g., if the speaker gives an example where someone's net worth is $100M, do NOT ask what their net worth was. That is completely useless).
    3. SCENARIO OR ANALYTICAL THINKING: Focus on questions that require the student to apply the concept to a new scenario, or analyze *why* a certain mechanism, rule, or concept works the way it does.
    4. THOUGHT-PROVOKING DISTRACTORS: All MCQ options must be plausible, realistic, and test genuine comprehension. Avoid obviously wrong or silly distractor choices.
    
    Output ONLY a raw JSON object with this exact structure:
    {
      "quiz": [
        {
          "question": "Conceptual Question 1?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 0
        },
        {
          "question": "Conceptual Question 2?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 1
        },
        {
          "question": "Conceptual Question 3?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 2
        }
      ]
    }
    
    Do not include markdown tags or backticks.`;

    let textResponse = '';
    try {
      const response = await tutorAgent.generate(prompt);
      textResponse = response.text;
    } catch (llmError) {
      console.warn("Groq quiz generation failed, invoking Sarvam AI fallback...", llmError);
      
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
    
    let quizData = null;
    try {
      const cleanedText = textResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      quizData = parsed.quiz || parsed;
    } catch (e) {
      console.error('Failed to parse quiz JSON:', textResponse);
      return NextResponse.json({ error: 'Failed to generate quiz properly.' }, { status: 500 });
    }

    return NextResponse.json({ quiz: quizData });
  } catch (error: any) {
    console.error('Quiz generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
