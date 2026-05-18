import { create } from 'zustand';

export type MessagePhase =
  | 'transcribing'
  | 'searching'
  | 'thinking'
  | 'streaming'
  | 'speaking';

export interface ChatMessage {
  id: string;
  role: 'user' | 'tutor';
  text: string;
  audioChunks?: string[];
  groundingConfidence?: 'high' | 'medium' | 'low';
  phase?: MessagePhase;
}

export interface Topic {
  title: string;
  summary?: string;
}

interface AppState {
  transcript: string;
  setTranscript: (text: string) => void;
  topics: Topic[];
  setTopics: (topics: Topic[]) => void;
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  quizActive: boolean;
  setQuizActive: (active: boolean) => void;
  quizData: any;
  setQuizData: (data: any) => void;
}

export const useAppStore = create<AppState>((set) => ({
  transcript: '',
  setTranscript: (text) => set({ transcript: text }),
  topics: [],
  setTopics: (topics) => set({ topics }),
  messages: [],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  clearMessages: () => set({ messages: [], quizActive: false, quizData: null }),
  quizActive: false,
  setQuizActive: (active) => set({ quizActive: active }),
  quizData: null,
  setQuizData: (data) => set({ quizData: data }),
}));
