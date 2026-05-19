// Notebook persistence via localStorage.
// No database needed; all session data lives in the browser.

export interface NotebookSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface NotebookTopic {
  title: string;
  summary?: string;
}

export interface Notebook {
  id: string;
  title: string;          // Derived from first topic or source URL
  source: 'youtube' | 'file' | 'text';
  sourceUrl?: string;     // YouTube URL if applicable
  transcript: string;
  segments?: NotebookSegment[]; // present when source provides timestamps (YouTube)
  topics: NotebookTopic[];
  createdAt: string;
  lastAccessedAt: string;
  wordCount: number;
}

export function normalizeTopics(raw: unknown): NotebookTopic[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item === 'string') return { title: item };
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const title = typeof obj.title === 'string' ? obj.title : String(obj.title ?? '');
      const summary = typeof obj.summary === 'string' ? obj.summary : undefined;
      if (title) return { title, summary };
    }
    return { title: String(item ?? '') };
  }).filter(t => t.title.length > 0);
}

const STORAGE_KEY = 'acharya_notebooks';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function getNotebooks(): Notebook[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.map((nb) => {
      const n = nb as Notebook;
      return { ...n, topics: normalizeTopics(n.topics) };
    });
  } catch {
    return [];
  }
}

export function getNotebook(id: string): Notebook | null {
  const notebooks = getNotebooks();
  return notebooks.find(nb => nb.id === id) || null;
}

export function saveNotebook(notebook: Notebook): Notebook {
  const notebooks = getNotebooks();
  const existing = notebooks.findIndex(nb => nb.id === notebook.id);
  if (existing >= 0) {
    notebooks[existing] = { ...notebook, lastAccessedAt: new Date().toISOString() };
  } else {
    notebooks.unshift(notebook);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebooks));
  } catch {
    console.warn('localStorage full, notebooks not saved');
  }
  return notebook;
}

export function createNotebook(
  transcript: string,
  topics: NotebookTopic[],
  source: Notebook['source'],
  sourceUrl?: string,
  segments?: NotebookSegment[],
): Notebook {
  const title = topics[0]?.title || (sourceUrl ? new URL(sourceUrl).hostname : 'Untitled notebook');
  const now = new Date().toISOString();
  const notebook: Notebook = {
    id: generateId(),
    title,
    source,
    sourceUrl,
    transcript,
    segments,
    topics,
    createdAt: now,
    lastAccessedAt: now,
    wordCount: transcript.split(/\s+/).filter(Boolean).length,
  };
  saveNotebook(notebook);
  return notebook;
}

export function updateNotebook(id: string, patch: Partial<Notebook>): Notebook | null {
  const notebooks = getNotebooks();
  const idx = notebooks.findIndex(nb => nb.id === id);
  if (idx < 0) return null;
  const updated = { ...notebooks[idx], ...patch, lastAccessedAt: new Date().toISOString() };
  notebooks[idx] = updated;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebooks));
  } catch {
    console.warn('localStorage full, notebook not updated');
  }
  return updated;
}

export function deleteNotebook(id: string): void {
  const notebooks = getNotebooks().filter(nb => nb.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebooks));
  } catch {
    console.warn('localStorage error on delete');
  }
}

export function touchNotebook(id: string): void {
  updateNotebook(id, {});
}

export function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
