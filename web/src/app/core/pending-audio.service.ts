import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { RecordingsApi } from './recordings.service';
import { SyncService } from './sync.service';

const DB_NAME = 'meeter-audio';
const STORE = 'clips';
export const LOCAL_AUDIO_PREFIX = 'local:';

export type PendingClip = {
  id: string;
  noteId: string;
  title: string;
  durationSeconds: number;
  mimeType: string;
  filename: string;
  blob: Blob;
  createdAt: string;
  transcribeAfterUpload: boolean;
};

export type AudioUploaded = {
  clipId: string;
  noteId: string;
  recordingId: string;
  transcribe: boolean;
};

export function isLocalRecordingId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith(LOCAL_AUDIO_PREFIX));
}

export function localRecordingId(clipId: string): string {
  return `${LOCAL_AUDIO_PREFIX}${clipId}`;
}

export function clipIdFromRecording(id: string): string {
  return id.startsWith(LOCAL_AUDIO_PREFIX) ? id.slice(LOCAL_AUDIO_PREFIX.length) : id;
}

@Injectable({ providedIn: 'root' })
export class PendingAudioService {
  private readonly recordings = inject(RecordingsApi);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  readonly pending = signal(0);
  readonly uploaded = signal<AudioUploaded | null>(null);
  private flushing = false;
  private db: Promise<IDBDatabase> | null = null;
  private timer: number | null = null;

  constructor() {
    if (typeof indexedDB === 'undefined' || typeof window === 'undefined') return;
    void this.refreshCount();
    effect(() => {
      const online = this.sync.online();
      const user = this.auth.user();
      if (online && user && this.auth.token()) untracked(() => void this.flush());
    });
    this.timer = window.setInterval(() => {
      if (this.pending() && this.sync.online() && this.auth.token()) void this.flush();
    }, 20000);
  }

  async enqueue(input: {
    noteId: string;
    title: string;
    durationSeconds: number;
    file: Blob;
    filename?: string;
  }): Promise<string> {
    const mimeType = input.file.type || 'audio/webm';
    const filename = input.filename || (mimeType.includes('mp4') || mimeType.includes('m4a') ? 'nota-de-voz.m4a' : 'nota-de-voz.webm');
    const clip: PendingClip = {
      id: this.newId(),
      noteId: input.noteId,
      title: input.title,
      durationSeconds: input.durationSeconds,
      mimeType,
      filename,
      blob: input.file,
      createdAt: new Date().toISOString(),
      transcribeAfterUpload: false,
    };
    await this.put(clip);
    await this.refreshCount();
    return clip.id;
  }

  async objectUrl(recordingId: string): Promise<string | null> {
    const clip = await this.get(clipIdFromRecording(recordingId));
    if (!clip?.blob) return null;
    return URL.createObjectURL(clip.blob);
  }

  async markTranscribe(recordingId: string): Promise<void> {
    const clip = await this.get(clipIdFromRecording(recordingId));
    if (!clip) return;
    clip.transcribeAfterUpload = true;
    await this.put(clip);
  }

  async hasClip(recordingId: string): Promise<boolean> {
    return Boolean(await this.get(clipIdFromRecording(recordingId)));
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.sync.online() || !this.auth.token()) return;
    this.flushing = true;
    try {
      const clips = await this.list();
      for (const clip of clips) {
        if (!this.sync.online()) break;
        try {
          const file = new File([clip.blob], clip.filename, { type: clip.mimeType });
          const recording = await firstValueFrom(
            this.recordings.upload(file, clip.title, clip.durationSeconds),
          );
          await this.remove(clip.id);
          this.uploaded.set({
            clipId: clip.id,
            noteId: clip.noteId,
            recordingId: recording.id,
            transcribe: clip.transcribeAfterUpload,
          });
        } catch {
          break;
        }
      }
    } finally {
      this.flushing = false;
      await this.refreshCount();
    }
  }

  private async refreshCount(): Promise<void> {
    try {
      this.pending.set((await this.list()).length);
    } catch {
      this.pending.set(0);
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB'));
    });
    return this.db;
  }

  private async put(clip: PendingClip): Promise<void> {
    const db = await this.open();
    await this.idb(db.transaction(STORE, 'readwrite').objectStore(STORE).put(clip));
  }

  private async get(id: string): Promise<PendingClip | undefined> {
    const db = await this.open();
    return this.idb(db.transaction(STORE, 'readonly').objectStore(STORE).get(id)) as Promise<PendingClip | undefined>;
  }

  private async remove(id: string): Promise<void> {
    const db = await this.open();
    await this.idb(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  }

  private async list(): Promise<PendingClip[]> {
    const db = await this.open();
    const rows = (await this.idb(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as PendingClip[];
    return rows ?? [];
  }

  private idb<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB'));
    });
  }

  private newId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      /* HTTP */
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }
}
