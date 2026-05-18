import { Agent } from '@mastra/core/agent';
import { createGroq } from '@ai-sdk/groq';
import { config } from '@/config/sarvam';
import { TUTOR_INSTRUCTIONS } from '@/lib/tutor-instructions';

const groq = createGroq({
  apiKey: config.groqApiKey,
});

export const tutorAgent = new Agent({
  id: 'academic-tutor',
  name: 'AcademicTutor',
  instructions: TUTOR_INSTRUCTIONS,
  model: groq('llama-3.3-70b-versatile'),
});

export { TUTOR_INSTRUCTIONS };
