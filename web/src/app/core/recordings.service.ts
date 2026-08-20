import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api.client';
import { Analysis, Meta, Recording, Transcript } from './models';

@Injectable({ providedIn: 'root' })
export class RecordingsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<Recording[]> {
    return this.api.get<Recording[]>('/api/recordings');
  }

  get(id: string): Observable<Recording> {
    return this.api.get<Recording>(`/api/recordings/${id}`);
  }

  audioUrl(id: string): string {
    return `/api/recordings/${id}/audio`;
  }

  upload(file: File, title: string, durationSeconds: number): Observable<Recording> {
    const form = new FormData();
    form.append('file', file, file.name || 'recording.webm');
    form.append('title', title);
    form.append('duration_seconds', String(durationSeconds));
    form.append('source', 'microphone');
    return this.api.upload<Recording>('/api/recordings/upload', form);
  }

  transcribe(id: string): Observable<Transcript> {
    return this.api.post<Transcript>(`/api/recordings/${id}/transcribe`, {});
  }

  analyze(id: string): Observable<Analysis> {
    return this.api.post<Analysis>(`/api/recordings/${id}/analyze`, {});
  }

  transcript(id: string): Observable<Transcript> {
    return this.api.get<Transcript>(`/api/recordings/${id}/transcript`);
  }

  analysis(id: string): Observable<Analysis> {
    return this.api.get<Analysis>(`/api/recordings/${id}/analysis`);
  }

  createNotes(id: string): Observable<{ notes: unknown[]; tasks: unknown[] }> {
    return this.api.post(`/api/recordings/${id}/notes`, {
      include_summary: true,
      include_decisions: true,
      include_topics: true,
      include_action_items: true,
      create_tasks: true,
    });
  }

  meta(): Observable<Meta> {
    return this.api.get<Meta>('/api/meta');
  }
}
