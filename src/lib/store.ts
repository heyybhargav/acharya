import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'tutor';
  text: string;
  audioBase64?: string;
}

interface AppState {
  transcript: string;
  setTranscript: (text: string) => void;
  topics: string[];
  setTopics: (topics: string[]) => void;
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
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
  clearMessages: () => set({ messages: [], quizActive: false, quizData: null }),
  quizActive: false,
  setQuizActive: (active) => set({ quizActive: active }),
  quizData: null,
  setQuizData: (data) => set({ quizData: data }),
}));
