import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { RecordingsApi } from '../../core/recordings.service';
import { Analysis, Recording, Transcript } from '../../core/models';

@Component({
  selector: 'app-recording-detail-page',
  imports: [DatePipe, RouterLink],
  template: `
    <section class="px-5 py-6 lg:px-8 max-w-4xl">
      <a routerLink="/llamadas" class="page-back">← Llamadas</a>
      @if (recording(); as item) {
        <p class="text-[10px] uppercase tracking-[0.24em] text-mist">{{ item.created_at | date: 'd MMMM y' }}</p>
        <h2 class="mt-1 text-2xl font-extrabold">{{ item.title }}</h2>
        <p class="mt-2 text-[13px] text-mist">{{ item.status }}</p>
        <div class="mt-5 flex flex-wrap gap-2">
          <button class="rounded-2xl bg-accent px-4 py-2 text-[13px] font-semibold text-ink" type="button" (click)="transcribe()">Transcribir</button>
          <button class="rounded-2xl border border-line px-4 py-2 text-[13px]" type="button" (click)="analyze()">Resumir con IA</button>
          <button class="rounded-2xl border border-line px-4 py-2 text-[13px]" type="button" (click)="toNotes()">Crear notas</button>
        </div>
        @if (message()) {
          <p class="mt-3 text-[13px] text-mist">{{ message() }}</p>
        }
        <article class="mt-6 rounded-3xl border border-line bg-card p-5">
          <h3 class="font-semibold text-[15px]">Transcripción</h3>
          <p class="mt-2 whitespace-pre-wrap text-[13px] text-mist leading-6">{{ transcript()?.text || 'Aún no hay texto.' }}</p>
        </article>
        <article class="mt-3 rounded-3xl border border-line bg-card p-5">
          <h3 class="font-semibold text-[15px]">Resumen</h3>
          <p class="mt-2 text-[13px] leading-6">{{ analysis()?.summary || 'Analiza la llamada para obtener un brief.' }}</p>
          @if (analysis()?.key_topics?.length) {
            <p class="mt-4 text-sm text-mist">Temas: {{ analysis()?.key_topics?.join(', ') }}</p>
          }
        </article>
      }
    </section>
  `,
})
export class RecordingDetailPage {
  private readonly api = inject(RecordingsApi);
  private readonly route = inject(ActivatedRoute);
  readonly recording = signal<Recording | null>(null);
  readonly transcript = signal<Transcript | null>(null);
  readonly analysis = signal<Analysis | null>(null);
  readonly message = signal('');

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  load(id: string): void {
    this.api.get(id).subscribe((item) => this.recording.set(item));
    this.api.transcript(id).subscribe({
      next: (item) => this.transcript.set(item),
      error: () => this.transcript.set(null),
    });
    this.api.analysis(id).subscribe({
      next: (item) => this.analysis.set(item),
      error: () => this.analysis.set(null),
    });
  }

  transcribe(): void {
    const id = this.recording()?.id;
    if (!id) return;
    this.message.set('Transcribiendo…');
    this.api.transcribe(id).subscribe({
      next: (item) => {
        this.transcript.set(item);
        this.message.set('Transcripción lista.');
      },
      error: (err) => this.message.set(err.error?.detail ?? 'Falló la transcripción'),
    });
  }

  analyze(): void {
    const id = this.recording()?.id;
    if (!id) return;
    this.message.set('Analizando…');
    this.api.analyze(id).subscribe({
      next: (item) => {
        this.analysis.set(item);
        this.message.set('Resumen listo.');
      },
      error: (err) => this.message.set(err.error?.detail ?? 'Falló el análisis'),
    });
  }

  toNotes(): void {
    const id = this.recording()?.id;
    if (!id) return;
    this.api.createNotes(id).subscribe({
      next: () => this.message.set('Notas y pendientes creados en el tablero y la agenda.'),
      error: (err) => this.message.set(err.error?.detail ?? 'No se pudieron crear las notas'),
    });
  }
}
