import type { LessonIndex } from './types';

const DB_NAME = 'acharya_rag';
const DB_VERSION = 1;
const STORE = 'lessons';

interface StoredRow {
  lessonId: string;
  model: string;
  dim: number;
  createdAt: number;
  chunks: LessonIndex['chunks'];
  vectorBuffer: ArrayBuffer;
  bm25: LessonIndex['bm25'];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'lessonId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  }));
}

export async function saveLessonIndex(index: LessonIndex): Promise<void> {
  const row: StoredRow = {
    lessonId: index.lessonId,
    model: index.model,
    dim: index.dim,
    createdAt: index.createdAt,
    chunks: index.chunks,
    vectorBuffer: index.vectors.buffer.slice(
      index.vectors.byteOffset,
      index.vectors.byteOffset + index.vectors.byteLength,
    ) as ArrayBuffer,
    bm25: index.bm25,
  };
  await tx('readwrite', store => store.put(row));
}

export async function loadLessonIndex(lessonId: string): Promise<LessonIndex | null> {
  const row = await tx<StoredRow | undefined>('readonly', store => store.get(lessonId));
  if (!row) return null;
  return {
    lessonId: row.lessonId,
    model: row.model,
    dim: row.dim,
    createdAt: row.createdAt,
    chunks: row.chunks,
    vectors: new Float32Array(row.vectorBuffer),
    bm25: row.bm25,
  };
}

export async function deleteLessonIndex(lessonId: string): Promise<void> {
  await tx('readwrite', store => store.delete(lessonId));
}

export async function hasLessonIndex(lessonId: string): Promise<boolean> {
  const result = await tx<IDBValidKey | undefined>('readonly', store => store.getKey(lessonId));
  return result !== undefined;
}
