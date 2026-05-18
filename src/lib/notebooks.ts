// Notebook persistence via localStorage
// No database needed — all session data lives in the browser

export interface Notebook {
  id: string;
  title: string;          // Derived from first topic or source URL
  source: 'youtube' | 'file' | 'text';
  sourceUrl?: string;     // YouTube URL if applicable
  transcript: string;
  topics: string[];
  createdAt: string;
  lastAccessedAt: string;
  wordCount: number;
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
    return JSON.parse(raw) as Notebook[];
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
    console.warn('localStorage full — notebooks not saved');
  }
  return notebook;
}

export function createNotebook(
  transcript: string,
  topics: string[],
  source: Notebook['source'],
  sourceUrl?: string
): Notebook {
  const title = topics[0] || (sourceUrl ? new URL(sourceUrl).hostname : 'Untitled notebook');
  const now = new Date().toISOString();
  const notebook: Notebook = {
    id: generateId(),
    title,
    source,
    sourceUrl,
    transcript,
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
    console.warn('localStorage full — notebook not updated');
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
