"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Notebook, getNotebooks, deleteNotebook, formatRelativeDate, createNotebook } from '@/lib/notebooks';
import { useAppStore } from '@/lib/store';
import { BookOpen, Plus, Trash2, Video, FileText, Clock, ChevronRight, Mic } from 'lucide-react';

const SOURCE_ICONS: Record<Notebook['source'], React.ReactNode> = {
  youtube: <Video className="w-3.5 h-3.5" />,
  file: <Mic className="w-3.5 h-3.5" />,
  text: <FileText className="w-3.5 h-3.5" />,
};

const SOURCE_LABELS: Record<Notebook['source'], string> = {
  youtube: 'YouTube',
  file: 'Uploaded file',
  text: 'Pasted text',
};

export default function HomePage() {
  const router = useRouter();
  const { setTranscript, setTopics, clearMessages } = useAppStore();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setNotebooks(getNotebooks());
  }, []);

  const handleOpenNotebook = (nb: Notebook) => {
    // Clear current session state before loading a different notebook
    clearMessages?.();
    router.push(`/learn?id=${nb.id}`);
  };

  const handleNewNotebook = () => {
    clearMessages?.();
    setTranscript('');
    setTopics([]);
    router.push('/learn');
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    setTimeout(() => {
      deleteNotebook(id);
      setNotebooks(getNotebooks());
      setDeletingId(null);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-slate-900">acharya</span>
          <button
            onClick={handleNewNotebook}
            className="flex items-center gap-2 h-9 px-4 bg-slate-950 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New notebook
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {notebooks.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center text-center py-24 space-y-8">
            <div className="w-20 h-20 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center shadow-sm">
              <BookOpen className="w-9 h-9 text-slate-400" />
            </div>
            <div className="space-y-2 max-w-sm">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Your notebooks live here</h2>
              <p className="text-slate-500 text-sm leading-relaxed">
                Each notebook is a video or lecture Acharya has learned from. You can ask questions, take quizzes, and revisit any time.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg mt-4">
              {[
                { icon: <Video className="w-4 h-4" />, label: "Paste a YouTube link" },
                { icon: <Mic className="w-4 h-4" />, label: "Upload a lecture video" },
                { icon: <FileText className="w-4 h-4" />, label: "Paste a transcript" },
              ].map(({ icon, label }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-2 p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-xs font-medium"
                >
                  {icon}
                  {label}
                </div>
              ))}
            </div>

            <button
              onClick={handleNewNotebook}
              className="flex items-center gap-2 h-11 px-8 bg-[#cfff00] hover:bg-[#bce600] text-slate-950 rounded-xl text-sm font-bold transition-all shadow-sm border border-slate-300/20 mt-2"
            >
              <Plus className="w-4 h-4" />
              Add your first video
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Your notebooks</h1>
              <p className="text-slate-500 text-sm mt-1">{notebooks.length} {notebooks.length === 1 ? 'notebook' : 'notebooks'} · pick up where you left off</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* New notebook card */}
              <button
                onClick={handleNewNotebook}
                className="group flex flex-col items-center justify-center gap-3 p-8 h-48 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-2xl transition-all text-slate-400 hover:text-slate-600"
              >
                <Plus className="w-7 h-7" />
                <span className="text-sm font-semibold">New notebook</span>
              </button>

              {/* Notebook cards */}
              {notebooks.map((nb) => (
                <div
                  key={nb.id}
                  onClick={() => handleOpenNotebook(nb)}
                  className={`group relative flex flex-col justify-between p-5 h-48 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer overflow-hidden ${deletingId === nb.id ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
                  style={{ transition: 'all 0.3s ease' }}
                >
                  {/* Source badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded-md">
                      {SOURCE_ICONS[nb.source]}
                      {SOURCE_LABELS[nb.source]}
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, nb.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Title */}
                  <div className="flex-1 py-3">
                    <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{nb.title}</h3>
                    {nb.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {nb.topics.slice(0, 2).map((t, i) => (
                          <span key={i} className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md line-clamp-1 max-w-[130px]">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                      <Clock className="w-3 h-3" />
                      {formatRelativeDate(nb.lastAccessedAt)}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {nb.wordCount.toLocaleString()} words
                    </span>
                  </div>

                  {/* Hover arrow */}
                  <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
