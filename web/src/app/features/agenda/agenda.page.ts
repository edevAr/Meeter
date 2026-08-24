import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AgendaApi } from '../../core/agenda.service';
import { AgendaItem, ItemStatus, Priority } from '../../core/models';

@Component({
  selector: 'app-agenda-page',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="px-5 py-6 lg:px-8">
      <a routerLink="/tablero" class="page-back">← Tablero</a>
      <header class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="text-[10px] uppercase tracking-[0.24em] text-mist">Foco</p>
          <h2 class="mt-1 text-2xl font-extrabold">Pendientes</h2>
        </div>
        <div class="flex rounded-2xl border border-line bg-card p-1">
          @for (option of periods; track option.id) {
            <button
              class="rounded-xl px-3 py-1.5 text-[13px] font-semibold"
              [class.bg-accent]="period() === option.id"
              [class.text-ink]="period() === option.id"
              (click)="setPeriod(option.id)"
            >{{ option.label }}</button>
          }
        </div>
      </header>

      <form class="mt-6 grid gap-3 md:grid-cols-[1fr_160px_140px_auto]" (submit)="create($event)">
        <input class="rounded-2xl border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-accent" [(ngModel)]="title" name="title" placeholder="Nuevo pendiente" />
        <input class="rounded-2xl border border-line bg-card px-3 py-2 text-[13px] outline-none" type="date" [(ngModel)]="due" name="due" />
        <select class="rounded-2xl border border-line bg-card px-3 py-2 text-[13px]" [(ngModel)]="priority" name="priority">
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
        </select>
        <button class="rounded-2xl bg-accent px-4 py-2 text-[13px] font-semibold text-ink" type="submit">Añadir</button>
      </form>

      <div class="mt-8 space-y-3">
        @for (item of items(); track item.kind + item.id) {
          <article class="rounded-2xl border border-line bg-card px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center">
            <button
              class="h-6 w-6 rounded-full border border-line shrink-0"
              [class.bg-mint]="item.status === 'completed'"
              (click)="toggle(item)"
            ></button>
            <div class="flex-1">
              <p class="font-semibold" [class.line-through]="item.status === 'completed'" [class.text-mist]="item.status === 'completed'">{{ item.title }}</p>
              <p class="text-[13px] text-mist">{{ item.details || 'Sin detalle' }} · {{ item.source }}</p>
            </div>
            <span class="text-xs uppercase tracking-wide" [class.text-rec]="item.overdue">{{ item.due_date || 'Sin fecha' }}</span>
            <select class="rounded-xl border border-line bg-panel px-3 py-2 text-sm" [ngModel]="item.priority" (ngModelChange)="changePriority(item, $event)">
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </article>
        } @empty {
          <p class="rounded-2xl border border-dashed border-line px-6 py-16 text-center text-mist">Nada pendiente en este periodo.</p>
        }
      </div>
    </section>
  `,
})
export class AgendaPage {
  private readonly api = inject(AgendaApi);
  readonly periods = [
    { id: 'day' as const, label: 'Hoy' },
    { id: 'week' as const, label: 'Semana' },
    { id: 'month' as const, label: 'Mes' },
  ];
  readonly period = signal<'day' | 'week' | 'month'>('day');
  readonly items = signal<AgendaItem[]>([]);
  title = '';
  due = new Date().toISOString().slice(0, 10);
  priority: Priority = 'medium';

  constructor() {
    this.refresh();
  }

  setPeriod(period: 'day' | 'week' | 'month'): void {
    this.period.set(period);
    this.refresh();
  }

  refresh(): void {
    this.api.pending(this.period()).subscribe((response) => this.items.set(response.items));
  }

  create(event: Event): void {
    event.preventDefault();
    if (!this.title.trim()) return;
    this.api.createTask({ title: this.title.trim(), due_date: this.due, priority: this.priority }).subscribe(() => {
      this.title = '';
      this.refresh();
    });
  }

  toggle(item: AgendaItem): void {
    const status: ItemStatus = item.status === 'completed' ? 'pending' : 'completed';
    this.patch(item, { status });
  }

  changePriority(item: AgendaItem, priority: Priority): void {
    this.patch(item, { priority });
  }

  private patch(item: AgendaItem, payload: { status?: ItemStatus; priority?: Priority }): void {
    const request =
      item.kind === 'task' ? this.api.patchTask(item.id, payload) : this.api.patchActionItem(item.id, payload);
    request.subscribe(() => this.refresh());
  }
}
