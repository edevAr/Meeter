import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api.client';
import { AgendaItem, ItemStatus, Priority, Task } from './models';

@Injectable({ providedIn: 'root' })
export class AgendaApi {
  private readonly api = inject(ApiClient);

  pending(period: 'day' | 'week' | 'month'): Observable<{ period: string; items: AgendaItem[] }> {
    return this.api.get('/api/agenda', { period });
  }

  createTask(payload: {
    title: string;
    details?: string;
    due_date?: string | null;
    priority?: Priority;
    note_id?: string;
  }): Observable<Task> {
    return this.api.post<Task>('/api/tasks', payload);
  }

  patchTask(id: string, payload: Partial<Pick<Task, 'title' | 'details' | 'due_date' | 'priority' | 'status'>>): Observable<Task> {
    return this.api.patch<Task>(`/api/tasks/${id}`, payload);
  }

  patchActionItem(id: string, payload: { status?: ItemStatus; priority?: Priority }): Observable<unknown> {
    return this.api.patch(`/api/action-items/${id}`, payload);
  }
}
