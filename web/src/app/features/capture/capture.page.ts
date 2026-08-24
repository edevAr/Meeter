import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { LiveCaptureService, LiveSession } from '../../core/live-capture.service';
import { RecordingsApi } from '../../core/recordings.service';

@Component({
  selector: 'app-capture-page',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="px-5 py-6 lg:px-8 max-w-5xl">
      <a routerLink="/tablero" class="page-back">← Tablero</a>
      <p class="text-[10px] uppercase tracking-[0.24em] text-mist">Estudio</p>
      <h2 class="mt-1 text-2xl font-extrabold">Grabar y transcribir en vivo</h2>
      <p class="mt-2 max-w-2xl text-[13px] text-mist">El micrófono se convierte a texto mientras hablas. Al detener, se guarda la llamada, se pide el resumen y puedes crear notas.</p>

      <div class="mt-6 rounded-3xl border border-line bg-card p-5">
        <label class="text-[13px] text-mist">Título de la llamada</label>
        <input class="mt-2 w-full rounded-2xl border border-line bg-panel px-3 py-2 text-[13px] outline-none focus:border-accent" [(ngModel)]="title" name="title" placeholder="Sincronización con el equipo" />

        <div class="mt-5 flex flex-wrap gap-3">
          <button class="rounded-2xl bg-rec px-5 py-2 text-[13px] font-semibold" type="button" [disabled]="busy()" (click)="toggle()">
            {{ session ? 'Detener' : 'Empezar a grabar' }}
          </button>
          @if (recordingId()) {
            <a class="rounded-2xl border border-line px-5 py-2 text-[13px]" [routerLink]="['/llamadas', recordingId()]">Abrir llamada</a>
          }
        </div>
        @if (status()) {
          <p class="mt-4 text-sm text-mist">{{ status() }}</p>
        }
        @if (error()) {
          <p class="mt-3 text-rec">{{ error() }}</p>
        }
      </div>

      <article class="mt-5 min-h-[220px] rounded-3xl border border-line bg-panel p-5">
        <p class="text-[10px] uppercase tracking-[0.2em] text-accent">Transcripción en tiempo real</p>
        <p class="mt-3 font-note text-[15px] leading-7 whitespace-pre-wrap">{{ transcript() || 'Pulsa grabar. El texto aparecerá aquí.' }}</p>
      </article>
    </section>
  `,
})
export class CapturePage {
  private readonly live = inject(LiveCaptureService);
  private readonly recordings = inject(RecordingsApi);

  title = 'Llamada';
  session: LiveSession | null = null;
  readonly transcript = signal('');
  readonly status = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly recordingId = signal<string | null>(null);

  async toggle(): Promise<void> {
    if (this.session) {
      await this.finish();
      return;
    }
    this.error.set('');
    this.status.set('Escuchando…');
    try {
      this.session = await this.live.start((text) => this.transcript.set(text));
    } catch {
      this.error.set('No se pudo acceder al micrófono.');
      this.status.set('');
    }
  }

  private async finish(): Promise<void> {
    if (!this.session) return;
    this.busy.set(true);
    this.status.set('Guardando audio…');
    try {
      const result = await this.session.stop();
      this.session = null;
      const file = new File([result.blob], 'llamada.webm', { type: result.blob.type || 'audio/webm' });
      this.recordings.upload(file, this.title.trim() || 'Llamada', result.durationSeconds).subscribe({
        next: (recording) => {
          this.recordingId.set(recording.id);
          this.status.set('Transcribiendo con Whisper…');
          this.recordings.transcribe(recording.id).subscribe({
            next: (transcript) => {
              this.transcript.set(transcript.text);
              this.status.set('Generando resumen…');
              this.recordings.analyze(recording.id).subscribe({
                next: () => {
                  this.recordings.createNotes(recording.id).subscribe({
                    next: () => this.status.set('Listo. Resumen, notas y pendientes creados.'),
                    error: () => this.status.set('Resumen listo. Las notas no se pudieron crear.'),
                  });
                },
                error: (err) => this.status.set(err.error?.detail ?? 'La transcripción está lista. El análisis de IA necesita AI_API_KEY.'),
              });
            },
            error: (err) => this.error.set(err.error?.detail ?? 'Falló la transcripción final.'),
          });
        },
        error: (err) => this.error.set(err.error?.detail ?? 'No se pudo subir el audio.'),
      });
    } finally {
      this.busy.set(false);
    }
  }
}
