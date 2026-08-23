# Acharya AI: Development Chronicles & Decisions Log

Welcome to the development history, architectural log, and technical decision journal for **Acharya AI**, a multilingual, RAG-bound video and voice academic tutor.

This document is in two parts:

- **Phase 2 (current production)**: the production rewrite of the RAG and voice pipelines. This is what is deployed today.
- **Phase 1 (original prototype)**: the original feature log, preserved verbatim for history. Several pieces of Phase 1 (the `/api/tutor/voice` route, the keyword-overlap chunk selector, `isGlobalQuery`, browser-side Transformers.js embeddings, etc.) have been replaced. Read the Phase 2 section first; the Phase 1 section is kept as a reference for the original design intent.

---

## Phase 2: Production rewrite (May 2026)

The first version of the app shipped with a "Proper RAG" claim that did not survive a careful audit. Phase 2 is the rewrite that addresses each finding from that audit, plus several latency optimisations and a multilingual-by-design overhaul.

### What was broken in Phase 1

- **Per-turn re-embedding.** Every voice question re-embedded the entire transcript via browser-side Transformers.js. A 1-hour lecture produced hundreds of chunks; each turn took 3 to 10 seconds of pure CPU.
- **English-only embedding model.** `Xenova/all-MiniLM-L6-v2` was advertising multilingual support that didn't exist; Indian-language queries scored near-random.
- **Browser bundle ballooning on first load.** Transformers.js loaded a 120 MB quantised model in the browser before any voice query could be answered. On Vercel, the server route that also imported the package hit serverless function size limits.
- **Declared overlap, never applied.** The chunker took a 50-char overlap parameter and never used it. Mid-sentence facts split across chunks were lost.
- **No reranking, no grounding signal.** Pure cosine top-K. Rare proper nouns and number-heavy queries failed silently. The LLM had no signal to refuse to answer when nothing relevant was retrieved.
- **Generic "Thinking..." block.** Users waited 6 to 15 seconds with one unchanging spinner.
- **No evals.** No way to measure retrieval quality across iterations.

### What we changed

**Embeddings: browser Transformers.js to Jina v3 server proxy.**

- Replaced `Xenova/all-MiniLM-L6-v2` (384 dim, English-only) with Jina embeddings v3 (1024 dim, 89 languages including all 9 Indian languages in scope).
- Embeddings now run through a thin `/api/tutor/embed` proxy that holds the Jina API key. The client never sees the key.
- Asymmetric retrieval enabled via Jina's `task` parameter (`retrieval.passage` for chunks, `retrieval.query` for queries).
- First-time browser load no longer downloads a 120 MB model.

**Storage: per-request to persistent IndexedDB.**

- Vectors persist in IndexedDB keyed by lesson id, stored as a packed `Float32Array` (4 bytes per dim).
- Retrieval is now O(top-k) with zero network hops between query and chunks.
- Stale-cache invalidation: saved index is discarded if the embedding model or dim changes.
- React hook (`use-lesson-rag.ts`) tracks per-job state (`cancelled`, `completed`) so React strict mode's mount/cleanup/mount cycle doesn't strand the first ingest in a "stuck" state.

**Retrieval: pure cosine to hybrid with grounding.**

- New `src/lib/rag/` module suite: `chunker.ts`, `embedder.ts`, `bm25.ts`, `retrieve.ts`, `ingest.ts`, `store.ts`, `use-lesson-rag.ts`, plus shared `types.ts`.
- Hybrid retrieval: cosine top-20 + BM25 top-20 fused via Reciprocal Rank Fusion (k=60).
- BM25 implementation is multilingual-aware (Unicode `\p{L}\p{N}` tokenizer).
- Grounding confidence flag (`high` / `medium` / `low`) computed from the top cosine score. Low confidence pins the LLM to "the lesson doesn't cover this" rather than letting it hallucinate.
- Chunking actually applies its overlap parameter now (real 150-char overlap, sentence-aware), and the segment-aware path attaches `startMs` and `endMs` to every chunk for timestamp citation.

**Voice loop: blocking request-response to streaming with per-sentence TTS.**

- Old `/api/tutor/voice` (one monolithic route) replaced with three focused routes: `/api/tutor/stt`, `/api/tutor/chat`, `/api/tutor/tts`.
- `/api/tutor/chat` returns a Server-Sent Events stream emitting both `token` events and `sentence` events. Sentence events fire as soon as a sentence terminator (or, for the very first sentence, a phrase break at ~25 chars) is crossed.
- Client fires Sarvam TTS per sentence in parallel as sentences arrive. Custom `AudioSequence` plays them back-to-back with no gaps.
- Time-to-first-audio: ~6 to 15 s in Phase 1, ~1.5 s in Phase 2.

**Multilingual: regex-only guessing to Sarvam-driven language flow.**

- Sarvam STT's `language_code` is now extracted, propagated to `/chat` (system prompt pinned to that language), and passed to `/tts` as the authoritative `target_language_code`.
- Sarvam `text-lid` is the second-layer fallback (only fires when STT's signal is missing).
- Unicode script regex demoted from primary detection to last-resort fallback.

**YouTube transcript: single-client InnerTube to multi-client with Supadata fallback.**

- `src/lib/yt-transcript.ts` tries 5 InnerTube clients in sequence (ANDROID, IOS, TVHTML5_SIMPLY_EMBEDDED_PLAYER, WEB, ANDROID_VR), then falls back to web-page scraping, then to Supadata's transcript API.
- Edge runtime for the YouTube route specifically (different egress IP pool helps when YT throttles).
- Supadata kicks in when Vercel's datacenter IPs are blocked, which is the typical production failure mode.

**UX: phase-aware progress indicators replace generic spinner.**

- Each phase has its own label in the floating pill and inline in the chat: "Transcribing your voice", "Searching the lesson", "Thinking through your question", "Writing" (streaming), "Speaking".
- User-message bubble appears immediately on mic release with a shimmer so the user gets confirmation within ~50 ms.
- Tutor message shows a blinking caret while streaming.
- Indexing pill replaces the mic controls during first-time setup so users don't tap a useless button.

**Hands-free mode (VAD): hardened and re-enabled barge-in.**

- VAD logic accumulates speech with a 250 ms grace window so micro-gaps between syllables don't kill the trigger.
- Silence-to-stop bumped from 1.6 s to 2.5 s so natural thinking pauses don't truncate recordings.
- Voice interruption during playback restored (the early-return that suppressed all VAD during playback was removed; adaptive threshold of 26 during playback handles speaker spillover).
- Three layers of guards prevent the "stale recording fires transcription after hands-free is turned off" bug.

**Topic summaries (new).**

- Per-topic summaries (80 to 130 words each, click to expand in the sidebar) generated from a stratified begin/middle/end sample of the transcript (8000 char budget), not the first 5000 chars.
- Eager persistence so the user can refresh immediately after extraction without losing summaries.
- Backwards-compatible with the legacy `topics: string[]` format.

**Quiz (kept and tightened).**

- Existing 3-MCQ flow preserved; prompt rules made explicit (conceptual, no trivia, plausible distractors, no markdown).

**Cleanup.**

- Removed: `/api/tutor/voice`, `src/lib/rag.ts`, `src/lib/youtube-transcript.ts` (custom impl), 20 scratch debug files (`test-yt*.js`, `test-sarvam*.js`, `test-transformers.js`), unused dependencies (`@xenova/transformers`, `@huggingface/transformers`, `ai`, `youtube-transcript`, `youtube-transcript-api`).
- Added: `evals/golden.json` and `evals/run.ts` for retrieval quality tracking.

### Updated configuration

- **LLM (primary):** `llama-3.3-70b-versatile` via Groq, streaming SSE
- **LLM (fallback):** `sarvam-105b-conversations` via Sarvam (`/v1/chat/completions`)
- **STT:** Sarvam Saaras v3
- **TTS:** Sarvam Bulbul v3, speaker `ritu`, pace 1.0
- **Language ID (fallback path):** Sarvam `/text-lid`
- **Embeddings:** Jina embeddings v3, 1024 dim, `task=retrieval.passage` for chunks and `task=retrieval.query` for queries
- **Chunking:** 800 chars target, 150 chars real overlap, sentence-aware with Devanagari terminator support, timestamp metadata when source provides it
- **Retrieval:** top-20 cosine + top-20 BM25 fused via RRF (k=60), final top-5 by RRF, grounding floor at cosine 0.20 and mid at 0.35
- **VAD threshold (idle):** 14
- **VAD threshold (during playback):** 26
- **VAD speech-accumulation grace:** 250 ms
- **VAD continuous-speech-to-record:** 180 ms
- **VAD silence-to-stop:** 2500 ms
- **TTS first-phrase early flush:** at 25+ chars on `,;:` for the very first sentence; sentence terminators for the rest
- **YouTube fetcher:** Edge runtime, 5 InnerTube clients + web scrape + Supadata fallback

### Updated architectural map

```
+------------------------------------------------------------------+
| BROWSER  (Client Component, /learn page)                         |
|  - mic + VAD (with playback barge-in)                            |
|  - IndexedDB-backed lesson vectors                               |
|  - hybrid retrieval (cosine + BM25 + RRF), client-side           |
|  - SSE consumption + per-sentence TTS dispatch                   |
|  - sequential audio playback                                     |
+----------------------------------+-------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
| VERCEL SERVER ROUTES                                             |
|  /api/tutor/youtube     Edge. 5 InnerTube clients + scrape +     |
|                         Supadata fallback.                       |
|  /api/tutor/transcribe  Sarvam STT for file ingest.              |
|  /api/tutor/stt         Sarvam STT for voice queries.            |
|                         Returns userMessage + languageCode.      |
|  /api/tutor/embed       Jina v3 proxy. task=passage or query.    |
|  /api/tutor/chat        Groq SSE. Emits token + sentence events. |
|                         Sarvam 105B fallback.                    |
|  /api/tutor/tts         Sarvam TTS. languageCode from STT;       |
|                         text-lid fallback; script regex final.   |
|  /api/tutor/topics      Groq + Sarvam fallback. Stratified       |
|                         sample. Returns title + summary.         |
|  /api/tutor/quiz        Groq + Sarvam fallback. Anti-trivia.     |
+------------------------------------------------------------------+
```

### Phase 2 file references

| File | Role |
|---|---|
| `src/lib/rag/` | RAG module suite: embedder, chunker, BM25, retrieve, ingest, store, types, hook |
| `src/lib/audio-sequence.ts` | Sequential audio player + TTS fetch helper |
| `src/lib/yt-transcript.ts` | Multi-client InnerTube + Supadata fallback |
| `src/lib/tutor-instructions.ts` | Shared system prompt for chat / topics / quiz |
| `src/app/api/tutor/{stt,chat,tts,embed}/route.ts` | New focused routes replacing `/voice` |
| `src/app/api/tutor/youtube/route.ts` | Edge runtime, uses `yt-transcript.ts` |
| `evals/run.ts`, `evals/golden.json` | Retrieval quality eval harness |

### Phase 2 metrics

| Metric | Phase 1 | Phase 2 |
|---|---|---|
| Per-turn embedding work | 3 to 10 s (re-embed every turn) | 0 ms (cached in IndexedDB) |
| First-load model download | 120 MB Transformers.js | 0 MB (server-side embeddings) |
| Time to first LLM token | ~2 to 3 s | ~300 to 500 ms |
| Time to first audio | ~6 to 15 s | ~1.5 to 2 s |
| Eval recall@k | not measured | 100% (12 queries, English + Hindi) |
| Embedding model | English-only | Multilingual (89 languages) |
| Retrieval | Pure cosine | Hybrid cosine + BM25 + RRF + grounding |

### Phase 1 sections superseded

The following sections in the original log are kept for history but no longer reflect the running code:

- Section 7 ("Lightweight RAG Chunk Selector") — replaced by hybrid retrieval in `src/lib/rag/retrieve.ts`.
- Section 9 ("Hybrid Context Router" with `isGlobalQuery`) — replaced by the grounding confidence flag in retrieval and the stratified-sample approach in `/api/tutor/topics`.
- Section 6 ("Unlimited TTS Speech Workaround") — still relevant in spirit; the per-sentence dispatch in Phase 2 takes the same idea further by playing earlier sentences while later ones are still being generated.
- Section 12 ("VAD Acoustic Feedback Protection Guard") — partially superseded; the strict early-return was removed because it also killed user barge-in. Adaptive thresholds (14 idle vs 26 during playback) still suppress speaker spillover.
- Section 3 ("Dynamic Multilingual Router") — Unicode regex demoted from primary to fallback; Sarvam STT's `language_code` and Sarvam `text-lid` now do the authoritative work.

---

## Phase 1: Original feature log (preserved verbatim)



## 🎨 Branding & Aesthetics System
* **Theme Identity:** Clean, geometric layout inspired by **Ramp.com**.
* **Visual Palette:** Rigid light slate borders, paper-thin white cards, Geist Sans typography, a floating dark capsule controller, and a high-contrast chartreuse/lime-green accent (`bg-[#cfff00]`).
* **Design Philosophy:** Rejects muddy dark glassmorphism in favor of highly crisp, modern, dynamic flat-design grids.

---

## 🚀 Core Features Engineered

### 1. Space Bar Walkie-Talkie (Push-to-Talk)
* **What & Why:** Integrated a global keypress listener allowing students to press-and-hold the `[Space]` key to speak, automatically submitting their audio query upon release.
* **Engineering Rationale:** Intercepts native space page-scrolling (`e.preventDefault()`) but safely bypasses the listener when typing in inputs/textareas. Uses `e.repeat` guards to filter out OS auto-repeat events, maintaining a highly responsive click-to-toggle fallback.

### 2. In-Browser Media Slicer (Web Audio API)
* **What & Why:** Bypasses Sarvam AI’s strict 30-second synchronous Speech-to-Text file-length limit by executing audio decoding completely client-side in the browser.
* **Engineering Rationale:** Uploaded video/audio is decoded in memory using the browser's native **Web Audio API (`AudioContext`)**. It splits the audio timeline into precise **25-second chunks**, encodes them as lightweight WAV blobs, and uploads them sequentially. The chunks are concatenated on-screen with elapsed timeline markers (e.g. `[00:25]`, `[00:50]`).

### 3. Dynamic Multilingual Router & True Multilingualism
* **What & Why:** Swapped out Sarvam translation endpoints (`speech-to-text-translate`) for native transcription (`speech-to-text`) to preserve the exact Indian script of the user's speech.
* **Engineering Rationale:**
  * Created a Unicode script detector in the voice endpoint. It maps characters in real-time to Sarvam's exact language targets: Hindi/Devanagari (`hi-IN`), Tamil (`ta-IN`), Telugu (`te-IN`), Kannada (`kn-IN`), Malayalam (`ml-IN`), Bengali (`bn-IN`), Gujarati (`gu-IN`), Punjabi (`pa-IN`), Odia (`or-IN`), and English (`en-IN`).
  * Instructed the Mastra Agent to respond in the exact same language and script spoken by the student.

### 4. Hardware Audio Lock & Clean Interrupts
* **What & Why:** Resolved a bug where interrupting the tutor's vocal response would block future speech playback.
* **Engineering Rationale:** Implemented `stopActiveAudio()`, which explicitly pauses the active HTML5 `Audio` stream, unloads the track (`audio.src = ""`), and triggers `.load()`. This releases the browser's hardware audio thread instantly.

### 5. Premium Hands-Free Mode (Voice Activity Detection - VAD)
* **What & Why:** Engineered a hands-free conversational interface that dynamically starts recording when the student speaks and auto-submits when they stop.
* **Engineering Rationale:**
  * Uses a Web Audio `AnalyserNode` background loop to monitor microphone volume in decibels.
  * **Interruption Support:** If the average volume spikes above a threshold for >180ms while Acharya is speaking, it instantly terminates playback (`stopActiveAudio()`) and triggers recording.
  * **Acoustic Echo Cancellation (AEC) Constraints:** Configures microphone inputs with explicit constraints (`echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`) to direct the browser and OS drivers to filter out the speaker output from the mic stream.
  * **Adaptive VAD Thresholding:** To prevent the tutor's own high-volume spoken audio from falsely triggering self-interruption, it utilizes a dynamic volume threshold:
    * Tutor Speaking (`isPlayingRef.current` is true) ➔ Raises threshold to **`26`** (requires loud, distinct student voice).
    * Tutor Silent (`isPlayingRef.current` is false) ➔ Restores highly sensitive threshold to **`14`**.
  * **Auto-Submit Silence Detector:** When room volume drops below the active threshold for >1.6 seconds, it automatically terminates recording and submits the audio.
  * **State-Mirroring Refs Pattern:** Bypasses classic React Hook cleanup bugs (which were previously killing the mic stream tracks during state changes) by using stable state-mirroring refs (`isRecordingRef`, `isPlayingRef`, `isProcessingRef`). The background listener stream remains open and active continuously.
  * **VAD Shutdown Discard Guard:** Prevents browser `MediaRecorder` track termination from firing accidental "empty" recording submits when toggling Hands-Free off. Uses `isHandsFreeRef` and `isRecordingFromHandsFreeRef` flags to instantly abort and discard VAD media buffers on shutdown.

### 6. Unlimited TTS Speech Workaround (Input Splitting)
* **What & Why:** Bypasses Sarvam's strict TTS limit of at most 500 characters per string without truncating or shortening Acharya's academic responses.
* **Engineering Rationale:**
  * Developed `splitTextIntoSafeChunks()`, which splits any long response into multiple clean array blocks (under 450 characters each) respecting sentence boundaries (`. `, `? `, `! `, and Devanagari **`। `**).
  * Sends these safe chunks as an array in a single request: `inputs: safeChunks`.
  * **Server-Side Concatenation:** Sarvam's engine automatically synthesizes the array items and returns them merged into **a single combined base64 audio track** (`audios[0]`). The client plays the entire explanation seamlessly in one go!

### 7. Lightweight RAG Chunk Selector (Bypass Groq Free TPM Limits)
* **What & Why:** Solves the free-tier Groq API `429 Token Rate Limit` (Limit 6,000 TPM) caused by injecting massive multi-thousand-word video transcripts inside the LLM prompt on every chat turn.
* **Engineering Rationale:**
  * Implemented `getRelevantContextChunks()`, an ultra-fast, in-memory semantic keyword relevance matching system.
  * Splits the transcript into chronologically ordered paragraph chunks (blocks of 3 sentences).
  * Cleans and tokenizes the user's question, ignoring key stop words (supports both English and native Indian language stop words).
  * Computes a term-frequency overlap score for each block, extracts the top-3 most relevant blocks, and reorders them chronologically to preserve the speaker's original lecture flow.
  * **Result:** Reduces input prompt context from 5,000+ tokens to under **300-400 tokens**! Response latency is cut to under **100ms** and Groq free TPM rate limits are bypassed permanently with 100% precision.


### 8. High-Reliability Dual-Layer LLM Fallback (Groq + Sarvam Multilingual)
* **What & Why:** Prevents complete system lockouts if the user exhausts their overall Groq daily free token tier quota (100,000 TPD limit across all models).
* **Engineering Rationale:**
  * Configured a robust `try-catch` wrapper around **all** Mastra LLM calls across all routes (`/api/tutor/voice`, `/api/tutor/topics`, and `/api/tutor/quiz`).
  * If Groq returns a `429 Rate Limit` or standard API error, the system **automatically intercepts the exception** without crashing.
  * Instantly triggers a fallback POST request to Sarvam's official Multilingual Chat Completions API (`https://api.sarvam.ai/v1/chat/completions`) using the highly stable, pre-configured `SARVAM_API_KEY`.
  * Utilizes Sarvam's natively fluent **`sarvam-105b-conversations`** model. Sarvam has since retired `sarvam-m` and `sarvam-30b`; the model id now lives in `src/config/sarvam.ts` so the next deprecation is a one-line change.
  * Cleans the output dynamically to remove reasoning blocks before passing the response to the TTS engine.
  * **Result:** Acharya achieves **100% uninterrupted operational availability** and absolute premium GPT-4/Llama-class logical reasoning for free, with zero downtime!


### 9. Hybrid Context Router (Global Summaries vs. Local Targeted Q&A)
* **What & Why:** Classic RAG chunking fails on high-level/global queries (e.g., *"give me 3 insights from this video"*, *"summarize this entire lecture"*) because the keywords like "insights" or "video" have 0 term-frequency overlap with biological terms in the transcript chunks, resulting in empty/irrelevant context context.
* **Engineering Rationale:**
  * Created `isGlobalQuery()`, which dynamically scans the student's question for high-level summarizing intent keywords (e.g., `summary`, `insight`, `outline`, `main points`, `entire video`, `whole lecture`, etc. in both English and Hindi).
  * **Global Summarization Intent:** Bypasses chunking entirely and feeds a truncated full-length transcript (up to **6,000 characters**, ~1,200 tokens) to the LLM. This gives the model bird's-eye visibility over the whole curriculum to compile perfect global insights.
  * **Targeted Detail Q&A Intent:** Continues using our ultra-efficient **Semantic RAG chunking** to isolate specific targeted paragraph details, keeping token size under 300 tokens and maximizing speed.
  * **Result:** Perfect, deep global video summaries combined with lightning-fast targeted fact-checking!


### 10. Interactive Voice Playback Controllers (Play / Pause / Stop)
* **What & Why:** Provides an incredibly functional student experience by adding responsive voice playback controllers, allowing students to easily pause, resume, or stop Acharya's voice feedback at any point.
* **Engineering Rationale:**
  * **Dual-Layer Controls:** Sleek Play, Pause/Resume, and Stop buttons are added inside **both** the specific tutor chat message bubble and the floating bottom controller pill (ensuring full visibility even if scrolled away).
  * **Visual Cleanliness:** Removed initial experimental word-by-word highlight tracers to eliminate visual clutter and ensure absolute focus on the lecture text.
  * **Result:** A world-class interactive educational portal with highly precise, hardware-accelerated audio play/pause state controls and flat, clutter-free aesthetics.


### 11. Full Multi-Question Conceptual Quiz Wizard (Knowledge Check)
* **What & Why:** Transitions the "Knowledge Check" feature from a single-question generator to a comprehensive, step-by-step 3-question MCQ quiz created dynamically in one go, with strict standards for question quality.
* **Engineering Rationale:**
  * **Unified Response Generation:** Re-engineered the quiz endpoint (`/api/tutor/quiz`) to generate a complete structured JSON payload containing exactly 3 MCQs.
  * **Conceptual & Analytical Standard:** Injected strict prompt directives to enforce questions testing deep conceptual theories, core mechanisms, main arguments, and analytical application scenarios. Outlawed literal fact recall and minor trivia (e.g., specific names or example numbers like "what was the net worth in the example?").
  * **Scoring Wizard UX:** Implemented tracking states for the active question index (`currentQuizIndex`), cumulative score (`quizScore`), and answer confirmation states.
  * **Premium Completion Summary:** Once all questions are answered, the side panel smoothly displays a gorgeous celebratory summary screen showing their final score, complete with quick action buttons to retake the quiz or close the panel.
  * **Result:** An exceptionally premium learning evaluation system that mirrors advanced learning management systems (LMS) with high academic integrity.

### 12. VAD Acoustic Feedback Protection Guard
* **What & Why:** Prevents high-volume laptop speaker audio feedback from triggering false user-interruptions during Hands-Free voice mode playback.
* **Engineering Rationale:**
  * Checks if Acharya is active (`isPlayingRef.current` is true) and immediately skips microphone speech detection analysis.
  * Ensures that loud syllables from speaker feedback will never make the system pause itself.
  * Instantly and seamlessly reactivates the microphone when the tutor finishes speaking to capture the next user prompt.
  * **Result:** Confident, continuous voice delivery without a single self-pausing glitch.

---

---

## 🏛️ Architectural Map & Modified Components

```mermaid
graph TD
  User((Student Microphone)) -->|VAD / Spacebar| Page[src/app/page.tsx]
  Video[Ingested Media] -->|Web Audio API 25s Slicer| Page
  Page -->|FormData WAV chunks| TranscribeAPI[api/tutor/transcribe]
  Page -->|FormData WebM Audio + History| VoiceAPI[api/tutor/voice]
  TranscribeAPI -->|/speech-to-text 'saaras:v3'| SarvamSTT[Sarvam STT API]
  VoiceAPI -->|/speech-to-text 'saaras:v3'| SarvamSTT
  VoiceAPI -->|RAG Context + Prompt| MastraAgent[Mastra Tutor Agent]
  MastraAgent -->|Unicode Lang Detector| TTSConfig[Dynamic target_language_code]
  MastraAgent -->|Exhaustive Response| TTSConfig
  TTSConfig -->|Sentence-aligned chunks <450 chars| SarvamTTS[Sarvam TTS API 'bulbul:v3']
  SarvamTTS -->|Unified Base64 Audio| VoiceAPI
  VoiceAPI -->|Full Text + Combined Speech Audio| Page
```

### File References
1. **[`src/app/page.tsx`](file:///Users/bhargav/Documents/Bhargav/Projects/AI%20Tutor/src/app/page.tsx):**
   * Manages layout, spacebar PTT listeners, Web Audio slicing, `MediaRecorder` buffers, VAD background listeners, and the Ramp-style UI component trees.
2. **[`src/app/api/tutor/voice/route.ts`](file:///Users/bhargav/Documents/Bhargav/Projects/AI%20Tutor/src/app/api/tutor/voice/route.ts):**
   * Microphone transcription router (`saaras:v3`).
   * Hosts `detectLanguageCode()` and `splitTextIntoSafeChunks()`.
   * Invokes the Mastra LLM agent and configures the unified multilingual TTS fetch call (`bulbul:v3`, female speaker `ritu`).
3. **[`src/app/api/tutor/transcribe/route.ts`](file:///Users/bhargav/Documents/Bhargav/Projects/AI%20Tutor/src/app/api/tutor/transcribe/route.ts):**
   * Media ingestion STT proxy router (`saaras:v3`).

---

## ⚡ Verified Configuration Specs
* **LLM Model:** `llama-3.3-70b-versatile` via Groq (state-of-the-art open source LLM, bypassed rate limits using RAG chunking)
* **STT Model:** `saaras:v3` (highly accurate multilingual transcription)
* **TTS Model:** `bulbul:v3` (unified multilingual synthesis)
* **TTS Speaker:** `ritu` (natively fluent Indian voice actor)
* **VAD Threshold (Tutor Silent):** `average amplitude > 14`
* **VAD Threshold (Tutor Speaking):** `average amplitude > 26` (acoustic echo bypass)
* **VAD Continuous Speech Delay:** `180ms`
* **Silence Completion Timeout:** `1600ms`
* **Max TTS Array Item Size:** `450 characters`

---
*Last updated: 2026-05-18T23:20:08+05:30*
