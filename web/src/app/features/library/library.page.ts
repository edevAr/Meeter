import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RecordingsApi } from '../../core/recordings.service';
import { Recording } from '../../core/models';

@Component({
  selector: 'app-library-page',
  imports: [RouterLink, DatePipe],
  template: `
    <section class="px-5 py-6 lg:px-8">
      <header class="flex items-end justify-between">
        <div>
          <p class="text-[10px] uppercase tracking-[0.24em] text-mist">Archivo</p>
          <h2 class="mt-1 text-2xl font-extrabold">Llamadas</h2>
        </div>
        <a routerLink="/captura" class="rounded-2xl bg-rec px-4 py-2 text-[13px] font-semibold">Nueva captura</a>
      </header>
      <div class="mt-6 grid gap-3">
        @for (item of recordings(); track item.id) {
          <a class="rounded-2xl border border-line bg-card px-4 py-3 hover:border-accent transition block" [routerLink]="['/llamadas', item.id]">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="font-semibold text-[15px]">{{ item.title }}</p>
                <p class="text-[13px] text-mist">{{ item.created_at | date: 'd MMM y, HH:mm' }} · {{ item.status }}</p>
              </div>
              <span class="text-accent text-sm">Abrir</span>
            </div>
          </a>
        } @empty {
          <p class="text-mist">Todavía no hay llamadas. Graba la primera desde Captura.</p>
        }
      </div>
    </section>
  `,
})
export class LibraryPage {
  private readonly api = inject(RecordingsApi);
  readonly recordings = signal<Recording[]>([]);

  constructor() {
    this.api.list().subscribe((items) => this.recordings.set(items));
  }
}
