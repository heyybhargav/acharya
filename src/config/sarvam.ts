export const config = {
  sarvamApiKey: process.env.SARVAM_API_KEY || '',
  // Sarvam retires chat models without notice (sarvam-m, then sarvam-30b).
  // Kept here so the next deprecation is a one-line change.
  // The -conversations variant answers directly; plain sarvam-105b spends
  // tokens on reasoning_content and wraps JSON in ``` fences.
  sarvamChatModel: 'sarvam-105b-conversations',
  groqApiKey: process.env.GROQ_API_KEY || '',
  jinaApiKey: process.env.JINA_API_KEY || '',
  supadataApiKey: process.env.SUPADATA_API_KEY || '',
};
