import { pipeline } from '@xenova/transformers';

// Singleton to avoid reloading model
let extractor: any = null;

export async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function chunkTranscript(transcript: string, chunkSize: number = 300, overlap: number = 50): string[] {
  // Advanced chunking with overlap
  const sentences = transcript.match(/[^.!?।]+[.!?।]*\s*/g) || [transcript];
  const chunks: string[] = [];
  let currentChunk = "";

  for (let i = 0; i < sentences.length; i++) {
    if ((currentChunk + sentences[i]).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Start new chunk with overlap
      currentChunk = sentences[i];
    } else {
      currentChunk += sentences[i];
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

export async function retrieveRelevantContext(query: string, transcript: string, topK: number = 3): Promise<string> {
  const chunks = chunkTranscript(transcript);
  
  if (chunks.length <= topK) return transcript;

  // Embed the query
  const queryEmbedding = await embedText(query);

  // Embed chunks in parallel for speed
  const chunkEmbeddings = await Promise.all(
    chunks.map(chunk => embedText(chunk))
  );

  // Calculate similarity scores
  const scoredChunks = chunks.map((chunk, idx) => ({
    chunk,
    index: idx,
    score: cosineSimilarity(queryEmbedding, chunkEmbeddings[idx])
  }));

  // Sort by highest similarity
  scoredChunks.sort((a, b) => b.score - a.score);

  // Take top K and then re-sort them chronologically so the LLM gets context in order
  const topScored = scoredChunks.slice(0, topK);
  topScored.sort((a, b) => a.index - b.index);

  return topScored.map(s => s.chunk).join("\n\n");
}
