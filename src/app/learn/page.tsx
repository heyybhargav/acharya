"use client";

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { getNotebook, createNotebook, updateNotebook, type NotebookSegment } from '@/lib/notebooks';
import { useLessonRag } from '@/lib/rag/use-lesson-rag';
import { AudioSequence, fetchTtsAudios, playChunkSequence } from '@/lib/audio-sequence';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Mic, Square, BrainCircuit, FileText, Upload,
  Volume2, User, Loader2, Video, BookOpen, Headphones, Trophy, ArrowRight, X, Play, Pause, ChevronLeft, Menu
} from 'lucide-react';

export default function LearnPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-slate-400 text-sm">Loading...</div>}>
      <LearnPageInner />
    </Suspense>
  );
}

function LearnPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notebookId = searchParams.get('id');

  const {
    transcript, setTranscript,
    topics, setTopics,
    messages, addMessage, updateMessage,
    quizActive, setQuizActive,
    quizData, setQuizData
  } = useAppStore();

  const [currentNotebookId, setCurrentNotebookId] = useState<string | null>(notebookId);
  const [notebookTitle, setNotebookTitle] = useState<string>('New lesson');
  const [segments, setSegments] = useState<NotebookSegment[] | undefined>(undefined);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const lessonRag = useLessonRag(currentNotebookId, transcript, segments);

  // Track the latest notebook id in a ref so async callbacks (extract-topics, etc.)
  // see the freshly created id without waiting for closure refresh.
  const currentNotebookIdRef = useRef<string | null>(currentNotebookId);
  useEffect(() => {
    currentNotebookIdRef.current = currentNotebookId;
  }, [currentNotebookId]);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activePlayingMessageId, setActivePlayingMessageId] = useState<string | null>(null);
  const [isExtractingTopics, setIsExtractingTopics] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [selectedQuizOption, setSelectedQuizOption] = useState<string | null>(null);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState('');
  const [processingPhase, setProcessingPhase] = useState<'transcribing' | 'searching' | 'thinking' | 'streaming' | 'speaking' | null>(null);
  const [expandedTopicIndex, setExpandedTopicIndex] = useState<number | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isFetchingYoutube, setIsFetchingYoutube] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const handsFreeStreamRef = useRef<MediaStream | null>(null);
  const isHandsFreeRef = useRef(isHandsFree);
  const isRecordingFromHandsFreeRef = useRef(false);
  const discardNextRecordingRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentSequenceRef = useRef<AudioSequence | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const indexingView = () => {
    const status = lessonRag.status;
    if (!status || status.phase === 'done') return null;
    let headline = 'Preparing this lesson';
    let detail = '';
    let percent: number | null = null;
    if (status.phase === 'chunking') {
      headline = 'Splitting transcript into passages';
    } else if (status.phase === 'embedding') {
      headline = 'Indexing passages';
      const loaded = status.loaded;
      const total = status.total ?? 0;
      if (loaded != null && total > 0) {
        detail = `${loaded} / ${total}`;
        percent = (loaded / total) * 100;
      } else if (total > 0) {
        detail = `Embedding ${total} passages…`;
        // percent stays null so the bar shows the indeterminate pulse
      }
    } else if (status.phase === 'indexing') {
      headline = 'Building keyword index';
    }
    return { headline, detail, percent };
  };

  const phaseLabel = (phase: 'transcribing' | 'searching' | 'thinking' | 'streaming' | 'speaking' | null | undefined): string => {
    switch (phase) {
      case 'transcribing': return 'Transcribing your voice';
      case 'searching': return 'Searching the lesson';
      case 'thinking': return 'Thinking through your question';
      case 'streaming': return 'Writing';
      case 'speaking': return 'Speaking';
      default: return '';
    }
  };

  const scrollToBottom = () => {
    if (chatScrollContainerRef.current) {
      chatScrollContainerRef.current.scrollTo({
        top: chatScrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    setTimeout(scrollToBottom, 100);
  }, [messages, isProcessing]);

  // Load notebook from localStorage if ID is in URL
  useEffect(() => {
    if (notebookId) {
      const nb = getNotebook(notebookId);
      if (nb) {
        setTranscript(nb.transcript);
        setTopics(nb.topics);
        setNotebookTitle(nb.title);
        setCurrentNotebookId(nb.id);
        setSegments(nb.segments);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Auto-save notebook whenever transcript or topics change; auto-create on first paste
  useEffect(() => {
    if (!transcript) return;
    const saveTimer = setTimeout(() => {
      if (currentNotebookId) {
        updateNotebook(currentNotebookId, {
          transcript,
          topics,
          wordCount: transcript.split(/\s+/).filter(Boolean).length,
          title: topics[0]?.title || notebookTitle,
        });
      } else {
        const nb = createNotebook(transcript, topics, 'text');
        setCurrentNotebookId(nb.id);
        setNotebookTitle(nb.title);
        router.replace(`/learn?id=${nb.id}`, { scroll: false });
      }
    }, 1500);
    return () => clearTimeout(saveTimer);
  }, [transcript, topics, currentNotebookId, notebookTitle, router]);

  useEffect(() => {
    isHandsFreeRef.current = isHandsFree;
  }, [isHandsFree]);

  const stopActiveAudio = useCallback(() => {
    if (currentSequenceRef.current) {
      currentSequenceRef.current.abort();
      currentSequenceRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setActivePlayingMessageId(null);
  }, []);

  const handleTogglePlayPause = () => {
    const seq = currentSequenceRef.current;
    if (!seq) return;
    if (seq.isPaused()) {
      seq.resume();
      setIsPaused(false);
    } else {
      seq.pause();
      setIsPaused(true);
    }
  };

  const playAudioChunks = (chunks: string[], messageId: string | null = null) => {
    if (!chunks || chunks.length === 0) return;
    stopActiveAudio();
    setIsPlaying(true);
    setIsPaused(false);
    setActivePlayingMessageId(messageId);
    const seq = playChunkSequence(chunks, {
      onEnd: () => {
        setIsPlaying(false);
        setIsPaused(false);
        setActivePlayingMessageId(null);
      },
    });
    currentSequenceRef.current = seq;
  };

  const startRecording = async () => {
    if (!transcript) {
      alert("Load a video or paste a transcript first. Acharya needs something to learn from.");
      return;
    }
    if (isRecording || isProcessing) return;

    stopActiveAudio();
    isRecordingFromHandsFreeRef.current = false; // Mark manual session

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Could not access microphone. Please check your permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const startRecordingFromHandsFree = (stream: MediaStream) => {
    // Hard guards: never start a VAD recording if hands-free has been turned off,
    // or if any other recording / processing is in flight.
    if (!isHandsFreeRef.current) return;
    if (!transcript) return;
    if (isRecording || isProcessing) return;

    stopActiveAudio();
    isRecordingFromHandsFreeRef.current = true; // Mark hands-free session

    try {
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Cleanup-initiated abort (hands-free was just toggled off).
        if (discardNextRecordingRef.current) {
          discardNextRecordingRef.current = false;
          isRecordingFromHandsFreeRef.current = false;
          setIsRecording(false);
          return;
        }
        // Discard if hands-free mode was disabled during recording.
        if (isRecordingFromHandsFreeRef.current && !isHandsFreeRef.current) {
          isRecordingFromHandsFreeRef.current = false;
          setIsRecording(false);
          return;
        }
        isRecordingFromHandsFreeRef.current = false;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting hands free recorder:", error);
    }
  };

  // Sync state values to refs for the background loop to prevent stale closures and restarts
  const isRecordingRef = useRef(isRecording);
  const isProcessingRef = useRef(isProcessing);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Hands-Free VAD (Voice Activity Detection) Background Listener
  useEffect(() => {
    let animationFrameId: number;
    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let silenceStart: number | null = null;
    let speakingStart: number | null = null;
    let lastSpeechAt: number | null = null; // grace window so micro-gaps don't kill accumulation
    let localStream: MediaStream | null = null;

    if (!isHandsFree) {
      if (handsFreeStreamRef.current) {
        handsFreeStreamRef.current.getTracks().forEach(track => track.stop());
        handsFreeStreamRef.current = null;
      }
      return;
    }

    const startBackgroundListening = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        handsFreeStreamRef.current = stream;
        localStream = stream;

        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkAudio = () => {
          if (!analyser) return;
          // Defensive: hands-free may have been toggled off between frames.
          // Bail out immediately and stop scheduling further frames.
          if (!isHandsFreeRef.current) return;

          // Note: we intentionally do NOT bail when Acharya is speaking. The
          // user's voice has to be able to interrupt playback (see the
          // isSpeechDetected branch below). We bump the detection threshold
          // higher during playback to filter out speaker spillover instead.

          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;

          // Adaptive VAD threshold: raise threshold if tutor is playing audio to prevent acoustic feedback/self-interruption
          const threshold = isPlayingRef.current ? 26 : 14;
          const isSpeechDetected = average > threshold;

          const now = Date.now();
          if (isSpeechDetected) {
            silenceStart = null;
            lastSpeechAt = now;

            // 1. Interrupt TTS instantly if user starts speaking
            if (isPlayingRef.current && currentSequenceRef.current) {
              stopActiveAudio();
            }

            // 2. Start recording if we are currently idle. Accumulate 180ms
            //    of continuous speech to filter out clicks and pops.
            if (!isRecordingRef.current && !isProcessingRef.current) {
              if (!speakingStart) {
                speakingStart = now;
              } else if (now - speakingStart > 180) {
                startRecordingFromHandsFree(stream);
              }
            }
          } else {
            // Don't blank speakingStart on every silent frame. Allow up to
            // 250ms of micro-gap between syllables so quiet breathing or
            // brief pauses don't kill the accumulation window.
            if (speakingStart && lastSpeechAt && now - lastSpeechAt > 250) {
              speakingStart = null;
            }

            // 3. Silence detection: stop recording after 2.5s of silence.
            //    Bumped from 1.6s because natural thinking pauses
            //    ("hmm... so... why does...") were truncating recordings.
            if (isRecordingRef.current) {
              if (!silenceStart) {
                silenceStart = now;
              } else if (now - silenceStart > 2500) {
                stopRecording();
                silenceStart = null;
                speakingStart = null;
                lastSpeechAt = null;
              }
            }
          }

          animationFrameId = requestAnimationFrame(checkAudio);
        };

        checkAudio();
      } catch (err) {
        console.error("Error in hands-free VAD:", err);
        setIsHandsFree(false);
      }
    };

    startBackgroundListening();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (source) source.disconnect();
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
      // If a VAD-triggered recording is in flight, stop it and discard its audio.
      // Without this, the recorder can dribble on after the stream's tracks stop
      // and eventually fire onstop with stale state, kicking off transcription.
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === 'recording' &&
        isRecordingFromHandsFreeRef.current
      ) {
        discardNextRecordingRef.current = true;
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
        setIsRecording(false);
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isHandsFree, transcript]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isHandsFree) return;
      
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      );
      
      if (e.code === 'Space' && !isTyping) {
        e.preventDefault();
        if (e.repeat) return;
        startRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isHandsFree) return;
      
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      );

      if (e.code === 'Space' && !isTyping) {
        e.preventDefault();
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [transcript, isRecording, isPlaying, isProcessing, isHandsFree]);

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    stopActiveAudio();

    const userMsgId = Date.now().toString() + '-u';
    const tutorMsgId = Date.now().toString() + '-t';

    // Phase 1: Show user bubble immediately with a transcribing placeholder
    setProcessingPhase('transcribing');
    addMessage({ id: userMsgId, role: 'user', text: '', phase: 'transcribing' });

    try {
      const sttForm = new FormData();
      sttForm.append('audio', audioBlob, 'audio.webm');
      const sttRes = await fetch('/api/tutor/stt', { method: 'POST', body: sttForm });
      if (!sttRes.ok) {
        const err = await sttRes.json().catch(() => ({ error: 'STT failed' }));
        throw new Error(err.error || 'STT failed');
      }
      const sttData = await sttRes.json();
      const userMessage: string = sttData.userMessage;
      const detectedLanguage: string | null = typeof sttData.languageCode === 'string' ? sttData.languageCode : null;
      if (!userMessage) throw new Error('Could not transcribe your audio');

      updateMessage(userMsgId, { text: userMessage, phase: undefined });

      // Phase 2: Retrieval (client side, fast but worth signalling)
      if (!lessonRag.ready) {
        throw new Error(lessonRag.error || 'Lesson is still indexing. One moment.');
      }
      setProcessingPhase('searching');
      addMessage({
        id: tutorMsgId,
        role: 'tutor',
        text: '',
        audioChunks: [],
        phase: 'searching',
      });
      const retrieval = await lessonRag.runRetrieval(userMessage);
      if (!retrieval) throw new Error('Retrieval failed');
      updateMessage(tutorMsgId, { groundingConfidence: retrieval.groundingConfidence });

      // Phase 3: LLM request out, waiting for first token
      setProcessingPhase('thinking');
      updateMessage(tutorMsgId, { phase: 'thinking' });

      const history = messages
        .filter(m => m.text)
        .map(m => ({
          role: m.role === 'tutor' ? ('assistant' as const) : ('user' as const),
          content: m.text,
        }));

      const chatRes = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage,
          chunks: retrieval.chunks.map(c => ({ index: c.index, text: c.text, startMs: c.startMs, endMs: c.endMs })),
          history,
          groundingConfidence: retrieval.groundingConfidence,
          languageCode: detectedLanguage,
        }),
      });
      if (!chatRes.ok || !chatRes.body) {
        throw new Error('Chat stream failed');
      }

      const sequence = new AudioSequence({
        onPlay: () => {
          setIsPlaying(true);
          setActivePlayingMessageId(tutorMsgId);
          setProcessingPhase('speaking');
          updateMessage(tutorMsgId, { phase: 'speaking' });
        },
        onEnd: () => {
          setIsPlaying(false);
          setIsPaused(false);
          setActivePlayingMessageId(null);
          updateMessage(tutorMsgId, { phase: undefined });
        },
      });
      currentSequenceRef.current = sequence;

      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullText = '';
      let firstTokenSeen = false;
      const accumulatedAudio: string[] = [];
      let enqueueChain: Promise<void> = Promise.resolve();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';
        for (const evt of events) {
          const lines = evt.split('\n');
          let eventName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload: { delta?: string; text?: string; message?: string };
          try { payload = JSON.parse(dataStr); } catch { continue; }

          if (eventName === 'token' && typeof payload.delta === 'string') {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              setProcessingPhase('streaming');
              updateMessage(tutorMsgId, { phase: 'streaming' });
            }
            fullText += payload.delta;
            updateMessage(tutorMsgId, { text: fullText });
          } else if (eventName === 'sentence' && typeof payload.text === 'string') {
            const sentence = payload.text;
            const ttsPromise = fetchTtsAudios(sentence, detectedLanguage);
            enqueueChain = enqueueChain.then(async () => {
              const audios = await ttsPromise;
              for (const b64 of audios) {
                sequence.enqueue(b64);
                accumulatedAudio.push(b64);
              }
              updateMessage(tutorMsgId, { audioChunks: [...accumulatedAudio] });
            });
          } else if (eventName === 'error') {
            throw new Error(payload.message || 'Stream error');
          }
        }
      }

      await enqueueChain;
      // If audio is still pending or playing, the sequence's onPlay/onEnd will manage the phase
      if (accumulatedAudio.length === 0) {
        updateMessage(tutorMsgId, { phase: undefined });
      }
      await sequence.finalize();
    } catch (error: unknown) {
      console.error('Error processing audio:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      updateMessage(userMsgId, { phase: undefined });
      updateMessage(tutorMsgId, { phase: undefined });
      alert('Something went wrong talking to Acharya: ' + message);
    } finally {
      setIsProcessing(false);
      setProcessingPhase(null);
    }
  };

  const handleExtractTopics = async (forcedTranscript?: string) => {
    const activeTranscript = typeof forcedTranscript === 'string' ? forcedTranscript : transcript;
    if (!activeTranscript) return;
    setIsExtractingTopics(true);
    try {
      const res = await fetch('/api/tutor/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: activeTranscript }),
      });
      const data = await res.json();
      if (data.topics) {
        setTopics(data.topics);
        // Persist topics + summaries immediately. The auto-save effect is
        // debounced 1500ms and the user could refresh before it fires,
        // losing the freshly-fetched summaries.
        const nbId = currentNotebookIdRef.current;
        if (nbId) {
          updateNotebook(nbId, {
            topics: data.topics,
            title: data.topics[0]?.title || notebookTitle,
          });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsExtractingTopics(false);
    }
  };

  // Helper to convert AudioBuffer to a WAV blob in browser
  const bufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };

    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // chunk length
    setUint16(1); // sample format (raw PCM)
    setUint16(numOfChan); // channel count
    setUint32(buffer.sampleRate); // sample rate
    setUint32(buffer.sampleRate * numOfChan * 2); // byte rate
    setUint16(numOfChan * 2); // block align
    setUint16(16); // bits per sample
    setUint32(0x61746164); // "data" chunk
    setUint32(buffer.length * numOfChan * 2); // chunk length

    for (i = 0; i < numOfChan; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([bufferArr], { type: 'audio/wav' });
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsTranscribing(true);
    setTranscriptionProgress("Reading file");

    try {
      // Decode the uploaded file using Web Audio API to handle slicing
      setTranscriptionProgress("Optimizing audio");
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const rawAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      // Downsample to 16kHz mono to drastically reduce WAV payload size and avoid Vercel 4.5MB limit
      const TARGET_SAMPLE_RATE = 16000;
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
        1, // mono
        rawAudioBuffer.duration * TARGET_SAMPLE_RATE,
        TARGET_SAMPLE_RATE
      );
      
      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = rawAudioBuffer;
      sourceNode.connect(offlineCtx.destination);
      sourceNode.start();
      
      const audioBuffer = await offlineCtx.startRendering();
      
      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const chunkSizeSeconds = 25; // Slice into 25s chunks to remain fully under Sarvam's 30s limit
      const totalChunks = Math.ceil(duration / chunkSizeSeconds);
      
      let fullTranscript = '';
      
      for (let i = 0; i < totalChunks; i++) {
        const startFrame = i * chunkSizeSeconds * sampleRate;
        const endFrame = Math.min(audioBuffer.length, (i + 1) * chunkSizeSeconds * sampleRate);
        const chunkLength = endFrame - startFrame;
        
        setTranscriptionProgress(`Transcribing ${i + 1}/${totalChunks}`);
        
        // Create an AudioBuffer for this segment using the open audioCtx
        const chunkBuffer = audioCtx.createBuffer(
          audioBuffer.numberOfChannels,
          chunkLength,
          sampleRate
        );
        
        // Copy segment channel data
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          const chunkChannelData = chunkBuffer.getChannelData(channel);
          const slice = channelData.subarray(startFrame, endFrame);
          chunkChannelData.set(slice);
        }
        
        // Encode chunk to standard WAV
        const wavBlob = bufferToWav(chunkBuffer);
        const chunkFile = new File([wavBlob], `chunk-${i}.wav`, { type: 'audio/wav' });
        
        // Upload chunk to STT API
        const formData = new FormData();
        formData.append('file', chunkFile);
        
        const res = await fetch('/api/tutor/transcribe', {
          method: 'POST',
          body: formData,
        });
        
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Failed to transcribe segment ${i + 1}: ${errText || 'Transcription failed'}`);
        }
        
        const data = await res.json();
        if (data.transcript) {
          // Format with timestamps [MM:SS]
          const minutes = Math.floor((i * chunkSizeSeconds) / 60);
          const seconds = Math.floor((i * chunkSizeSeconds) % 60);
          const timestamp = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
          fullTranscript += `${timestamp} ${data.transcript}\n`;
        }
      }
      
      audioCtx.close();
      
      if (!fullTranscript.trim()) {
        throw new Error('Transcription completed but resulted in empty text.');
      }
      
      setTranscriptionProgress("Extracting topics");
      const finalTranscript = fullTranscript;
      setTranscript(finalTranscript);
      handleExtractTopics(finalTranscript);

      // Save or create notebook
      if (currentNotebookId) {
        updateNotebook(currentNotebookId, { transcript: finalTranscript, source: 'file', wordCount: finalTranscript.split(/\s+/).filter(Boolean).length });
      } else {
        const nb = createNotebook(finalTranscript, [], 'file');
        setCurrentNotebookId(nb.id);
        router.replace(`/learn?id=${nb.id}`, { scroll: false });
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error transcribing the media file. Please make sure the uploaded file contains a valid audio track.');
    } finally {
      setIsTranscribing(false);
      setTranscriptionProgress('');
    }
  };

  const handleFetchYoutube = async () => {
    if (!youtubeUrl) return;
    setIsFetchingYoutube(true);
    try {
      const res = await fetch('/api/tutor/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(errorData.error || 'Failed to fetch YouTube transcript');
      }

      const data = await res.json();
      if (data.transcript) {
        const incomingSegments: NotebookSegment[] | undefined = Array.isArray(data.segments) ? data.segments : undefined;
        setTranscript(data.transcript);
        setSegments(incomingSegments);
        handleExtractTopics(data.transcript);
        if (currentNotebookId) {
          updateNotebook(currentNotebookId, {
            transcript: data.transcript,
            segments: incomingSegments,
            source: 'youtube',
            sourceUrl: youtubeUrl,
            wordCount: data.transcript.split(/\s+/).filter(Boolean).length,
          });
        } else {
          const nb = createNotebook(data.transcript, [], 'youtube', youtubeUrl, incomingSegments);
          setCurrentNotebookId(nb.id);
          router.replace(`/learn?id=${nb.id}`, { scroll: false });
        }
        setYoutubeUrl('');
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error fetching YouTube transcript.');
    } finally {
      setIsFetchingYoutube(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!transcript) return;
    setIsGeneratingQuiz(true);
    setQuizActive(true);
    setSelectedQuizOption(null);
    setCurrentQuizIndex(0);
    setQuizScore(0);
    setQuizData(null);
    try {
      const res = await fetch('/api/tutor/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, history: messages }),
      });
      const data = await res.json();
      if (data.quiz) {
        setQuizData(Array.isArray(data.quiz) ? data.quiz : [data.quiz]);
      }
    } catch (e) {
      console.error(e);
      setQuizActive(false);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleNextQuizQuestion = () => {
    setSelectedQuizOption(null);
    setCurrentQuizIndex((prev) => prev + 1);
  };

  const handleSelectQuizOption = (index: number) => {
    if (selectedQuizOption !== null || !quizData) return;
    setSelectedQuizOption(index.toString());
    const currentQuestion = quizData[currentQuizIndex];
    if (index === currentQuestion?.correctOptionIndex) {
      setQuizScore((prev) => prev + 1);
    }
  };

  return (
    <div className="flex h-dvh bg-white text-slate-900 overflow-hidden font-sans antialiased">
      
      {/* Mobile Sidebar Backdrop */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR - drawer on mobile, fixed on desktop */}
      <aside className={`
        fixed md:relative inset-y-0 left-0 z-50 md:z-30
        w-80 bg-slate-50 border-r border-slate-200 flex flex-col shrink-0
        transition-transform duration-300 ease-in-out
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <span className="text-xl font-black tracking-tight text-slate-900">
              acharya
            </span>
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(false)}
              title="Close sidebar"
              aria-label="Close sidebar"
              className="md:hidden p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
                Add your lesson
              </label>
              
              {/* Media Uploader */}
              <input 
                type="file" 
                accept="audio/*,video/*" 
                onChange={handleMediaUpload} 
                className="hidden" 
                ref={fileInputRef}
                disabled={isTranscribing || isFetchingYoutube}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full h-10 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium justify-center rounded-md shadow-sm transition-all min-w-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isTranscribing || isFetchingYoutube}
              >
                {isTranscribing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin text-slate-600 shrink-0" />
                ) : (
                  <Upload className="w-3.5 h-3.5 mr-2 text-slate-600 shrink-0" />
                )}
                <span className="truncate">
                  {isTranscribing ? transcriptionProgress : "Upload a video or audio file"}
                </span>
              </Button>
            </div>

            {/* YouTube Ingestion */}
            <div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input 
                    placeholder="Or paste a YouTube link..." 
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && youtubeUrl && !isFetchingYoutube && !isTranscribing) {
                        e.preventDefault();
                        handleFetchYoutube();
                      }
                    }}
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 shadow-sm"
                    disabled={isFetchingYoutube || isTranscribing}
                  />
                  <Video className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3.5" />
                </div>
                <Button 
                  type="button" 
                  className="h-10 bg-slate-950 hover:bg-slate-900 text-white rounded-md text-xs font-semibold shadow-sm transition-all px-3.5"
                  onClick={handleFetchYoutube}
                  disabled={!youtubeUrl || isFetchingYoutube || isTranscribing}
                >
                  {isFetchingYoutube ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Load"
                  )}
                </Button>
              </div>
            </div>

            {/* Paste Transcript */}
            <Textarea 
              placeholder="Or paste your transcript / notes here..." 
              className="h-28 resize-none bg-white border border-slate-200 focus:border-slate-400 text-xs text-slate-800 placeholder:text-slate-400 shadow-sm rounded-md"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />
            
            <Button 
              className="w-full h-10 bg-[#cfff00] hover:bg-[#bce600] text-slate-950 font-bold text-xs rounded-md shadow-sm border border-slate-300/20"
              onClick={() => handleExtractTopics()}
              disabled={!transcript || isExtractingTopics || isTranscribing}
            >
              {isExtractingTopics ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-2" />}
              Extract Topics
            </Button>
          </div>
        </div>

        {/* Dynamic Concept Cards */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {topics.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3">
                What&apos;s in this video
              </span>
              <div className="space-y-1.5">
                {topics.map((topic, i) => {
                  const hasSummary = !!topic.summary;
                  const expanded = expandedTopicIndex === i;
                  return (
                    <div
                      key={i}
                      className={`bg-white border rounded-md shadow-sm transition-all ${
                        expanded ? 'border-slate-300' : 'border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => hasSummary && setExpandedTopicIndex(expanded ? null : i)}
                        className={`w-full text-left text-xs p-3 text-slate-800 font-medium flex items-center gap-2 ${
                          hasSummary ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                        }`}
                        aria-expanded={hasSummary ? expanded : undefined}
                      >
                        <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[#cfff00] border border-slate-800/20" />
                        <span className="flex-1 leading-snug">{topic.title}</span>
                        {hasSummary && (
                          <ChevronLeft
                            className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${
                              expanded ? '-rotate-90' : 'rotate-180'
                            }`}
                          />
                        )}
                      </button>
                      {hasSummary && expanded && (
                        <div className="px-3 pb-3 -mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {topic.summary}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CHAT AREA - Dot Grid & Pure White Cards */}
      <main className="flex-1 flex flex-col h-full bg-slate-50/50 relative" style={{
        backgroundImage: 'radial-gradient(#e2e8f0 1.5px, transparent 1.5px)',
        backgroundSize: '20px 20px'
      }}>
        
        {/* Header - Minimalist */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center px-4 md:px-6 justify-between shrink-0 z-10">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile: hamburger to open source sidebar */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              title="Open sidebar"
              aria-label="Open sidebar"
              className="md:hidden p-2 -ml-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => router.push('/')}
              title="Back to all lessons"
              className="hidden md:flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors text-xs font-medium cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>All lessons</span>
            </button>
            <div className="hidden md:block w-px h-4 bg-slate-200" />
            <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="line-clamp-1 max-w-[140px] md:max-w-none">{notebookTitle}</span>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Grounded in your video
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={() => router.push('/')}
              title="Back to all lessons"
              aria-label="Back to all lessons"
              className="md:hidden p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <Button 
              variant="outline" 
              onClick={handleGenerateQuiz}
              disabled={!transcript || isGeneratingQuiz}
              className="h-9 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold shadow-sm"
            >
              {isGeneratingQuiz ? <Loader2 className="w-3.5 h-3.5 mr-0 md:mr-2 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5 mr-0 md:mr-2" />}
              <span className="hidden md:inline">Quiz me</span>
            </Button>
          </div>
        </header>

        {/* Scroll Thread */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col relative">
            <div 
              className="flex-1 overflow-y-auto p-8 space-y-6" 
              ref={chatScrollContainerRef}
            >
              <div
                className="max-w-3xl mx-auto space-y-6"
                style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom))' }}
              >
                {messages.length === 0 ? (
                  <div className="h-[65vh] flex flex-col items-center justify-center text-center space-y-6 max-w-lg mx-auto">
                    <div className="w-16 h-16 bg-white rounded-xl border border-slate-200 flex items-center justify-center shadow-sm mb-2">
                      <BookOpen className="w-7 h-7 text-slate-900" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl md:text-2xl font-extrabold tracking-tight text-slate-900">
                        What do you want to learn today?
                      </h3>
                      <p className="text-sm md:text-base text-slate-500 max-w-md mx-auto leading-relaxed">
                        Paste a YouTube link or upload a lecture. Then just ask. Acharya has watched it for you.
                      </p>
                      <Button 
                        className="md:hidden mt-6 h-10 px-6 bg-[#cfff00] hover:bg-[#bce600] text-slate-950 font-bold text-sm rounded-xl shadow-sm border border-slate-300/20"
                        onClick={() => setIsMobileSidebarOpen(true)}
                      >
                        Add a video
                      </Button>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="space-y-1">
                      {/* Message Container - Card Style */}
                      <div className={`p-5 rounded-lg border shadow-sm transition-all ${
                        msg.role === 'user' 
                          ? 'bg-slate-100/70 border-slate-200 text-slate-900' 
                          : 'bg-white border-slate-200 text-slate-900 relative'
                      }`}>
                        {/* Role tag */}
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            {msg.role === 'user' ? (
                              <>
                                <User className="w-3 h-3 text-slate-600" /> You
                              </>
                            ) : (
                              <>
                                <span className="w-1.5 h-1.5 rounded-full bg-[#cfff00] border border-slate-400/30" /> Acharya
                              </>
                            )}
                          </span>
                          {msg.phase && msg.text && msg.phase !== 'streaming' && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-60"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-slate-500"></span>
                              </span>
                              {phaseLabel(msg.phase)}
                            </span>
                          )}
                        </div>

                        {msg.phase && !msg.text ? (
                          <div className="flex items-center gap-2 py-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />
                            <span className="text-xs md:text-sm text-slate-500 font-medium">
                              {phaseLabel(msg.phase)}…
                            </span>
                            <span className="flex gap-1 ml-1">
                              <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '0ms' }} />
                              <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '200ms' }} />
                              <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: '400ms' }} />
                            </span>
                          </div>
                        ) : (
                          <p className={`text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-medium ${
                            msg.role === 'user' ? 'text-slate-900' : 'text-slate-800'
                          }`}>
                            {msg.text}
                            {msg.phase === 'streaming' && (
                              <span className="inline-block w-1.5 h-4 ml-0.5 bg-slate-400 animate-pulse align-middle" />
                            )}
                          </p>
                        )}

                        {/* Playback controls */}
                        {msg.role === 'tutor' && (
                          <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center gap-2">
                            {msg.id === activePlayingMessageId ? (
                              <>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 border border-slate-200 hover:bg-slate-50 text-slate-800 text-[10px] font-bold rounded flex items-center"
                                  onClick={handleTogglePlayPause}
                                >
                                  {isPaused ? (
                                    <>
                                      <Play className="w-3 h-3 mr-1.5 text-slate-900" />
                                      Resume
                                    </>
                                  ) : (
                                    <>
                                      <Pause className="w-3 h-3 mr-1.5 text-slate-900" />
                                      Pause
                                    </>
                                  )}
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 border border-red-200 hover:bg-red-50 text-red-600 hover:text-red-700 text-[10px] font-bold rounded flex items-center"
                                  onClick={stopActiveAudio}
                                >
                                  <Square className="w-3 h-3 mr-1.5" />
                                  Stop
                                </Button>
                              </>
                            ) : (
                              msg.audioChunks && msg.audioChunks.length > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 border border-slate-200 hover:bg-slate-50 text-slate-800 text-[10px] font-bold rounded flex items-center"
                                  onClick={() => playAudioChunks(msg.audioChunks!, msg.id)}
                                >
                                  <Volume2 className="w-3 h-3 mr-1.5" />
                                  Listen
                                </Button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {lessonRag.error && (
                  <div className="p-4 rounded-lg border border-red-200 bg-red-50 shadow-sm text-[11px] text-red-800">
                    <span className="font-semibold">Indexing failed:</span> {lessonRag.error}
                  </div>
                )}
              </div>
            </div>

            {/* FLOATING CONTROLLER PILL */}
            <div
              className="absolute md:bottom-6 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-2rem)] md:w-auto md:min-w-[380px] max-w-[460px]"
              style={{ bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 1rem))' }}
            >
              {(() => {
                if (lessonRag.error && transcript && !lessonRag.ready) {
                  return (
                    <div className="bg-red-950 text-red-50 py-3 px-4 rounded-2xl shadow-lg border border-red-900 w-full">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                        <span className="text-xs font-bold">Indexing failed</span>
                      </div>
                      <div className="mt-1.5 text-[11px] text-red-200 break-words">
                        {lessonRag.error}
                      </div>
                      <div className="mt-2 text-[10px] text-red-300">
                        Open the browser console for details, then reload the lesson to retry.
                      </div>
                    </div>
                  );
                }
                const indexing = indexingView();
                if (indexing && !lessonRag.ready) {
                  return (
                    <div className="bg-slate-950 text-white py-3 px-4 rounded-2xl shadow-lg border border-slate-800 w-full">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#cfff00] shrink-0" />
                        <span className="text-xs font-bold truncate">{indexing.headline}</span>
                        {indexing.percent != null && (
                          <span className="ml-auto text-[10px] text-slate-300 font-mono tabular-nums shrink-0">
                            {indexing.percent.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-[#cfff00] transition-all duration-200 ${indexing.percent == null ? 'animate-pulse w-1/3' : ''}`}
                          style={indexing.percent != null ? { width: `${Math.min(100, indexing.percent)}%` } : undefined}
                        />
                      </div>
                      <div className="mt-1.5 text-[10px] text-slate-400 truncate">
                        {indexing.detail || 'Cached after this.'}
                      </div>
                    </div>
                  );
                }
                const buttonState: 'recording' | 'processing' | 'speaking' | 'idle' =
                  isRecording ? 'recording'
                  : isProcessing ? 'processing'
                  : isPlaying ? 'speaking'
                  : 'idle';
                const lessonNotReady = !!transcript && !lessonRag.ready;
                const primaryDisabled =
                  buttonState === 'processing' ||
                  lessonNotReady ||
                  (isHandsFree && buttonState === 'idle');
                const primaryClass =
                  buttonState === 'recording'
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.25)]'
                    : primaryDisabled
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-[#cfff00] hover:bg-[#bce600] text-slate-950';
                const primaryOnClick = isRecording ? stopRecording : startRecording;
                const statusLine =
                  buttonState === 'recording' ? 'Listening to you'
                  : buttonState === 'processing' ? (phaseLabel(processingPhase) || 'Working')
                  : buttonState === 'speaking' ? 'Acharya is speaking'
                  : isHandsFree ? 'Hands-free is on'
                  : lessonNotReady ? 'Preparing this lesson'
                  : 'Tap to talk';
                const statusColor =
                  buttonState === 'recording' ? 'text-red-400'
                  : buttonState === 'speaking' ? 'text-slate-200'
                  : isHandsFree ? 'text-[#cfff00]'
                  : 'text-slate-300';
                const showLiveDot = buttonState === 'recording' || (isHandsFree && buttonState === 'idle');
                return (
                  <div className={`bg-slate-950 text-white py-2 pl-2 pr-2 md:py-2.5 md:pl-2.5 md:pr-3 rounded-full shadow-lg flex items-center gap-2.5 md:gap-3 border transition-all w-full ${
                    isHandsFree
                      ? 'border-[#cfff00]/60 shadow-[0_0_0_2px_rgba(207,255,0,0.15)]'
                      : 'border-slate-800'
                  }`}>
                    <Button
                      size="icon"
                      onClick={primaryOnClick}
                      disabled={primaryDisabled}
                      title={isRecording ? 'Stop recording' : 'Tap to talk'}
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                      className={`w-11 h-11 md:w-12 md:h-12 rounded-full shrink-0 flex items-center justify-center transition-all duration-200 ${primaryClass}`}
                    >
                      {buttonState === 'recording' ? <Square className="w-4 h-4 md:w-5 md:h-5" />
                        : buttonState === 'processing' ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                        : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
                    </Button>

                    <div className="flex-1 min-w-0 select-none">
                      <div className={`text-xs md:text-sm font-semibold leading-tight flex items-center gap-1.5 ${statusColor}`}>
                        {showLiveDot && (
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-current"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current"></span>
                          </span>
                        )}
                        <span className="truncate">{statusLine}</span>
                      </div>
                      {buttonState === 'idle' && !isHandsFree && !lessonNotReady && (
                        <div className="text-[10px] text-slate-500 leading-tight mt-0.5 hidden sm:block">Or hold space</div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsHandsFree(!isHandsFree)}
                      disabled={isProcessing || lessonNotReady}
                      title={isHandsFree ? 'Turn off hands-free' : 'Turn on hands-free (Acharya hears you without tapping)'}
                      aria-label={isHandsFree ? 'Turn off hands-free' : 'Turn on hands-free'}
                      aria-pressed={isHandsFree}
                      className={`h-8 md:h-9 pl-2 pr-2.5 md:pl-2.5 md:pr-3 rounded-full flex items-center gap-1.5 shrink-0 cursor-pointer transition text-[10px] md:text-[11px] font-bold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed ${
                        isHandsFree
                          ? 'bg-[#cfff00] text-slate-950 hover:bg-[#bce600]'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                      }`}
                    >
                      <Headphones className="w-3.5 h-3.5 md:w-4 md:h-4" />
                      <span>Hands-free</span>
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* RIGHT SIDEBAR (Quiz) - Full screen overlay on mobile, sidebar on desktop */}
          {quizActive && (
            <aside className="fixed inset-0 z-50 md:relative md:inset-auto md:z-20 w-full md:w-96 bg-white border-l border-slate-200 flex flex-col transition-all shrink-0">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                <h3 className="font-bold text-slate-900 flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500">
                  <BrainCircuit className="w-3.5 h-3.5 text-slate-800" />
                  Quiz time
                </h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setQuizActive(false)}
                  className="h-8 w-8 p-0 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {isGeneratingQuiz ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-400 space-y-4">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-800" />
                    <p className="text-xs font-medium">Getting your questions ready...</p>
                  </div>
                ) : quizData ? (() => {
                  const isQuizFinished = currentQuizIndex >= quizData.length;
                  
                  if (isQuizFinished) {
                    return (
                      <div className="space-y-6 text-center py-8">
                        <div className="inline-flex p-4 bg-emerald-50 rounded-full text-emerald-600 mb-2">
                          <Trophy className="w-8 h-8" />
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-sm font-bold text-slate-950 uppercase tracking-widest">Quiz Completed!</h4>
                          <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                            Not bad! That's the whole quiz. See how you did below.
                          </p>
                        </div>
                        <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl inline-block min-w-[140px] shadow-sm">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Your score</span>
                          <span className="text-3xl font-black text-slate-950">{quizScore} / {quizData.length}</span>
                        </div>
                        <div className="flex gap-2 justify-center pt-4 border-t border-slate-100">
                          <Button 
                            size="sm" 
                            className="bg-slate-950 hover:bg-slate-900 text-white text-[10px] font-bold rounded shadow-sm px-5 h-9"
                            onClick={handleGenerateQuiz}
                          >
                            Try again
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="border border-slate-200 hover:bg-slate-50 text-slate-800 text-[10px] font-bold rounded px-5 h-9"
                            onClick={() => setQuizActive(false)}
                          >
                            Done
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  const currentQuestion = quizData[currentQuizIndex];
                  if (!currentQuestion) return null;

                  return (
                    <div className="space-y-6">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100/50 p-2 rounded border border-slate-200/60">
                        <span>Question {currentQuizIndex + 1} of {quizData.length}</span>
                        <span>Score: {quizScore}</span>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 p-4.5 rounded-lg text-slate-900 text-xs font-bold leading-relaxed shadow-sm">
                        {currentQuestion.question}
                      </div>

                      <RadioGroup 
                        value={selectedQuizOption || ""} 
                        onValueChange={(val) => handleSelectQuizOption(Number(val))} 
                        className="space-y-2.5"
                      >
                        {currentQuestion.options.map((option: string, index: number) => {
                          const isSelected = selectedQuizOption === index.toString();
                          const isCorrect = index === currentQuestion.correctOptionIndex;
                          const showResult = selectedQuizOption !== null;
                          
                          let borderClass = "border-slate-200";
                          let bgClass = "bg-white hover:bg-slate-50";
                          let textClass = "text-slate-800";
                          
                          if (showResult) {
                            if (isCorrect) {
                              borderClass = "border-emerald-500 bg-emerald-50/50";
                              textClass = "text-emerald-900 font-bold";
                            } else if (isSelected && !isCorrect) {
                              borderClass = "border-red-500 bg-red-50/50";
                              textClass = "text-red-900 font-bold";
                            } else {
                              bgClass = "opacity-50 grayscale";
                            }
                          }

                          return (
                            <Label 
                              key={index} 
                              htmlFor={`option-${index}`}
                              className={`flex items-start gap-3 p-4 rounded-lg border transition-all cursor-pointer ${borderClass} ${bgClass} ${textClass}`}
                            >
                              <RadioGroupItem 
                                value={index.toString()} 
                                id={`option-${index}`} 
                                className="mt-0.5"
                                disabled={showResult} 
                              />
                              <span className="text-xs font-medium leading-tight">
                                {option}
                              </span>
                            </Label>
                          );
                        })}
                      </RadioGroup>

                      {selectedQuizOption !== null && (
                        <div className={`p-4 rounded-lg text-xs font-semibold flex items-center justify-between border ${
                          Number(selectedQuizOption) === currentQuestion.correctOptionIndex 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          <span>
                            {Number(selectedQuizOption) === currentQuestion.correctOptionIndex 
                              ? "Correct!" 
                              : "Incorrect answer."}
                          </span>
                          
                          {currentQuizIndex < quizData.length - 1 ? (
                            <Button 
                              size="sm" 
                              className="bg-slate-950 hover:bg-slate-900 text-white text-[10px] font-bold rounded shadow-sm px-3.5 h-8 flex items-center gap-1"
                              onClick={handleNextQuizQuestion}
                            >
                              Next Question
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          ) : (
                            <Button 
                              size="sm" 
                              className="bg-slate-950 hover:bg-slate-900 text-white text-[10px] font-bold rounded shadow-sm px-3.5 h-8 flex items-center gap-1"
                              onClick={() => setCurrentQuizIndex(quizData.length)}
                            >
                              Finish & See Score
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })() : null}
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
