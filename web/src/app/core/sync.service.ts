import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { API_BASE } from './config';
import { Note } from './models';

function stamp(value?: string | null): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function usableStamp(value?: string | null): number {
  const parsed = stamp(value);
  if (!parsed) return 0;
  if (parsed > Date.now() + 5000) return 0;
  return parsed;
}

const QUEUE_KEY = 'meeter.sync-queue';

type Queue = { upserts: Record<string, Note>; deletes: string[] };

export type NoteLiveEvent = {
  op: 'upsert' | 'delete' | string;
  id: string;
  updated_at?: string;
  deleted?: boolean;
  note?: Note;
};

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly syncing = signal(false);
  readonly live = signal(false);
  readonly lastPull = signal<Note[] | null>(null);
  readonly lastEvent = signal<NoteLiveEvent | null>(null);
  readonly pending = signal(0);
  private timer: number | null = null;
  private flushTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private flushing = false;
  private holdCount = 0;
  private abort: AbortController | null = null;
  private backoff = 1000;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      this.online.set(true);
      this.connect();
      this.flush();
    });
    window.addEventListener('offline', () => {
      this.online.set(false);
      this.live.set(false);
      this.disconnect();
    });
    this.timer = window.setInterval(() => this.ping(), 30000);
    this.pending.set(this.pendingCount());
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        this.disconnect();
        if (user && this.auth.token()) {
          this.connect();
          void this.flush(true);
        }
      });
    });
    queueMicrotask(() => this.ping());
  }

  hold(): void {
    this.holdCount += 1;
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  release(): void {
    this.holdCount = Math.max(0, this.holdCount - 1);
    if (this.holdCount === 0 && this.pendingCount()) this.scheduleFlush();
  }

  markNote(note: Note): void {
    const queue = this.queue();
    queue.deletes = queue.deletes.filter((id) => id !== note.id);
    queue.upserts[note.id] = {
      ...note,
      updated_at: note.updated_at || new Date().toISOString(),
    };
    this.write(queue);
    this.pending.set(Object.keys(queue.upserts).length + queue.deletes.length);
    this.scheduleFlush();
  }

  markDeleted(id: string): void {
    const queue = this.queue();
    delete queue.upserts[id];
    if (!queue.deletes.includes(id)) queue.deletes.push(id);
    this.write(queue);
    this.pending.set(Object.keys(queue.upserts).length + queue.deletes.length);
    this.scheduleFlush();
  }

  pendingCount(): number {
    const queue = this.queue();
    return Object.keys(queue.upserts).length + queue.deletes.length;
  }

  isUpsertQueued(id: string): boolean {
    return Boolean(this.queue().upserts[id]);
  }

  shouldApplyRemote(id: string, updatedAt?: string | null, localUpdatedAt?: string | null): boolean {
    const queued = this.queue().upserts[id];
    const localAt = queued?.updated_at || localUpdatedAt;
    if (!localAt) return true;
    return usableStamp(localAt) < usableStamp(updatedAt);
  }

  forget(id: string): void {
    const queue = this.queue();
    if (!queue.upserts[id]) return;
    delete queue.upserts[id];
    this.write(queue);
    this.pending.set(Object.keys(queue.upserts).length + queue.deletes.length);
  }

  forgetStale(notes: Note[]): void {
    const queue = this.queue();
    let changed = false;
    for (const note of notes) {
      const queued = queue.upserts[note.id];
      if (!queued) continue;
      if (usableStamp(queued.updated_at) <= usableStamp(note.updated_at)) {
        if (Boolean(queued.archived) !== Boolean(note.archived) || Boolean(queued.pinned) !== Boolean(note.pinned)) {
          if (usableStamp(queued.updated_at) >= usableStamp(note.updated_at)) continue;
        }
        delete queue.upserts[note.id];
        changed = true;
      }
    }
    if (!changed) return;
    this.write(queue);
    this.pending.set(Object.keys(queue.upserts).length + queue.deletes.length);
  }

  flush(force = false): Promise<Note[] | null> {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    return this.flushNow(force);
  }

  private scheduleFlush(): void {
    if (this.holdCount > 0) return;
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), 400);
  }

  private async ping(): Promise<void> {
    try {
      await firstValueFrom(this.http.get(`${API_BASE}/api/health`));
      this.online.set(true);
      if (!this.live()) this.connect();
      if (this.pendingCount() && this.holdCount === 0) void this.flush();
    } catch {
      this.online.set(false);
      this.live.set(false);
    }
  }

  private connect(): void {
    if (typeof window === 'undefined' || !this.auth.token()) return;
    if (this.abort && this.live()) return;
    this.disconnect();
    const token = this.auth.token();
    if (!token) return;
    const controller = new AbortController();
    this.abort = controller;
    void this.listen(controller);
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abort?.abort();
    this.abort = null;
    this.live.set(false);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.auth.token()) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private async listen(controller: AbortController): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/api/notes/events`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.auth.token()}`,
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        if (response.status !== 401) this.online.set(false);
        this.scheduleReconnect();
        return;
      }
      this.online.set(true);
      this.live.set(true);
      this.backoff = 1000;
      void this.flush(true);
      await this.readSse(response.body, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.online.set(false);
        this.live.set(false);
        this.scheduleReconnect();
      }
    } finally {
      if (this.abort === controller) this.abort = null;
      this.live.set(false);
    }
  }

  private async readSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        this.dispatchSse(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    if (!signal.aborted) this.scheduleReconnect();
  }

  private dispatchSse(chunk: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const raw of chunk.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length || event === 'ping') return;
    if (event === 'ready') {
      this.live.set(true);
      return;
    }
    if (event !== 'note') return;
    try {
      const payload = JSON.parse(data.join('\n')) as NoteLiveEvent;
      if (payload?.id) this.lastEvent.set(payload);
    } catch {
      /* ignore malformed frames */
    }
  }

  private async flushNow(force = false): Promise<Note[] | null> {
    if (this.holdCount > 0) return null;
    if (this.flushing || !this.online() || !this.auth.token()) return null;
    const pending = this.pendingCount();
    if (!force && pending === 0 && this.live()) return null;
    this.flushing = true;
    this.syncing.set(true);
    try {
      if (force || pending > 0) {
        const pulled = await this.postSync([]);
        if (!pulled) return null;
        this.forgetStale(pulled);
        this.lastPull.set(pulled);
      }
      const snapshot = this.queue();
      const remaining = Object.keys(snapshot.upserts).length + snapshot.deletes.length;
      if (remaining === 0) {
        this.online.set(true);
        return this.lastPull();
      }
      const notes = [
        ...Object.values(snapshot.upserts).map((note) => ({ ...note, deleted: false })),
        ...snapshot.deletes.map((id) => ({ id, deleted: true })),
      ];
      const result = await this.postSync(notes);
      if (!result) return null;
      this.dropFlushed(snapshot);
      this.lastPull.set(result);
      return result;
    } finally {
      this.flushing = false;
      this.syncing.set(false);
    }
  }

  private async postSync(notes: Array<Record<string, unknown>>): Promise<Note[] | null> {
    try {
      const result = await firstValueFrom(
        this.http.post<{ notes: Note[] }>(`${API_BASE}/api/notes/sync`, { notes }),
      );
      this.online.set(true);
      return result.notes ?? [];
    } catch (error) {
      if (!(error instanceof HttpErrorResponse && error.status === 401)) this.online.set(false);
      return null;
    }
  }

  private dropFlushed(snapshot: Queue): void {
    const current = this.queue();
    for (const [id, note] of Object.entries(snapshot.upserts)) {
      if (current.upserts[id]?.updated_at === note.updated_at) delete current.upserts[id];
    }
    current.deletes = current.deletes.filter((id) => !snapshot.deletes.includes(id));
    this.write(current);
    this.pending.set(Object.keys(current.upserts).length + current.deletes.length);
  }

  private queueKey(): string {
    const userId = this.auth.user()?.id;
    return userId ? `${QUEUE_KEY}.${userId}` : QUEUE_KEY;
  }

  private queue(): Queue {
    try {
      const raw = localStorage.getItem(this.queueKey()) ?? localStorage.getItem(QUEUE_KEY);
      if (!raw) return { upserts: {}, deletes: [] };
      const parsed = JSON.parse(raw) as Queue;
      return {
        upserts: parsed.upserts ?? {},
        deletes: parsed.deletes ?? [],
      };
    } catch {
      return { upserts: {}, deletes: [] };
    }
  }

  private write(queue: Queue): void {
    try {
      localStorage.setItem(this.queueKey(), JSON.stringify(queue));
    } catch {
      /* quota */
    }
  }
}
