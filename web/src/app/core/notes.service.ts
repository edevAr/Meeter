import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api.client';
import { Note, NoteShare } from './models';

@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly api = inject(ApiClient);

  list(archived = false): Observable<Note[]> {
    return this.api.get<Note[]>('/api/notes', { archived });
  }

  create(payload: Partial<Note> & { title?: string; body?: string }): Observable<Note> {
    return this.api.post<Note>('/api/notes', payload);
  }

  fromCall(payload: {
    transcript: string;
    title?: string;
    created_at?: string;
    pos_x?: number;
    pos_y?: number;
    color?: string;
    recording_id?: string | null;
  }): Observable<Note> {
    return this.api.post<Note>('/api/notes/from-call', payload);
  }

  update(id: string, payload: Partial<Note>): Observable<Note> {
    return this.api.patch<Note>(`/api/notes/${id}`, payload);
  }

  remove(id: string): Observable<{ detail: string }> {
    return this.api.delete(`/api/notes/${id}`);
  }

  listShares(noteId: string): Observable<NoteShare[]> {
    return this.api.get<NoteShare[]>(`/api/notes/${noteId}/shares`);
  }

  share(
    noteId: string,
    payload: { identifier: string; can_read: boolean; can_write: boolean },
  ): Observable<NoteShare> {
    return this.api.post<NoteShare>(`/api/notes/${noteId}/shares`, payload);
  }

  updateShare(
    noteId: string,
    shareId: string,
    payload: { can_read?: boolean; can_write?: boolean },
  ): Observable<NoteShare> {
    return this.api.patch<NoteShare>(`/api/notes/${noteId}/shares/${shareId}`, payload);
  }

  unshare(noteId: string, shareId: string): Observable<{ detail: string }> {
    return this.api.delete(`/api/notes/${noteId}/shares/${shareId}`);
  }
}
