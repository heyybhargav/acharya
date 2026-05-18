"use client";

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { getNotebook, createNotebook, updateNotebook, Notebook } from '@/lib/notebooks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { 
  Mic, Square, BrainCircuit, FileText, Upload, 
  Volume2, User, Loader2, Video, BookOpen, Headphones, Trophy, ArrowRight, X, Play, Pause, ChevronLeft, Menu
} from 'lucide-react';

export default function LearnPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-slate-400 text-sm">Loading...</div>}>
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
    messages, addMessage, clearMessages,
    quizActive, setQuizActive, 
    quizData, setQuizData 
  } = useAppStore();

  const [currentNotebookId, setCurrentNotebookId] = useState<string | null>(notebookId);
  const [notebookTitle, setNotebookTitle] = useState<string>('New lesson');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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
  const [hasSubmittedQuizAnswer, setHasSubmittedQuizAnswer] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isFetchingYoutube, setIsFetchingYoutube] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const handsFreeStreamRef = useRef<MediaStream | null>(null);
  const isHandsFreeRef = useRef(isHandsFree);
  const isRecordingFromHandsFreeRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Auto-save notebook whenever transcript or topics change
  useEffect(() => {
    if (!transcript) return;
    const saveTimer = setTimeout(() => {
      if (currentNotebookId) {
        updateNotebook(currentNotebookId, {
          transcript,
          topics,
          wordCount: transcript.split(/\s+/).filter(Boolean).length,
          title: topics[0] || notebookTitle,
        });
      }
    }, 1500);
    return () => clearTimeout(saveTimer);
  }, [transcript, topics, currentNotebookId, notebookTitle]);

  useEffect(() => {
    isHandsFreeRef.current = isHandsFree;
  }, [isHandsFree]);

  const stopActiveAudio = () => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = "";
        currentAudioRef.current.load();
      } catch (e) {
        console.error("Error stopping active audio:", e);
      }
      currentAudioRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setActivePlayingMessageId(null);
  };

  const handleTogglePlayPause = () => {
    if (currentAudioRef.current) {
      if (isPaused) {
        currentAudioRef.current.play();
        setIsPaused(false);
      } else {
        currentAudioRef.current.pause();
        setIsPaused(true);
      }
    }
  };

  const startRecording = async () => {
    if (!transcript) {
      alert("Load a video or paste a transcript first — Acharya needs something to learn from!");
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

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecordingFromHandsFree = (stream: MediaStream) => {
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
        // Discard recording if hands-free mode was disabled during recording session
        if (isRecordingFromHandsFreeRef.current && !isHandsFreeRef.current) {
          isRecordingFromHandsFreeRef.current = false;
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

          // If Acharya is currently speaking/playing audio, ignore microphone VAD triggers
          // to prevent laptop speaker spillover/acoustic feedback from self-interrupting the playback!
          if (isPlayingRef.current) {
            animationFrameId = requestAnimationFrame(checkAudio);
            return;
          }

          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;

          // Adaptive VAD threshold: raise threshold if tutor is playing audio to prevent acoustic feedback/self-interruption
          const threshold = isPlayingRef.current ? 26 : 14;
          const isSpeechDetected = average > threshold;

          if (isSpeechDetected) {
            silenceStart = null; // Reset silence timer
            
            // 1. Interrupt TTS instantly if user starts speaking
            if (isPlayingRef.current && currentAudioRef.current) {
              stopActiveAudio();
            }

            // 2. Start recording if we are currently idle
            if (!isRecordingRef.current && !isProcessingRef.current) {
              if (!speakingStart) {
                speakingStart = Date.now();
              } else if (Date.now() - speakingStart > 180) { // Require continuous speech for 180ms to block sudden clicks/background pops
                startRecordingFromHandsFree(stream);
              }
            }
          } else {
            speakingStart = null;
            
            // 3. Silence Detection: Stop recording if we hear silence for > 1.6 seconds
            if (isRecordingRef.current) {
              if (!silenceStart) {
                silenceStart = Date.now();
              } else if (Date.now() - silenceStart > 1600) {
                stopRecording();
                silenceStart = null;
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
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('transcript', transcript);
      formData.append('history', JSON.stringify(messages));

      const res = await fetch('/api/tutor/voice', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Voice API failed' }));
        throw new Error(errData.error || 'Voice API failed');
      }

      const data = await res.json();
      
      if (data.userMessage) {
        addMessage({ id: Date.now().toString() + '-u', role: 'user', text: data.userMessage });
      }

      if (data.textResponse) {
        const newMessageId = Date.now().toString() + '-t';
        addMessage({ 
          id: newMessageId, 
          role: 'tutor', 
          text: data.textResponse,
          audioBase64: data.audioBase64 
        });

        if (data.audioBase64) {
          playAudioBase64(data.audioBase64, newMessageId);
        }
      }
    } catch (error: any) {
      console.error("Error processing audio:", error);
      alert("Something went wrong talking to Acharya: " + (error?.message || "Unknown error"));
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudioBase64 = (base64: string, messageId: string | null = null) => {
    try {
      stopActiveAudio();
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      currentAudioRef.current = audio;
      setIsPlaying(true);
      setIsPaused(false);
      setActivePlayingMessageId(messageId);

      audio.onended = () => {
        setIsPlaying(false);
        setIsPaused(false);
        setActivePlayingMessageId(null);
      };

      audio.play();
    } catch (err) {
      console.error("Error playing audio", err);
      setIsPlaying(false);
      setIsPaused(false);
      setActivePlayingMessageId(null);
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
      if (data.topics) setTopics(data.topics);
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
    setTranscriptionProgress("Reading file...");

    try {
      // Decode the uploaded file using Web Audio API to handle slicing
      setTranscriptionProgress("Loading media track for analysis...");
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      
      setTranscriptionProgress("Decoding audio track data...");
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const chunkSizeSeconds = 25; // Slice into 25s chunks to remain fully under Sarvam's 30s limit
      const totalChunks = Math.ceil(duration / chunkSizeSeconds);
      
      let fullTranscript = '';
      
      for (let i = 0; i < totalChunks; i++) {
        const startFrame = i * chunkSizeSeconds * sampleRate;
        const endFrame = Math.min(audioBuffer.length, (i + 1) * chunkSizeSeconds * sampleRate);
        const chunkLength = endFrame - startFrame;
        
        setTranscriptionProgress(`Transcribing block ${i + 1} of ${totalChunks} (${Math.round((i / totalChunks) * 100)}%)...`);
        
        // Create an AudioBuffer for this segment
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
      
      setTranscriptionProgress("Acharya is processing concepts...");
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
        setTranscript(data.transcript);
        handleExtractTopics(data.transcript);
        // Save or create notebook
        if (currentNotebookId) {
          updateNotebook(currentNotebookId, { transcript: data.transcript, source: 'youtube', sourceUrl: youtubeUrl, wordCount: data.transcript.split(/\s+/).filter(Boolean).length });
        } else {
          const nb = createNotebook(data.transcript, [], 'youtube', youtubeUrl);
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
    setHasSubmittedQuizAnswer(false);
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
    setHasSubmittedQuizAnswer(false);
    setCurrentQuizIndex((prev) => prev + 1);
  };

  const handleSelectQuizOption = (index: number) => {
    if (selectedQuizOption !== null || !quizData) return;
    setSelectedQuizOption(index.toString());
    const currentQuestion = quizData[currentQuizIndex];
    if (index === currentQuestion?.correctOptionIndex) {
      setQuizScore((prev) => prev + 1);
    }
    setHasSubmittedQuizAnswer(true);
  };

  return (
    <div className="flex h-screen bg-white text-slate-900 overflow-hidden font-sans antialiased">
      
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
              onClick={() => setIsMobileSidebarOpen(false)}
              className="md:hidden p-1 text-slate-400 hover:text-slate-700"
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
                className="w-full h-10 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium justify-center rounded-md shadow-sm transition-all"
                onClick={() => fileInputRef.current?.click()}
                disabled={isTranscribing || isFetchingYoutube}
              >
                {isTranscribing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin text-slate-600" />
                ) : (
                  <Upload className="w-3.5 h-3.5 mr-2 text-slate-600" />
                )}
                {isTranscribing ? transcriptionProgress : "Upload a video or audio file"}
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
                What's in this video
              </span>
              <div className="space-y-1.5">
                {topics.map((topic, i) => (
                  <div key={i} className="text-xs p-3 bg-white border border-slate-200 rounded-md text-slate-800 font-medium shadow-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#cfff00] border border-slate-800/20" />
                    {topic}
                  </div>
                ))}
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
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-2 -ml-1 text-slate-400 hover:text-slate-700"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={() => router.push('/')}
              className="hidden md:flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors text-xs font-medium"
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
              onClick={() => router.push('/')}
              className="md:hidden p-2 text-slate-400 hover:text-slate-700"
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
              <div className="max-w-3xl mx-auto space-y-6 pb-28">
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
                        Paste a YouTube link or upload a lecture. Then just ask — Acharya has watched it for you.
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
                        <div className="flex items-center justify-between mb-2">
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
                        </div>

                        <p className={`text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-medium ${
                          msg.role === 'user' ? 'text-slate-900' : 'text-slate-800'
                        }`}>
                          {msg.text}
                        </p>

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
                              msg.audioBase64 && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 border border-slate-200 hover:bg-slate-50 text-slate-800 text-[10px] font-bold rounded flex items-center"
                                  onClick={() => playAudioBase64(msg.audioBase64!, msg.id)}
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
                {isProcessing && (
                  <div className="p-5 rounded-lg border border-slate-200 bg-white shadow-sm flex items-center gap-2.5 text-xs text-slate-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-800" /> 
                    Thinking...
                  </div>
                )}
              </div>
            </div>

            {/* FLOATING CONTROLLER PILL */}
            <div className="absolute bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-2rem)] md:w-auto">
              <div className="bg-slate-950 text-white py-3 px-3 md:px-4 rounded-full shadow-lg flex items-center gap-2 md:gap-4 transition-all duration-300 w-full md:min-w-[340px] border border-slate-800">
                <Button
                  size="icon"
                  className={`w-10 h-10 rounded-full transition-all duration-200 relative shrink-0 ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 text-white' 
                      : 'bg-[#cfff00] hover:bg-[#bce600] text-slate-950'
                  }`}
                  onClick={toggleRecording}
                  disabled={isProcessing || isHandsFree}
                >
                  {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>

                {/* Hands-Free Mode Toggle */}
                <Button
                  size="icon"
                  className={`w-10 h-10 rounded-full transition-all duration-200 relative shrink-0 ${
                    isHandsFree 
                      ? 'bg-[#cfff00] hover:bg-[#bce600] text-slate-950' 
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                  }`}
                  onClick={() => setIsHandsFree(!isHandsFree)}
                  title={isHandsFree ? "Disable Hands-Free" : "Enable Hands-Free"}
                  disabled={isProcessing}
                >
                  <Headphones className="w-4 h-4" />
                </Button>

                {/* Floating Pill Playback Controls */}
                {isPlaying && (
                  <>
                    <Button
                      size="icon"
                      className="w-10 h-10 rounded-full bg-[#cfff00] hover:bg-[#bce600] text-slate-950 transition-all duration-200 shrink-0 flex items-center justify-center"
                      onClick={handleTogglePlayPause}
                      title={isPaused ? "Resume Acharya Voice" : "Pause Acharya Voice"}
                    >
                      {isPaused ? <Play className="w-4 h-4 text-slate-950" /> : <Pause className="w-4 h-4 text-slate-950" />}
                    </Button>
                    <Button
                      size="icon"
                      className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all duration-200 shrink-0 flex items-center justify-center"
                      onClick={stopActiveAudio}
                      title="Stop Acharya Voice"
                    >
                      <Square className="w-4 h-4" />
                    </Button>
                  </>
                )}

                <div className="text-xs font-semibold text-left select-none pr-2 md:pr-4 flex-1 min-w-0">
                  {isHandsFree ? (
                    <div className="flex flex-col">
                      <span className="text-[#cfff00] font-extrabold flex items-center gap-1.5 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#cfff00]"></span>
                        Listening...
                      </span>
                      <span className="text-slate-400 text-[10px] font-normal leading-tight hidden sm:block">Just talk — Acharya will hear you</span>
                    </div>
                  ) : isRecording ? (
                    <div className="flex items-center gap-2 text-red-400">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                      <span>Recording...</span>
                    </div>
                  ) : (
                    <span className="text-slate-300 truncate">
                      {isProcessing ? "On it..." : <><span className="hidden sm:inline">Hold space or </span>Tap to talk</>}
                    </span>
                  )}
                </div>
              </div>
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
