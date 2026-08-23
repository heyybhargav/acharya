# Acharya

> Voice-first multilingual AI tutor. Drop in any educational video; it learns the transcript, retrieves the right context, and answers a learner's questions in their own language with streaming audio.

Built for the Sarvam AI assignment. Stack: Next.js 16, Sarvam (STT, TTS, chat, text-lid), Groq (Llama 3.3 70B), Jina v3 embeddings, IndexedDB. Deployed on Vercel.

## What it does

| Input | How |
|---|---|
| YouTube URL | InnerTube fetcher (5 clients) with Supadata residential fallback |
| Audio or video upload | Browser decodes to 16 kHz mono, slices into 25 s chunks, ships to Sarvam STT |
| Pasted text | Used directly |

Once the lesson is ingested, the user holds space (or enables hands-free) and speaks. The response streams as text and plays as audio within roughly 1.5 seconds of the question. Side features in the sidebar: 5 click-to-expand topic summaries and a 3-question conceptual quiz.

## Features

- **Voice in, voice out.** Push-to-talk on space, or fully hands-free with VAD and barge-in interruption.
- **9 Indian languages + English.** Language detected at STT, propagated end-to-end to chat and TTS. Hindi questions get Hindi answers in the right script and voice.
- **Hybrid retrieval.** Cosine (Jina v3, 1024 dim) + BM25 fused via Reciprocal Rank Fusion. Grounding confidence flag pins the LLM to honest "I don't know" answers when the lesson genuinely doesn't cover the question.
- **Streaming chat + per-sentence TTS.** Audio begins playing while the LLM is still producing later sentences. Time-to-first-word ~1.5 s instead of ~6 s.
- **Click-to-expand topic summaries.** Stratified begin/middle/end sampling so summaries from a 2-hour lecture aren't truncated to the intro.
- **Quiz generator.** 3 conceptual MCQs with anti-trivia prompt rules.
- **Eval harness.** `npm run eval` runs a multilingual golden set. Current recall@k: 100% on 12 queries.
- **Client-side vector store.** IndexedDB caches lesson chunks + embeddings. Zero per-query network hop for retrieval.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ BROWSER (Next.js client)                                       │
│  · mic + VAD                                                   │
│  · IndexedDB-backed lesson vectors                             │
│  · hybrid retrieval (cosine + BM25 + RRF)                      │
│  · SSE consumption + per-sentence TTS dispatch                 │
│  · sequential audio playback                                   │
└────────────────────────────────┬───────────────────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────┐
│ VERCEL SERVER ROUTES                                           │
│  /api/tutor/youtube    Edge runtime. 5 InnerTube clients +     │
│                        Supadata residential fallback.          │
│  /api/tutor/transcribe Sarvam STT (saaras:v3) for file ingest. │
│  /api/tutor/stt        Sarvam STT for voice queries.           │
│                        Returns userMessage + languageCode.     │
│  /api/tutor/embed      Jina v3 proxy. task=passage or query.   │
│  /api/tutor/chat       Groq Llama 3.3 70B SSE.                 │
│                        Emits token + sentence-boundary events. │
│                        Sarvam 105B conversations fallback.     │
│  /api/tutor/tts        Sarvam TTS (bulbul:v3).                 │
│                        Sarvam text-lid fallback for language.  │
│  /api/tutor/topics     Groq with stratified sample.            │
│                        Sarvam M fallback. Returns title +      │
│                        80-130 word summary per topic.          │
│  /api/tutor/quiz       Groq, anti-trivia prompt.               │
│                        Sarvam M fallback.                      │
└────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | App Router suits the SSE streaming need; Turbopack dev compile speed |
| LLM (primary) | Groq Llama 3.3 70B Versatile | Fastest hosted Llama 3, generous free tier, decent multilingual reasoning |
| LLM (fallback) | Sarvam 105B (`sarvam-105b-conversations`) | OpenAI-compatible, multilingual, shares Sarvam API key. The `-conversations` variant answers directly; plain `sarvam-105b` burns tokens on `reasoning_content` and fences its JSON |
| STT | Sarvam Saaras v3 | Best-in-class for Indian languages, returns `language_code` |
| TTS | Sarvam Bulbul v3 | Native Indian-language voices, accepts BCP-47 codes |
| Language ID | Sarvam text-lid (fallback only) | Authoritative when STT signal is missing |
| Embeddings | Jina v3 (1024 dim, multilingual) | Free tier 1M tokens/month, no card, asymmetric retrieval |
| Vector store | IndexedDB (client-side) | Zero infra, instant retrieval, no per-query network hop |
| Retrieval | Custom cosine + BM25 + RRF | 30 lines of code, materially better than pure cosine |
| YouTube fallback | Supadata | Residential infra sidesteps Vercel IP blocks. Free tier 100/mo |
| Voice playback | Custom `AudioSequence` | Sequential gap-free playback while TTS fetches happen in parallel |

## Getting started

```bash
git clone https://github.com/heyybhargav/acharya.git
cd acharya
npm install
```

### Environment variables

Create `.env.local` at the project root:

```
SARVAM_API_KEY=your_sarvam_key
GROQ_API_KEY=your_groq_key
JINA_API_KEY=your_jina_key
SUPADATA_API_KEY=your_supadata_key   # optional; only needed for YouTube on Vercel
```

| Variable | Required | Get one at |
|---|---|---|
| `SARVAM_API_KEY` | Yes | sarvam.ai/dashboard |
| `GROQ_API_KEY` | Yes | console.groq.com |
| `JINA_API_KEY` | Yes | jina.ai/embeddings (free 1M tokens/month, no card) |
| `SUPADATA_API_KEY` | Only for YouTube on Vercel | supadata.ai (free 100 requests/month, no card) |

### Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. Paste a YouTube link, upload a media file, or paste a transcript. Once indexed, hold space and ask a question.

### Run the eval

```bash
npm run eval
```

Runs `evals/run.ts` against `evals/golden.json` (12 multilingual queries). Reports recall@k. Requires `JINA_API_KEY` to be set.

### Production build

```bash
npm run build
npm run start
```

## Project structure

```
src/
  app/
    layout.tsx                       Root layout with viewportFit=cover for mobile safe-area
    page.tsx                         Notebook list (home)
    learn/page.tsx                   Main learn page (mic, chat, sidebar, pill)
    api/tutor/
      stt/route.ts                   Sarvam STT proxy
      chat/route.ts                  Groq SSE chat with Sarvam fallback
      tts/route.ts                   Sarvam TTS with text-lid fallback
      embed/route.ts                 Jina v3 proxy
      youtube/route.ts               Edge route, multi-client + Supadata
      transcribe/route.ts            File-ingest STT
      topics/route.ts                Topic + summary extractor
      quiz/route.ts                  MCQ generator

  lib/
    rag/
      types.ts                       Chunk, LessonIndex, RetrievalResult
      chunker.ts                     Sentence-aware chunking with real overlap + timestamps
      embedder.ts                    Jina v3 client (browser via proxy, Node direct)
      bm25.ts                        Multilingual BM25
      retrieve.ts                    Hybrid cosine + BM25 + RRF + grounding flag
      ingest.ts                      Chunk + embed + BM25 -> LessonIndex
      store.ts                       IndexedDB persistence
      use-lesson-rag.ts              React hook (strict-mode safe)
      index.ts                       Public API
    audio-sequence.ts                Sequential audio playback for per-sentence TTS
    yt-transcript.ts                 Multi-client InnerTube + Supadata fallback
    tutor-instructions.ts            Shared system prompt
    mastra/agent.ts                  Mastra agent (topics + quiz)
    notebooks.ts                     localStorage notebook CRUD
    store.ts                         Zustand store

evals/
  golden.json                        Multilingual golden set
  run.ts                             Eval runner
```

## Latency

Rough numbers, typical broadband on the deployed Vercel app:

| Phase | Time |
|---|---|
| User releases mic | T = 0 |
| User-message bubble appears with shimmer | ~50 ms |
| Sarvam STT returns text + language code | ~300 ms |
| Hybrid retrieval done (client-side) | ~400 ms |
| First Groq token arrives | ~700 ms |
| First sentence flushes (phrase boundary) | ~900 ms |
| First audio plays | ~1.4 s |

This was ~6 to 15 seconds in the original prototype. The improvement comes from five stacked optimisations: client-side vector cache, client-side retrieval, SSE streaming, first-phrase early flush, and per-sentence parallel TTS dispatch.

## Multilingual flow

```
audio --> Sarvam STT  (returns language_code: 'hi-IN')
       --> client carries language_code through
         --> /chat  (system prompt pinned to 'hi-IN')
           --> Groq responds in Devanagari
             --> /tts  (target_language_code: 'hi-IN', voice: ritu)
```

Three-layer language detection in priority order:
1. **Sarvam STT** (always present; authoritative)
2. **Sarvam text-lid** (only if STT signal is missing)
3. **Unicode script regex** (final fallback)

## Eval result

```
[photosynthesis-en] chunks=3 recall=100%
[photosynthesis-hi] chunks=1 recall=100%
[founder-talk-en]   chunks=2 recall=100%

Overall recall@k: 100.0% (12/12)
```

Paraphrased queries that pure cosine misses (low scores like 0.176) are rescued by BM25 via RRF, then promoted to top of the returned chunks.

## Deployment

Deployed on Vercel. Push to `main` triggers an auto-deploy. After the first deploy, add the env vars in **Project Settings → Environment Variables** for all three environments (Production, Preview, Development), then redeploy.

## Known limitations

- IndexedDB is per device; no multi-device sync.
- YouTube transcript on Vercel relies on the Supadata fallback (free tier 100/mo). Local dev usually works via direct InnerTube.
- No cross-encoder rerank (would improve precision further, costs API calls).
- No streaming STT (Sarvam doesn't expose it yet).
- VAD is energy-based; a real VAD model (Silero) would handle noisy environments better.
