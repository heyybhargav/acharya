export interface AudioSequenceCallbacks {
  onPlay?: () => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

export class AudioSequence {
  private queue: Promise<string | null>[] = [];
  private nextIdx = 0;
  private chain: Promise<void> = Promise.resolve();
  private aborted = false;
  private currentAudio: HTMLAudioElement | null = null;
  private hasStartedAtLeastOne = false;

  constructor(private callbacks: AudioSequenceCallbacks = {}) {}

  enqueue(source: string | Promise<string | null>): void {
    if (this.aborted) return;
    this.queue.push(Promise.resolve(source));
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.aborted) return;
    if (this.nextIdx >= this.queue.length) return;
    const idx = this.nextIdx++;
    this.chain = this.chain.then(() => this.playOne(idx));
  }

  private playOne(idx: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.aborted) return resolve();
      this.queue[idx]
        .then((base64) => {
          if (this.aborted || !base64) return resolve();
          try {
            const audio = new Audio(`data:audio/wav;base64,${base64}`);
            this.currentAudio = audio;
            audio.onended = () => {
              if (this.currentAudio === audio) this.currentAudio = null;
              resolve();
            };
            audio.onerror = (err) => {
              this.callbacks.onError?.(err);
              if (this.currentAudio === audio) this.currentAudio = null;
              resolve();
            };
            if (!this.hasStartedAtLeastOne) {
              this.hasStartedAtLeastOne = true;
              this.callbacks.onPlay?.();
            }
            audio.play().catch((err) => {
              this.callbacks.onError?.(err);
              resolve();
            });
          } catch (err) {
            this.callbacks.onError?.(err);
            resolve();
          }
        })
        .catch((err) => {
          this.callbacks.onError?.(err);
          resolve();
        });
    });
  }

  finalize(): Promise<void> {
    return this.chain.then(() => {
      if (!this.aborted && this.hasStartedAtLeastOne) this.callbacks.onEnd?.();
    });
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch { /* ignore */ }
      this.currentAudio = null;
    }
    if (this.hasStartedAtLeastOne) this.callbacks.onEnd?.();
  }

  pause(): void {
    this.currentAudio?.pause();
  }

  resume(): void {
    this.currentAudio?.play().catch(() => { /* ignore */ });
  }

  isPaused(): boolean {
    return !!this.currentAudio && this.currentAudio.paused;
  }
}

export async function fetchTtsAudios(text: string, languageCode?: string | null): Promise<string[]> {
  try {
    const body: Record<string, string> = { text };
    if (languageCode) body.languageCode = languageCode;
    const res = await fetch('/api/tutor/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.audios) ? data.audios.filter((a: unknown) => typeof a === 'string' && a) : [];
  } catch {
    return [];
  }
}

export function playChunkSequence(
  chunks: string[],
  callbacks: AudioSequenceCallbacks = {},
): AudioSequence {
  const seq = new AudioSequence(callbacks);
  for (const c of chunks) seq.enqueue(c);
  seq.finalize();
  return seq;
}
