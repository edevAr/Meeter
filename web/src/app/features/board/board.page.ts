import { NgClass } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, firstValueFrom } from 'rxjs';

import { NotesService } from '../../core/notes.service';
import { LiveCaptureService, LiveSession } from '../../core/live-capture.service';
import { RecordingsApi } from '../../core/recordings.service';
import { Note } from '../../core/models';

const IMAGE_MARK = '<!--meeter-images:';
const MARK_MARK = '<!--meeter-marks:';
const NOTE_W = 156;
const NOTE_H = 176;
const NOTE_COLORS = [
  { id: 'yellow', hex: '#ffe45c', label: 'Amarillo' },
  { id: 'amber', hex: '#ffb14a', label: 'Naranja' },
  { id: 'peach', hex: '#ffc39a', label: 'Durazno' },
  { id: 'rose', hex: '#ffb0c4', label: 'Rosa' },
  { id: 'lilac', hex: '#d4b8ff', label: 'Lila' },
  { id: 'sky', hex: '#8ecdf5', label: 'Cielo' },
  { id: 'mint', hex: '#8ee0b5', label: 'Menta' },
] as const;
const ALARM_TONES = [
  { id: 'classic', label: 'Clásico', hint: 'Beep grave y agudo' },
  { id: 'soft', label: 'Suave', hint: 'Campanita suave' },
  { id: 'urgent', label: 'Urgente', hint: 'Pulsos rápidos' },
  { id: 'digital', label: 'Digital', hint: 'Tres notas' },
  { id: 'bell', label: 'Campana', hint: 'Timbre largo' },
] as const;

type NoteImage = {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  origW: number;
  origH: number;
  fullW: number;
  fullH: number;
};

type DrawTool = 'cursor' | 'text' | 'arrow' | 'circle' | 'square';
type ImageCorner = 'nw' | 'ne' | 'sw' | 'se';
type ImageFrame = { id: string; x: number; y: number; w: number; h: number };
type NoteMark = {
  id: string;
  kind: 'text' | 'arrow' | 'circle' | 'square';
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  text?: string;
};

@Component({
  selector: 'app-board-page',
  imports: [FormsModule, NgClass],
  template: `
    <section class="cork-workspace relative h-screen overflow-hidden">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/35 to-transparent"></div>
      <header class="relative z-30 flex items-start justify-between gap-4 px-6 pt-5">
        <div class="pointer-events-none">
          <p class="text-[11px] uppercase tracking-[0.32em] text-sun/80">Atelier</p>
          <h2 class="font-note text-3xl font-semibold tracking-tight text-[#f8ecd4]">Tablero</h2>
          <p class="mt-1 max-w-xl text-[13px] text-[#d7c4a6]/80">
            Arrastra la nota amarilla al corcho. Hecho la apila. Eliminar la envía al basurero.
          </p>
        </div>
        <div class="mt-1 flex items-start gap-2">
          <label class="board-search group relative flex w-[min(280px,36vw)] items-center">
            <svg class="pointer-events-none absolute left-3.5 h-4 w-4 text-[#d7c4a6]/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"/>
              <path d="M20 20l-3-3" stroke-linecap="round"/>
            </svg>
            <input
              class="w-full rounded-full border border-[#f8ecd4]/20 bg-black/40 py-2.5 pl-10 pr-10 text-sm text-[#f8ecd4] outline-none placeholder:text-[#d7c4a6]/55 backdrop-blur-md transition focus:border-[#ffe45c]/50 focus:bg-black/55"
              type="search"
              name="board-search"
              placeholder="Buscar notas…"
              autocomplete="off"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
              (pointerdown)="$event.stopPropagation()"
            />
            @if (query()) {
              <button
                type="button"
                class="absolute right-2.5 flex h-7 w-7 items-center justify-center rounded-full text-[#d7c4a6] hover:bg-white/10 hover:text-[#f8ecd4]"
                (click)="query.set('')"
                aria-label="Limpiar búsqueda"
              >
                ×
              </button>
            }
          </label>

          <div class="date-filter relative">
            <button
              type="button"
              class="flex min-w-[148px] items-center gap-2 rounded-full border border-[#f8ecd4]/20 bg-black/40 px-2.5 py-1.5 text-left backdrop-blur-md transition hover:border-[#ffe45c]/40 hover:bg-black/55"
              (click)="toggleCalendar($event)"
              [attr.aria-expanded]="calendarOpen()"
            >
              <svg class="h-3.5 w-3.5 shrink-0 text-[#ffe45c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="5" width="18" height="16" rx="2"/>
                <path d="M3 10h18M8 3v4M16 3v4" stroke-linecap="round"/>
              </svg>
              <span class="min-w-0">
                <span class="block text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#d7c4a6]/75">
                  {{ isToday() ? 'Hoy' : 'Fecha' }}
                </span>
                <span class="block truncate text-[12px] leading-tight text-[#f8ecd4]">{{ dateLabel() }}</span>
              </span>
            </button>

            @if (calendarOpen()) {
              <div class="date-calendar absolute right-0 top-[calc(100%+8px)] z-50" (pointerdown)="$event.stopPropagation()">
                <div class="mb-1.5 flex items-center justify-between gap-0.5">
                  <button type="button" class="cal-nav" (click)="shiftYear(-1)" aria-label="Año anterior">«</button>
                  <button type="button" class="cal-nav" (click)="shiftMonth(-1)" aria-label="Mes anterior">‹</button>
                  <p class="min-w-0 flex-1 text-center font-note text-[13px] leading-none text-[#3b2a12]">
                    {{ monthNames[viewMonth()] }} {{ viewYear() }}
                  </p>
                  <button type="button" class="cal-nav" (click)="shiftMonth(1)" aria-label="Mes siguiente">›</button>
                  <button type="button" class="cal-nav" (click)="shiftYear(1)" aria-label="Año siguiente">»</button>
                </div>
                <div class="mb-0.5 grid grid-cols-7 text-center text-[8px] font-extrabold uppercase tracking-wide text-[#7a5a28]/80">
                  @for (day of weekDays; track day) {
                    <span>{{ day }}</span>
                  }
                </div>
                <div class="grid grid-cols-7 gap-y-0.5">
                  @for (cell of calendarCells(); track $index) {
                    @if (cell.key; as key) {
                      <button
                        type="button"
                        class="cal-day"
                        [class.selected]="key === selectedDay()"
                        [class.today]="key === todayKey()"
                        [class.has-notes]="daysWithNotes().has(key)"
                        (click)="selectDay(key)"
                      >
                        {{ cell.day }}
                      </button>
                    } @else {
                      <span></span>
                    }
                  }
                </div>
                @if (!isToday()) {
                  <button
                    type="button"
                    class="mt-2 w-full rounded-full bg-[#3b2a12] py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#ffe45c]"
                    (click)="selectDay(todayKey())"
                  >
                    Ir a hoy
                  </button>
                }
              </div>
            }
          </div>
        </div>
      </header>

      @if (!visibleNotes().length) {
        <p class="pointer-events-none absolute left-1/2 top-36 z-20 -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-sm text-[#d7c4a6]">
          @if (query().trim()) {
            No hay notas que coincidan con “{{ query().trim() }}”
          } @else {
            No hay notas el {{ dateLabel() }}
          }
        </p>
      }

      <div #stage class="absolute inset-0 overflow-auto pb-[200px]">
        @for (note of visibleNotes(); track noteIdentity(note)) {
          <article
            class="sticky-paper absolute flex flex-col rounded-[3px] p-3 pb-2 shadow-sticky"
            [attr.id]="'note-card-' + note.id"
            [attr.data-color]="colorOf(note)"
            [class.is-alarming]="isAlarming(note)"
            [class.is-spawning]="isSpawning(note)"
            [style.left.px]="note.pos_x"
            [style.top.px]="note.pos_y"
            [style.width.px]="noteSize(note).w"
            [style.height.px]="noteSize(note).h"
            [style.--note-rot]="note.rotation + 'deg'"
            [style.transform]="isSpawning(note) ? null : rotationOf(note)"
            [style.z-index]="zOf(note)"
            [class.is-dragging]="draggingNoteId() === note.id"
            [class.is-resizing]="noteResize()?.id === note.id"
            [class.invisible]="expandedId() === note.id"
            (pointerdown)="bringForward(note)"
          >
            <div
              class="note-drag-bar group relative -mx-1 mb-0.5 flex min-h-[22px] items-center justify-between gap-0.5 px-0.5"
              (pointerdown)="startMove($event, note)"
            >
              <div class="relative z-20 -ml-1.5 flex items-center gap-0.5">
                <div class="note-color-wrap relative">
                <button
                  type="button"
                  class="note-icon-btn is-color"
                  title="Cambiar color"
                  (click)="toggleColorPicker(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#fffdf6" d="M12 3.2C7.4 3.2 3.6 6.4 3.6 10.6c0 2.8 1.8 4.6 3.8 4.6.8 0 1.2-.5 1.4-1.1.3-.9 1.2-1.5 2.1-1.5h1.1c4.4 0 8.4-2.2 8.4-5.4C20.4 4.8 16.7 3.2 12 3.2z"/>
                    <circle fill="#c23b22" cx="7.4" cy="8.4" r="1.15"/>
                    <circle fill="#e0a12b" cx="11.2" cy="6.7" r="1.15"/>
                    <circle fill="#3b9a5a" cx="15.2" cy="8.2" r="1.15"/>
                    <circle fill="#3b7dd8" cx="10.2" cy="11.1" r="1.05"/>
                  </svg>
                </button>
              </div>
              <div class="note-remind-wrap relative z-20">
                <button
                  type="button"
                  class="note-icon-btn is-remind"
                  [class.is-set]="hasUpcomingReminder(note)"
                  [class.is-alarming]="isAlarming(note)"
                  [title]="reminderTitle(note)"
                  (click)="toggleReminderPicker(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                    <circle cx="12" cy="13" r="7"/>
                    <path d="M12 13V9M12 13l3 2M9 4l-3 2M15 4l3 2"/>
                  </svg>
                </button>
              </div>
              </div>
              <span class="note-drag-hand pointer-events-none absolute left-1/2 top-1/2 z-10">
                <svg class="h-5 w-5 text-[#3b2a12]/85 drop-shadow-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/>
                  <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
                  <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
                  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                </svg>
              </span>
              <div class="relative z-20 flex items-center gap-0.5">
                <button
                  type="button"
                  class="note-icon-btn"
                  title="Maximizar"
                  (click)="maximize(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg class="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke-linecap="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="note-icon-btn is-done"
                  title="Hecho"
                  (click)="markDone(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg class="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M5 12.5l4.2 4.2L19 7" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="note-icon-btn is-delete"
                  title="Eliminar"
                  (click)="discard(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg class="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <input
              class="note-title"
              [attr.id]="'note-title-' + note.id"
              [ngModel]="note.title"
              (ngModelChange)="setTitle(note, $event)"
              (blur)="save(note)"
              (keydown.enter)="focusBody(note); $event.preventDefault()"
              (pointerdown)="$event.stopPropagation()"
              placeholder="Título (opcional)"
              maxlength="120"
              autocomplete="off"
            />
            @if (note.recording_id) {
              <div
                class="note-voice"
                (pointerdown)="$event.stopPropagation()"
                (click)="$event.stopPropagation()"
              >
                <button
                  type="button"
                  class="note-voice-play"
                  [class.is-on]="isVoicePlaying(note)"
                  [title]="isVoicePlaying(note) ? 'Pausar' : 'Escuchar'"
                  (click)="toggleVoice(note); $event.stopPropagation()"
                >
                  @if (isVoicePlaying(note)) {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="5" width="4.5" height="14" rx="1"/>
                      <rect x="13.5" y="5" width="4.5" height="14" rx="1"/>
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5.5v13l11-6.5-11-6.5z"/>
                    </svg>
                  }
                </button>
                <button
                  type="button"
                  class="note-voice-bar"
                  title="Posición"
                  (click)="seekVoice($event, note)"
                >
                  <i [style.width.%]="voiceProgress(note)"></i>
                </button>
                <span class="note-voice-time">{{ voiceClock(note) }}</span>
              </div>
            }
            <div
              class="note-canvas relative min-h-0 flex-1"
              (dragover)="onNoteDragOver($event, note)"
              (drop)="onNoteDrop($event, note)"
            >
              <div
                class="note-canvas-space"
                [style.minWidth.px]="canvasExtent(note).w || null"
                [style.minHeight.px]="canvasExtent(note).h || null"
              >
                @if (query().trim()) {
                  <div
                    class="note-highlight pointer-events-none absolute inset-0 overflow-hidden font-note text-[12px] leading-5 text-[#3b2a12]"
                    aria-hidden="true"
                  >
                    @for (part of highlightedParts(textOf(note)); track $index) {
                      @if (part.hit) {
                        <mark class="search-hit">{{ part.text }}</mark>
                      } @else {
                        {{ part.text }}
                      }
                    }
                  </div>
                }
                <textarea
                  class="note-canvas-text font-note text-[12px] leading-5 text-[#3b2a12] outline-none placeholder:text-[#3b2a12]/35"
                  [class.text-transparent]="!!query().trim()"
                  [class.caret-[#3b2a12]]="!!query().trim()"
                  [attr.id]="'note-body-' + note.id"
                  [ngModel]="textOf(note)"
                  (ngModelChange)="setText(note, $event)"
                  (blur)="save(note)"
                  placeholder="Escribe, pega o arrastra una imagen…"
                ></textarea>
                @for (image of imagesOf(note); track image.id) {
                  <div
                    class="note-image-item"
                    [class.is-moving]="imageDrag()?.id === image.id"
                    [class.is-original]="showsOriginalImage(note)"
                    [style.left.px]="displayBox(note, image).x"
                    [style.top.px]="displayBox(note, image).y"
                    [style.width.px]="displayBox(note, image).w || null"
                    [style.height.px]="displayBox(note, image).h || null"
                    (pointerdown)="startImageMove($event, note, image.id)"
                  >
                    <img
                      [src]="image.src"
                      alt=""
                      draggable="false"
                      (load)="onImageLoad(note, image, $event)"
                    />
                    @for (corner of imageCorners; track corner) {
                      <span
                        class="note-image-handle"
                        [class.nw]="corner === 'nw'"
                        [class.ne]="corner === 'ne'"
                        [class.sw]="corner === 'sw'"
                        [class.se]="corner === 'se'"
                        (pointerdown)="startImageResize($event, note, image.id, corner)"
                      >
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          @if (corner === 'nw') {
                            <path d="M2 8V2h6"/>
                          }
                          @if (corner === 'ne') {
                            <path d="M4 2h6v6"/>
                          }
                          @if (corner === 'sw') {
                            <path d="M2 4v6h6"/>
                          }
                          @if (corner === 'se') {
                            <path d="M10 4v6H4"/>
                          }
                        </svg>
                      </span>
                    }
                    <button
                      type="button"
                      class="note-image-remove"
                      (click)="removeImage(note, $index); $event.stopPropagation()"
                      (pointerdown)="$event.stopPropagation()"
                    >×</button>
                  </div>
                }
              </div>
              @if (dropTargetId() === note.id) {
                <div class="note-drop-hint">Suelta la imagen</div>
              }
            </div>
            <div class="mt-1 flex items-center gap-0.5">
              @for (level of priorities; track level) {
                <button
                  type="button"
                  class="h-4 w-4 rounded-full text-[8px] font-extrabold tracking-tight transition"
                  [title]="'Cambiar a prioridad ' + level"
                  [ngClass]="priorityClass(note, level)"
                  [class.search-priority-hit]="priorityHit(level)"
                  (click)="setPriority(note, level)"
                >
                  {{ level }}
                </button>
              }
            </div>
            <span
              class="note-resize"
              title="Redimensionar"
              (pointerdown)="startNoteResize($event, note)"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M10 4v6H4"/>
              </svg>
            </span>
            @if (isAlarming(note)) {
              <button
                type="button"
                class="note-silence"
                (click)="silenceAlarm(note); $event.stopPropagation()"
                (pointerdown)="$event.stopPropagation()"
              >
                Silenciar
              </button>
            }
          </article>
        }
        @for (burst of spawnBursts(); track burst.id) {
          <div
            class="note-spawn-burst pointer-events-none"
            [style.left.px]="spawnBurstLeft(burst)"
            [style.top.px]="spawnBurstTop(burst)"
            [style.width.px]="burst.w"
            [style.height.px]="burst.h"
            [style.--paper]="burst.hex"
          >
            <span class="note-spawn-flash"></span>
            <span class="note-spawn-ring"></span>
            @for (spark of sparkIndex; track spark) {
              <i class="note-spawn-spark" [style.--i]="spark"></i>
            }
          </div>
        }
      </div>

      @if (ghost(); as g) {
        <div
          class="sticky-paper pointer-events-none fixed z-50 h-[176px] w-[156px] rounded-[3px] opacity-90 shadow-sticky"
          [style.left.px]="g.x"
          [style.top.px]="g.y"
          style="transform: rotate(-6deg) scale(0.92)"
        >
          <div class="sticky-tape mx-auto mt-3 h-4 w-16 rounded-sm"></div>
        </div>
      }

      <div class="absolute bottom-7 left-1/2 z-40 flex -translate-x-1/2 items-end gap-6">
        @if (canCreateNotes()) {
          <div class="flex flex-col items-center">
            <div
              class="group relative h-[68px] w-[62px] cursor-grab touch-none active:cursor-grabbing"
              (pointerdown)="startPadDrag($event)"
              role="button"
              tabindex="0"
              aria-label="Arrastrar una nota amarilla al tablero"
            >
              <span class="note-pad-layer absolute left-2 top-2.5 h-[50px] w-[44px] rotate-6 rounded-[2px] shadow-lg"></span>
              <span class="note-pad-layer absolute left-1 top-1.5 h-[50px] w-[44px] -rotate-3 rounded-[2px] shadow-lg"></span>
              <span
                class="note-pad-layer absolute left-0 top-0 h-[52px] w-[46px] rounded-[2px] shadow-dock ring-1 ring-black/10 transition group-hover:-translate-y-1"
              >
                <span class="sticky-tape mx-auto mt-2 block h-2.5 w-8 rounded-sm"></span>
              </span>
            </div>
            <p
              class="mt-3 rounded-full bg-black/35 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#f8ecd4]/80 backdrop-blur"
            >
              {{ isToday() ? 'Arrastra al tablero' : 'Nota para esta fecha' }}
            </p>
          </div>
        }
      </div>

      @if (tossingNote(); as toss) {
        <div
          class="trash-fly pointer-events-none fixed z-[92]"
          [class.in-flight]="toss.moving"
          [style.left.px]="toss.x"
          [style.top.px]="toss.y"
          [style.width.px]="toss.w"
          [style.height.px]="toss.h"
          [style.--dx]="toss.dx + 'px'"
          [style.--dy]="toss.dy + 'px'"
          [style.--lift]="toss.lift + 'px'"
          [style.--spin]="toss.spin"
        >
          <div class="trash-fly-paper sticky-paper overflow-hidden p-3">
            <div class="sticky-tape mx-auto h-3 w-10 rounded-sm"></div>
            <p class="mt-2 line-clamp-4 font-note text-sm leading-5 text-[#3b2a12]">{{ toss.body }}</p>
          </div>
        </div>
      }

      @if (flyingNote(); as fly) {
        <div
          class="done-fly sticky-paper pointer-events-none fixed z-[90] overflow-hidden p-3"
          [class.in-flight]="fly.moving"
          [style.left.px]="fly.x"
          [style.top.px]="fly.y"
          [style.width.px]="fly.w"
          [style.height.px]="fly.h"
          [style.--dx]="fly.dx + 'px'"
          [style.--dy]="fly.dy + 'px'"
          [style.--rot]="fly.rot"
        >
          <div class="sticky-tape mx-auto h-3 w-10 rounded-sm"></div>
          <p class="mt-2 line-clamp-4 font-note text-sm leading-5 text-[#3b2a12]">{{ fly.body }}</p>
        </div>
      }

      <div
        #trashDock
        class="fixed z-[55]"
        [style.left.px]="trashPos().x"
        [style.top.px]="trashPos().y"
        (pointerenter)="keepTrashOpen()"
        (pointerleave)="hideTrashSoon()"
      >
        <div
          class="trash-bubble absolute z-10"
          [class.is-open]="trashOpen()"
          [class.open-left]="opensLeft()"
          [class.open-up]="opensUp()"
          [class.cols-3]="trashCount() > 4"
          (pointerenter)="keepTrashOpen()"
          (pointerleave)="hideTrashSoon()"
        >
          <div class="trash-bubble-inner">
            <div class="border-b border-[#3b2a12]/10 px-6 py-4">
              <p class="text-[10px] font-extrabold uppercase tracking-[0.26em] text-[#7a5a28]">Basurero</p>
              <p class="font-note text-xl text-[#3b2a12]">Notas eliminadas</p>
            </div>
            <div class="trash-note-grid">
              @if (trashOpen()) {
                @for (note of trashNotes(); track note.id; let i = $index) {
                  <article
                    class="trash-note sticky-paper flex min-h-[108px] flex-col rounded-[3px] p-2 shadow-sm"
                    [attr.data-color]="colorOf(note)"
                    [style.animation-delay.ms]="70 + i * 45"
                  >
                    @if (titleOf(note)) {
                      <p class="note-title-preview mb-1 text-[#3b2a12]">{{ titleOf(note) }}</p>
                    }
                    <p class="min-h-0 flex-1 whitespace-pre-wrap font-note text-[13px] leading-5 text-[#3b2a12]">
                      @for (part of highlightedParts(preview(note)); track $index) {
                        @if (part.hit) {
                          <mark class="search-hit">{{ part.text }}</mark>
                        } @else {
                          {{ part.text }}
                        }
                      }
                    </p>
                    <button
                      type="button"
                      class="mt-3 self-start rounded-full bg-[#4f7a5a] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white"
                      (click)="restore(note); $event.stopPropagation()"
                    >
                      Restaurar
                    </button>
                  </article>
                } @empty {
                  <p class="col-span-full px-2 py-10 text-center text-sm text-[#7a5a28]/80">
                    {{ query().trim() ? 'Ninguna nota hecha coincide con la búsqueda.' : 'No hay notas en el basurero este día.' }}
                  </p>
                }
              }
            </div>
          </div>
        </div>

        <button
          type="button"
          class="trash-can relative z-20 flex flex-col items-center touch-none"
          (pointerdown)="startTrashMove($event)"
          (click)="onTrashClick($event)"
          aria-label="Abrir basurero"
        >
          <span
            class="trash-visual relative flex h-12 w-12 items-center justify-center overflow-visible bg-transparent"
            [class.is-catching]="trashCatching()"
          >
            <svg class="trash-icon h-12 w-12 text-[#e8d7b0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <g class="trash-lid">
                <path d="M4 7h16" stroke-linecap="round"/>
                <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </g>
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>
              <path d="M10 11v6M14 11v6" stroke-linecap="round"/>
            </svg>
            @if (trashCount() > 0) {
              <span class="dock-count pointer-events-none">{{ trashCount() }}</span>
            }
          </span>
          <span class="mt-2 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f8ecd4]/85">
            Basurero
          </span>
        </button>
      </div>

      <div
        #doneDock
        class="fixed z-[55]"
        [style.left.px]="donePos().x"
        [style.top.px]="donePos().y"
        (pointerenter)="keepDoneOpen()"
        (pointerleave)="hideDoneSoon()"
      >
        <div
          class="trash-bubble absolute z-10"
          [class.is-open]="doneOpen()"
          [class.open-left]="doneOpensLeft()"
          [class.open-up]="doneOpensUp()"
          [class.cols-3]="doneCount() > 4"
          (pointerenter)="keepDoneOpen()"
          (pointerleave)="hideDoneSoon()"
        >
          <div class="trash-bubble-inner">
            <div class="border-b border-[#3b2a12]/10 px-6 py-4">
              <p class="text-[10px] font-extrabold uppercase tracking-[0.26em] text-[#7a5a28]">Completadas</p>
              <p class="font-note text-xl text-[#3b2a12]">Notas hechas</p>
            </div>
            <div class="trash-note-grid">
              @if (doneOpen()) {
                @for (note of doneNotes(); track note.id; let i = $index) {
                  <article
                    class="trash-note sticky-paper flex min-h-[108px] flex-col rounded-[3px] p-2 shadow-sm"
                    [attr.data-color]="colorOf(note)"
                    [style.animation-delay.ms]="70 + i * 45"
                  >
                    @if (titleOf(note)) {
                      <p class="note-title-preview mb-1 text-[#3b2a12]">{{ titleOf(note) }}</p>
                    }
                    <p class="min-h-0 flex-1 whitespace-pre-wrap font-note text-[13px] leading-5 text-[#3b2a12]">
                      @for (part of highlightedParts(preview(note)); track $index) {
                        @if (part.hit) {
                          <mark class="search-hit">{{ part.text }}</mark>
                        } @else {
                          {{ part.text }}
                        }
                      }
                    </p>
                    <button
                      type="button"
                      class="mt-3 self-start rounded-full bg-[#4f7a5a] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white"
                      (click)="restore(note); $event.stopPropagation()"
                    >
                      Restaurar
                    </button>
                  </article>
                } @empty {
                  <p class="col-span-full px-2 py-10 text-center text-sm text-[#7a5a28]/80">
                    {{ query().trim() ? 'Ninguna nota hecha coincide con la búsqueda.' : 'No hay notas hechas este día.' }}
                  </p>
                }
              }
            </div>
          </div>
        </div>

        <button
          type="button"
          class="done-pile relative z-20 flex flex-col items-center touch-none"
          (pointerdown)="startDoneMove($event)"
          (click)="onDoneClick($event)"
          aria-label="Notas hechas"
        >
          <span class="relative flex h-12 w-12 items-center justify-center overflow-visible">
            @for (note of stackedNotes(); track note.id; let i = $index) {
              <span
                class="done-sheet sticky-paper absolute left-1/2 top-0 rounded-[2px] shadow-sticky"
                [attr.data-color]="colorOf(note)"
                [style.z-index]="i + 1"
                [style.transform]="stackTransform(i)"
              >
                <span class="sticky-tape mx-auto mt-1 block h-1 w-3.5 rounded-sm"></span>
                @if (titleOf(note)) {
                  <span class="note-title-preview mt-0.5 block px-1 text-[13px] leading-3 text-[#3b2a12]">{{ titleOf(note) }}</span>
                } @else {
                  <span class="mt-0.5 block px-1 font-note text-[7px] leading-3 text-[#3b2a12]/80">{{ preview(note) }}</span>
                }
              </span>
            }
            @if (!stackedNotes().length) {
              @for (layer of [0, 1, 2]; track layer) {
                <span
                  class="done-sheet sticky-paper absolute left-1/2 top-0 rounded-[2px] shadow-sticky opacity-70"
                  [style.z-index]="layer + 1"
                  [style.transform]="stackTransform(layer)"
                >
                  <span class="sticky-tape mx-auto mt-1 block h-1 w-3.5 rounded-sm"></span>
                </span>
              }
            }
            @if (doneCount() > 0) {
              <span class="dock-count pointer-events-none">{{ doneCount() }}</span>
            }
          </span>
          <span class="mt-1 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f8ecd4]/85">
            Hechas
          </span>
        </button>
      </div>

      @if (expandedNote(); as note) {
        <div class="note-expand-backdrop" [class.is-full]="expandLevel() === 2" (click)="closeExpanded()">
          <article
            class="sticky-paper note-expanded relative flex flex-col p-5 shadow-sticky"
            [attr.data-color]="colorOf(note)"
            [class.is-alarming]="isAlarming(note)"
            [class.is-full]="expandLevel() === 2"
            (click)="$event.stopPropagation()"
            (pointerdown)="$event.stopPropagation()"
            (dragover)="onNoteDragOver($event, note)"
            (drop)="onNoteDrop($event, note)"
          >
            <div class="mb-3 flex items-start justify-between gap-2">
              <div class="flex shrink-0 items-center gap-0.5">
                <div class="note-color-wrap relative">
                  <button
                    type="button"
                    class="note-icon-btn is-color"
                    title="Cambiar color"
                    (click)="toggleColorPicker(note, true); $event.stopPropagation()"
                  >
                    <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#fffdf6" d="M12 3.2C7.4 3.2 3.6 6.4 3.6 10.6c0 2.8 1.8 4.6 3.8 4.6.8 0 1.2-.5 1.4-1.1.3-.9 1.2-1.5 2.1-1.5h1.1c4.4 0 8.4-2.2 8.4-5.4C20.4 4.8 16.7 3.2 12 3.2z"/>
                      <circle fill="#c23b22" cx="7.4" cy="8.4" r="1.15"/>
                      <circle fill="#e0a12b" cx="11.2" cy="6.7" r="1.15"/>
                      <circle fill="#3b9a5a" cx="15.2" cy="8.2" r="1.15"/>
                      <circle fill="#3b7dd8" cx="10.2" cy="11.1" r="1.05"/>
                    </svg>
                  </button>
                </div>
                <div class="note-remind-wrap relative">
                  <button
                    type="button"
                    class="note-icon-btn is-remind"
                    [class.is-set]="hasUpcomingReminder(note)"
                    [class.is-alarming]="isAlarming(note)"
                    [title]="reminderTitle(note)"
                    (click)="toggleReminderPicker(note, true); $event.stopPropagation()"
                  >
                    <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                      <circle cx="12" cy="13" r="7"/>
                      <path d="M12 13V9M12 13l3 2M9 4l-3 2M15 4l3 2"/>
                    </svg>
                  </button>
                </div>
              </div>
              <input
                class="note-title note-title-lg min-w-0 flex-1"
                [attr.id]="'note-title-exp-' + note.id"
                [ngModel]="note.title"
                (ngModelChange)="setTitle(note, $event)"
                (blur)="save(note)"
                (keydown.enter)="focusBody(note); $event.preventDefault()"
                placeholder="Título (opcional)"
                maxlength="120"
                autocomplete="off"
              />
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="note-icon-btn"
                  [title]="expandLevel() === 2 ? 'Minimizar' : 'Pantalla completa'"
                  (click)="maximize(note)"
                >
                  <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    @if (expandLevel() === 2) {
                      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke-linecap="round" stroke-linejoin="round"/>
                    } @else {
                      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke-linecap="round"/>
                    }
                  </svg>
                </button>
                <button
                  type="button"
                  class="note-icon-btn is-done"
                  title="Hecho"
                  (click)="markDone(note)"
                >
                  <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M5 12.5l4.2 4.2L19 7" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="note-icon-btn is-delete"
                  title="Eliminar"
                  (click)="discard(note)"
                >
                  <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            @if (note.recording_id) {
              <div class="note-voice is-wide">
                <button
                  type="button"
                  class="note-voice-play"
                  [class.is-on]="isVoicePlaying(note)"
                  [title]="isVoicePlaying(note) ? 'Pausar' : 'Escuchar'"
                  (click)="toggleVoice(note); $event.stopPropagation()"
                >
                  @if (isVoicePlaying(note)) {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="5" width="4.5" height="14" rx="1"/>
                      <rect x="13.5" y="5" width="4.5" height="14" rx="1"/>
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5.5v13l11-6.5-11-6.5z"/>
                    </svg>
                  }
                </button>
                <button
                  type="button"
                  class="note-voice-bar"
                  title="Posición"
                  (click)="seekVoice($event, note)"
                >
                  <i [style.width.%]="voiceProgress(note)"></i>
                </button>
                <span class="note-voice-time">{{ voiceClock(note) }}</span>
              </div>
            }
            <div
              class="note-canvas min-h-0 flex-1"
              (dragover)="onNoteDragOver($event, note)"
              (drop)="onNoteDrop($event, note)"
            >
              <div
                class="note-canvas-space"
                [class.is-drawing]="drawTool() !== 'cursor'"
                [style.minWidth.px]="canvasExtent(note).w || null"
                [style.minHeight.px]="canvasExtent(note).h || null"
              >
                <textarea
                  class="note-canvas-text bg-transparent font-note text-[14px] leading-6 text-[#3b2a12] outline-none"
                  [attr.id]="'note-body-exp-' + note.id"
                  [ngModel]="textOf(note)"
                  (ngModelChange)="setText(note, $event)"
                  (blur)="save(note)"
                  placeholder="Escribe, pega o arrastra una imagen…"
                ></textarea>
                @for (image of imagesOf(note); track image.id) {
                  <div
                    class="note-image-item"
                    [class.is-moving]="imageDrag()?.id === image.id"
                    [class.is-original]="showsOriginalImage(note)"
                    [style.left.px]="displayBox(note, image).x"
                    [style.top.px]="displayBox(note, image).y"
                    [style.width.px]="displayBox(note, image).w || null"
                    [style.height.px]="displayBox(note, image).h || null"
                    (pointerdown)="startImageMove($event, note, image.id)"
                  >
                    <img
                      [src]="image.src"
                      alt=""
                      draggable="false"
                      (load)="onImageLoad(note, image, $event)"
                    />
                    @for (corner of imageCorners; track corner) {
                      <span
                        class="note-image-handle"
                        [class.nw]="corner === 'nw'"
                        [class.ne]="corner === 'ne'"
                        [class.sw]="corner === 'sw'"
                        [class.se]="corner === 'se'"
                        (pointerdown)="startImageResize($event, note, image.id, corner)"
                      >
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          @if (corner === 'nw') {
                            <path d="M2 8V2h6"/>
                          }
                          @if (corner === 'ne') {
                            <path d="M4 2h6v6"/>
                          }
                          @if (corner === 'sw') {
                            <path d="M2 4v6h6"/>
                          }
                          @if (corner === 'se') {
                            <path d="M10 4v6H4"/>
                          }
                        </svg>
                      </span>
                    }
                    <button
                      type="button"
                      class="note-image-remove"
                      (click)="removeImage(note, $index); $event.stopPropagation()"
                      (pointerdown)="$event.stopPropagation()"
                    >×                    </button>
                  </div>
                }
                @if (expandLevel() === 2) {
                  <div
                    class="note-draw-layer"
                    [class.is-active]="drawTool() !== 'cursor'"
                    [class.is-text]="drawTool() === 'text'"
                    [class.is-selecting]="drawTool() === 'cursor'"
                    (pointerdown)="onDrawPointerDown($event, note)"
                  >
                    <svg class="note-draw-svg" aria-hidden="true">
                      <defs>
                        @for (mark of visibleMarks(note); track mark.id) {
                          @if (mark.kind === 'arrow') {
                            <marker [attr.id]="'note-arrow-mark-' + mark.id" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto">
                              <path d="M0 0L12 6L0 12z" [attr.fill]="mark.color"/>
                            </marker>
                          }
                        }
                      </defs>
                      @for (mark of visibleMarks(note); track mark.id) {
                        @if (mark.kind === 'arrow') {
                          <g
                            class="note-draw-mark"
                            [class.is-moving]="markDrag()?.id === mark.id"
                            (pointerdown)="startMarkMove($event, note, mark)"
                          >
                            <line
                              class="note-draw-hit"
                              [attr.x1]="mark.x"
                              [attr.y1]="mark.y"
                              [attr.x2]="mark.x + mark.w"
                              [attr.y2]="mark.y + mark.h"
                              [attr.stroke-width]="hitWidth(mark)"
                              stroke="transparent"
                              stroke-linecap="round"
                            />
                            <line
                              [attr.x1]="mark.x"
                              [attr.y1]="mark.y"
                              [attr.x2]="mark.x + mark.w"
                              [attr.y2]="mark.y + mark.h"
                              [attr.stroke]="mark.color"
                              [attr.stroke-width]="mark.width || 3"
                              stroke-linecap="round"
                              [attr.marker-end]="'url(#note-arrow-mark-' + mark.id + ')'"
                            />
                          </g>
                        }
                        @if (mark.kind === 'circle') {
                          <g
                            class="note-draw-mark"
                            [class.is-moving]="markDrag()?.id === mark.id"
                            (pointerdown)="startMarkMove($event, note, mark)"
                          >
                            <ellipse
                              class="note-draw-hit is-box"
                              [attr.cx]="shapeBox(mark).x + shapeBox(mark).w / 2"
                              [attr.cy]="shapeBox(mark).y + shapeBox(mark).h / 2"
                              [attr.rx]="shapeBox(mark).w / 2"
                              [attr.ry]="shapeBox(mark).h / 2"
                              [attr.stroke-width]="hitWidth(mark)"
                              stroke="transparent"
                              fill="transparent"
                            />
                            <ellipse
                              [attr.cx]="shapeBox(mark).x + shapeBox(mark).w / 2"
                              [attr.cy]="shapeBox(mark).y + shapeBox(mark).h / 2"
                              [attr.rx]="shapeBox(mark).w / 2"
                              [attr.ry]="shapeBox(mark).h / 2"
                              [attr.stroke]="mark.color"
                              fill="transparent"
                              [attr.stroke-width]="mark.width || 3"
                            />
                          </g>
                        }
                        @if (mark.kind === 'square') {
                          <g
                            class="note-draw-mark"
                            [class.is-moving]="markDrag()?.id === mark.id"
                            (pointerdown)="startMarkMove($event, note, mark)"
                          >
                            <rect
                              class="note-draw-hit is-box"
                              [attr.x]="shapeBox(mark).x"
                              [attr.y]="shapeBox(mark).y"
                              [attr.width]="shapeBox(mark).w"
                              [attr.height]="shapeBox(mark).h"
                              [attr.stroke-width]="hitWidth(mark)"
                              stroke="transparent"
                              fill="transparent"
                            />
                            <rect
                              [attr.x]="shapeBox(mark).x"
                              [attr.y]="shapeBox(mark).y"
                              [attr.width]="shapeBox(mark).w"
                              [attr.height]="shapeBox(mark).h"
                              [attr.stroke]="mark.color"
                              fill="transparent"
                              [attr.stroke-width]="mark.width || 3"
                            />
                          </g>
                        }
                      }
                    </svg>
                    @for (mark of marksOf(note); track mark.id) {
                      @if (mark.kind === 'text') {
                        <textarea
                          class="note-draw-text"
                          [class.is-moving]="markDrag()?.id === mark.id"
                          [attr.id]="'mark-text-' + mark.id"
                          [style.left.px]="placedMark(mark).x"
                          [style.top.px]="placedMark(mark).y"
                          [style.color]="mark.color"
                          [style.fontSize.px]="12 + (mark.width || 3) * 2"
                          [ngModel]="mark.text || ''"
                          (ngModelChange)="setMarkText(note, mark.id, $event)"
                          (blur)="save(note)"
                          (pointerdown)="onTextPointerDown($event, note, mark)"
                          placeholder="Texto…"
                        ></textarea>
                      }
                    }
                  </div>
                }
              </div>
              @if (dropTargetId() === note.id) {
                <div class="note-drop-hint">Suelta la imagen</div>
              }
            </div>
          </article>
        </div>
      }

      @if (expandLevel() === 2 && expandedNote()) {
        <aside
          class="draw-palette"
          [style.left.px]="palettePos().x"
          [style.top.px]="palettePos().y"
          (click)="$event.stopPropagation()"
          (pointerdown)="$event.stopPropagation()"
        >
          <button type="button" class="draw-palette-grip" title="Mover paleta" (pointerdown)="startPaletteMove($event)">
            <span></span><span></span><span></span>
          </button>
          <button type="button" class="draw-tool" [class.is-on]="drawTool() === 'cursor'" title="Seleccionar" (click)="drawTool.set('cursor')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-6.2 1.5L16 21l-2.2.8-3.2-7.4L5 17.5V3z"/></svg>
          </button>
          <button type="button" class="draw-tool" [class.is-on]="drawTool() === 'text'" title="Texto" (click)="drawTool.set('text')">
            <span class="draw-tool-letter">T</span>
          </button>
          <button type="button" class="draw-tool" [class.is-on]="drawTool() === 'arrow'" title="Flecha" (click)="drawTool.set('arrow')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 19L19 5M19 5h-7M19 5v7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="draw-tool" [class.is-on]="drawTool() === 'circle'" title="Círculo" (click)="drawTool.set('circle')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="7"/></svg>
          </button>
          <button type="button" class="draw-tool" [class.is-on]="drawTool() === 'square'" title="Cuadrado" (click)="drawTool.set('square')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>
          </button>
          <span class="draw-palette-line"></span>
          <p class="draw-width-label">Grosor</p>
          <div class="draw-width">
            <button type="button" (click)="nudgeWidth(-1)" aria-label="Más delgado">−</button>
            <span>{{ drawWidth() }}</span>
            <button type="button" (click)="nudgeWidth(1)" aria-label="Más grueso">+</button>
          </div>
          <span class="draw-width-preview" [style.height.px]="drawWidth()" [style.background]="drawColor()"></span>
          <span class="draw-palette-line"></span>
          @for (tone of drawColors; track tone) {
            <button
              type="button"
              class="draw-swatch"
              [class.is-on]="drawColor() === tone"
              [style.background]="tone"
              (click)="drawColor.set(tone)"
            ></button>
          }
          <label class="draw-swatch draw-swatch-any" title="Color">
            <input type="color" [ngModel]="drawColor()" (ngModelChange)="drawColor.set($event)" />
          </label>
          <button type="button" class="draw-tool" title="Deshacer" (click)="undoMark(expandedNote()!)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 8H5V4M5 8a8 8 0 1 1-1.7 5" stroke-linecap="round"/></svg>
          </button>
        </aside>
      }

      @if (error()) {
        <p class="absolute right-6 top-8 z-40 rounded-full bg-black/50 px-4 py-2 text-sm text-[#ffb4b4]">
          {{ error() }}
        </p>
      }

      @if (noteFlyout(); as panel) {
        @if (flyoutNote(); as note) {
          <div
            class="note-flyout"
            [class.is-color]="panel.kind === 'color'"
            [class.is-remind]="panel.kind === 'remind'"
            [style.left.px]="panel.x"
            [style.top.px]="panel.y"
            (pointerdown)="$event.stopPropagation()"
          >
            @if (panel.kind === 'color') {
              <p class="note-flyout-kicker">Color de la nota</p>
              <div class="note-color-grid">
                @for (swatch of noteColors; track swatch.id) {
                  <button
                    type="button"
                    class="note-color-choice"
                    [class.is-on]="colorOf(note) === swatch.id"
                    (click)="setNoteColor(note, swatch.id)"
                  >
                    <span [style.background]="swatch.hex"></span>
                    <em>{{ swatch.label }}</em>
                  </button>
                }
              </div>
            }
            @if (panel.kind === 'remind' && remindDraft(); as draft) {
              <p class="note-flyout-kicker">Recordatorio</p>
              <div class="remind-layout">
                <div>
                  <div class="remind-cal-nav">
                    <button type="button" class="cal-nav" (click)="shiftRemindMonth(-1)" aria-label="Mes anterior">‹</button>
                    <p>{{ monthNames[draft.month] }} {{ draft.year }}</p>
                    <button type="button" class="cal-nav" (click)="shiftRemindMonth(1)" aria-label="Mes siguiente">›</button>
                  </div>
                  <div class="remind-cal-week">
                    @for (day of weekDays; track day) {
                      <span>{{ day }}</span>
                    }
                  </div>
                  <div class="remind-cal-grid">
                    @for (cell of remindCalendarCells(); track $index) {
                      @if (cell.day; as day) {
                        <button
                          type="button"
                          class="remind-cal-day"
                          [class.is-on]="draft.day === day"
                          [class.is-today]="cell.key === todayKey()"
                          (click)="setRemindDay(day)"
                        >
                          {{ day }}
                        </button>
                      } @else {
                        <span></span>
                      }
                    }
                  </div>
                </div>
                <div>
                  <div class="alarm-clock" (pointerdown)="startClockDrag($event, 'face')">
                    @for (hour of clockHours; track hour) {
                      <button
                        type="button"
                        class="alarm-clock-hour"
                        [class.is-on]="remindHour12() === hour"
                        [style.--r.deg]="hour * 30"
                        (click)="setRemindHour12(hour)"
                        (pointerdown)="$event.stopPropagation()"
                      >
                        {{ hour }}
                      </button>
                    }
                    <span
                      class="alarm-clock-hand is-hour"
                      [class.is-dragging]="clockDrag()?.kind === 'hour'"
                      [style.transform]="'rotate(' + (remindHour12() * 30 + draft.minute * 0.5) + 'deg)'"
                      (pointerdown)="startClockDrag($event, 'hour')"
                    ></span>
                    <span
                      class="alarm-clock-hand is-minute"
                      [class.is-dragging]="clockDrag()?.kind === 'minute'"
                      [style.transform]="'rotate(' + (draft.minute * 6) + 'deg)'"
                      (pointerdown)="startClockDrag($event, 'minute')"
                    ></span>
                    <span class="alarm-clock-center"></span>
                  </div>
                  <p class="alarm-clock-time">{{ remindClockLabel() }}</p>
                  <input
                    class="alarm-time-input"
                    type="time"
                    [value]="remindTimeInput()"
                    (input)="setRemindTimeInput($event)"
                    (change)="setRemindTimeInput($event)"
                  />
                  <p class="alarm-when">{{ remindWhenLabel() }}</p>
                  <div class="alarm-ampm">
                    <button type="button" class="alarm-chip" [class.is-on]="draft.hour < 12" (click)="setRemindPeriod(false)">AM</button>
                    <button type="button" class="alarm-chip" [class.is-on]="draft.hour >= 12" (click)="setRemindPeriod(true)">PM</button>
                  </div>
                  <div class="alarm-minutes">
                    @for (minute of clockMinutes; track minute) {
                      <button type="button" class="alarm-chip" [class.is-on]="draft.minute === minute" (click)="setRemindMinute(minute)">
                        {{ minute === 0 ? '00' : minute }}
                      </button>
                    }
                  </div>
                </div>
              </div>
              <p class="note-flyout-kicker" style="margin-top: 10px">Tono de alarma</p>
              <div class="alarm-tones">
                @for (tone of alarmTones; track tone.id) {
                  <button
                    type="button"
                    class="alarm-tone"
                    [class.is-on]="draft.tone === tone.id"
                    [title]="tone.hint"
                    (click)="pickAlarmTone(tone.id)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 5L6 9H3v6h3l5 4V5z" stroke-linejoin="round"/>
                      <path d="M16 9a4 4 0 0 1 0 6" stroke-linecap="round"/>
                    </svg>
                    {{ tone.label }}
                  </button>
                }
              </div>
              <div class="note-flyout-actions">
                <button type="button" class="is-save" (click)="saveReminderDraft(note)">Guardar</button>
                @if (note.reminder_at) {
                  <button type="button" class="is-clear" (click)="isAlarming(note) ? silenceAlarm(note) : clearReminder(note)">
                    {{ isAlarming(note) ? 'Silenciar' : 'Quitar' }}
                  </button>
                }
              </div>
            }
          </div>
        }
      }
    </section>
    <div
      class="clippy-dock"
      [attr.data-mood]="clippyMood()"
      [class.is-minimized]="clippyStep() === 'minimized'"
      [class.is-live]="callLive()"
      (click)="$event.stopPropagation()"
      (pointerdown)="$event.stopPropagation()"
    >
      @if (clippyStep() !== 'minimized' && clippyStep() !== 'enter') {
        <div
          class="clippy-bubble"
          [class.is-wide]="clippyStep() === 'recording' || clippyStep() === 'saving' || clippyStep() === 'offer'"
          [attr.data-mood]="clippyMood()"
        >
          <button type="button" class="clippy-x" title="Ocultar a Clippy" (click)="clippyMinimize()">×</button>
          @if (clippyStep() !== 'recording' && clippyStep() !== 'saving') {
            <p>{{ clippyLine() }}</p>
          }
          @if (clippyStep() === 'offer') {
            @if (callError()) {
              <p class="clippy-error">{{ callError() }}</p>
            }
            <div class="clippy-actions">
              <button type="button" class="clippy-yes" (click)="clippyAcceptCall()">Llamada</button>
              <button type="button" class="clippy-internal" (click)="clippyAcceptInternal()">Interno</button>
              <button type="button" class="clippy-voice" (click)="clippyAcceptVoice()">Voz</button>
              <button type="button" class="clippy-no" (click)="clippyMinimize()">Ahora no</button>
            </div>
          }
          @if (clippyStep() === 'recording' || clippyStep() === 'saving') {
            <div class="clippy-live">
              <div class="clippy-live-head">
                <span class="call-live-dot" [class.is-on]="callLive()"></span>
                <span>{{ callLive() ? voiceCapture() ? 'Grabando nota de voz' : (callInternal() ? 'Escuchando esta computadora' : 'Escuchando el micrófono') : (voiceCapture() ? 'Guardando tu nota de voz' : 'Cerrando captura') }}</span>
                <span class="call-clock">{{ callClock() }}</span>
              </div>
              <div class="call-waves" [class.is-on]="callLive()" aria-hidden="true">
                @for (bar of callBars; track bar) {
                  <span [style.animation-delay.ms]="bar * 90"></span>
                }
              </div>
              @if (callError()) {
                <p class="clippy-error">{{ callError() }}</p>
              }
              <div class="clippy-transcript">
                <p class="clippy-transcript-kicker">{{ voiceCapture() ? 'Lo que vas diciendo' : 'Texto en tiempo real' }}</p>
                <p>{{ callTranscript() || (voiceCapture() ? 'Habla. Clippy guarda el audio para que puedas escucharlo después.' : (callInternal() ? 'Comparte esta pestaña/pantalla y marca “Compartir audio” para oír lo que suena en esta computadora.' : 'Habla. Clippy transcribe lo que oye el micrófono.')) }}</p>
              </div>
            </div>
            @if (clippyStep() === 'recording') {
              <div class="clippy-actions">
                <button type="button" class="clippy-yes" (click)="stopCallCapture()">Listo</button>
              </div>
            }
          }
          @if (clippyStep() === 'notes') {
            <div class="clippy-actions">
              <button type="button" class="clippy-yes" (click)="clippyMakeNotes()">Sí</button>
              <button type="button" class="clippy-no" (click)="clippyMinimize()">Ahora no</button>
            </div>
          }
        </div>
      }
      <button type="button" class="clippy" [attr.data-mood]="clippyMood()" [title]="clippyMood() === 'sleep' ? 'Despertar a Clippy' : 'Clippy'" (click)="clippyTap()">
        <span class="clippy-rings" aria-hidden="true"></span>
        <span class="clippy-aura"></span>
        <span class="clippy-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="clippy-zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>
        <span class="clippy-shine"></span>
        <svg class="clippy-body" viewBox="0 0 72 96" aria-hidden="true">
          <defs>
            <linearGradient id="clippy-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#fff8ea"/>
              <stop offset="38%" stop-color="#e8c56d"/>
              <stop offset="72%" stop-color="#b8883a"/>
              <stop offset="100%" stop-color="#6d4e1e"/>
            </linearGradient>
          </defs>
          <path class="clippy-wire" d="M30 82V26a12 12 0 0 1 24 0v40a18 18 0 0 1-36 0V32a8 8 0 0 1 16 0v32"/>
        </svg>
        <span class="clippy-face">
          <span class="clippy-eye"><i></i></span>
          <span class="clippy-eye"><i></i></span>
          <span class="clippy-brow"></span>
          <span class="clippy-mouth"></span>
        </span>
      </button>
    </div>
  `,
})
export class BoardPage implements AfterViewInit, OnDestroy {
  private readonly notesApi = inject(NotesService);
  private readonly liveCapture = inject(LiveCaptureService);
  private readonly recordingsApi = inject(RecordingsApi);
  @ViewChild('stage') private stage?: ElementRef<HTMLElement>;
  @ViewChild('trashDock') private trashDock?: ElementRef<HTMLElement>;
  @ViewChild('doneDock') private doneDock?: ElementRef<HTMLElement>;

  readonly notes = signal<Note[]>([]);
  readonly error = signal('');
  readonly callLive = signal(false);
  readonly callBusy = signal(false);
  readonly callTranscript = signal('');
  readonly callInternal = signal(false);
  readonly callError = signal('');
  readonly callTick = signal(0);
  readonly callBars = [0, 1, 2, 3, 4, 5, 6];
  readonly clippyStep = signal<'enter' | 'offer' | 'recording' | 'saving' | 'notes' | 'making' | 'done' | 'minimized'>('enter');
  readonly clippyMood = signal<'idle' | 'ask' | 'listen' | 'think' | 'happy' | 'sleep'>('sleep');
  readonly voiceCapture = signal(false);
  readonly voiceNoteId = signal<string | null>(null);
  readonly voicePlaying = signal(false);
  readonly voiceCurrent = signal(0);
  readonly voiceDuration = signal(0);
  readonly clippyLine = computed(() => {
    switch (this.clippyStep()) {
      case 'making':
        return 'Un segundo… estoy sacando el resumen de la llamada.';
      case 'done':
        return this.voiceCapture()
          ? 'Listo. Tu nota de voz ya está en el corcho. Tócala para escucharla.'
          : 'Listo. El resumen ya está en el corcho.';
      case 'notes':
        return '¿Quieres que de esta llamada genere notas?';
      default:
        return '¿Te ayudo con una llamada o una nota de voz?';
    }
  });
  readonly callClock = computed(() => {
    this.callTick();
    if (!this.callStartedAt) return '00:00';
    const total = Math.max(0, Math.floor((Date.now() - this.callStartedAt) / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  });
  readonly draggingPad = signal(false);
  readonly ghost = signal<{ x: number; y: number } | null>(null);
  readonly activeId = signal<string | null>(null);
  readonly draggingNoteId = signal<string | null>(null);
  readonly trashOpen = signal(false);
  readonly trashPos = signal({ x: 24, y: 24 });
  readonly doneOpen = signal(false);
  readonly donePos = signal({ x: 24, y: 24 });
  readonly query = signal('');
  readonly searchTokens = computed(() => this.query().trim().split(/\s+/).filter(Boolean));
  readonly selectedDay = signal(BoardPage.localDayKey());
  readonly calendarOpen = signal(false);
  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth());
  readonly weekDays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  readonly monthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  readonly todayKey = signal(BoardPage.localDayKey());
  readonly isToday = computed(() => this.selectedDay() === this.todayKey());
  readonly canCreateNotes = computed(() => this.selectedDay() >= this.todayKey());
  readonly dateLabel = computed(() => {
    const date = BoardPage.parseDayKey(this.selectedDay());
    const formatted = date.toLocaleDateString('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  });
  readonly calendarCells = computed(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; key: string | null }> = [];
    for (let i = 0; i < lead; i += 1) cells.push({ day: null, key: null });
    for (let day = 1; day <= days; day += 1) {
      cells.push({ day, key: BoardPage.localDayKey(new Date(year, month, day)) });
    }
    return cells;
  });
  readonly daysWithNotes = computed(() => {
    const keys = new Set<string>();
    for (const note of this.notes()) {
      keys.add(this.dayKey(note.created_at));
      if (note.archived) keys.add(this.dayKey(note.updated_at));
    }
    return keys;
  });
  readonly priorities = [1, 2, 3, 4, 5];
  readonly visibleNotes = computed(() =>
    this.notes().filter(
      (note) => !note.archived && !note.pinned && this.matchesDay(note, 'board') && this.matchesQuery(note),
    ),
  );
  readonly trashNotes = computed(() =>
    this.notes().filter((note) => note.archived && this.matchesDay(note, 'trash') && this.matchesQuery(note)),
  );
  readonly trashCount = computed(
    () => this.notes().filter((note) => note.archived && this.matchesDay(note, 'trash')).length,
  );
  readonly doneNotes = computed(() =>
    this.notes().filter(
      (note) => note.pinned && !note.archived && this.matchesDay(note, 'board') && this.matchesQuery(note),
    ),
  );
  readonly doneCount = computed(
    () => this.notes().filter((note) => note.pinned && !note.archived && this.matchesDay(note, 'board')).length,
  );
  readonly stackedNotes = computed(() =>
    this.notes()
      .filter((note) => note.pinned && !note.archived && this.matchesDay(note, 'board'))
      .slice(-6),
  );
  readonly expandedId = signal<string | null>(null);
  readonly expandLevel = signal<1 | 2>(1);
  readonly expandedNote = computed(() => this.notes().find((note) => note.id === this.expandedId()) ?? null);
  readonly dropTargetId = signal<string | null>(null);
  readonly imageDrag = signal<ImageFrame | null>(null);
  readonly noteResize = signal<{ id: string; w: number; h: number } | null>(null);
  readonly imageCorners: ImageCorner[] = ['nw', 'ne', 'sw', 'se'];
  readonly drawTool = signal<DrawTool>('cursor');
  readonly drawColor = signal('#c23b22');
  readonly drawWidth = signal(3);
  readonly drawColors = ['#c23b22', '#e07a2f', '#c9a227', '#4f7a5a', '#4a6280', '#3b2a12', '#f8ecd4'];
  readonly palettePos = signal({ x: 0, y: 0 });
  readonly drawDraft = signal<NoteMark | null>(null);
  readonly markDrag = signal<{ id: string; x: number; y: number } | null>(null);
  readonly flyingNote = signal<{
    x: number;
    y: number;
    w: number;
    h: number;
    dx: number;
    dy: number;
    rot: string;
    body: string;
    moving: boolean;
  } | null>(null);
  readonly tossingNote = signal<{
    x: number;
    y: number;
    w: number;
    h: number;
    dx: number;
    dy: number;
    lift: number;
    spin: string;
    body: string;
    moving: boolean;
  } | null>(null);
  readonly trashCatching = signal(false);
  readonly opensLeft = computed(() => this.trashPos().x > window.innerWidth * 0.55);
  readonly opensUp = computed(() => this.trashPos().y > window.innerHeight * 0.45);
  readonly doneOpensLeft = computed(() => this.donePos().x > window.innerWidth * 0.55);
  readonly doneOpensUp = computed(() => this.donePos().y > window.innerHeight * 0.45);

  private moving: { note: Note; dx: number; dy: number } | null = null;
  private resizingNote: {
    note: Note;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null = null;
  private movingImage: {
    note: Note;
    id: string;
    canvas: HTMLElement;
    mode: 'move' | ImageCorner;
    dx: number;
    dy: number;
    start: { x: number; y: number; w: number; h: number };
    ratio: number;
  } | null = null;
  private movingTrash: { dx: number; dy: number; startX: number; startY: number } | null = null;
  private movingDone: { dx: number; dy: number; startX: number; startY: number } | null = null;
  private movingPalette: { dx: number; dy: number } | null = null;
  private movingMark: {
    note: Note;
    id: string;
    kind: NoteMark['kind'];
    dx: number;
    dy: number;
    layer: HTMLElement;
  } | null = null;
  private drawing: { note: Note; layer: HTMLElement } | null = null;
  private trashWasDragged = false;
  private doneWasDragged = false;
  private hideTrashTimer: ReturnType<typeof setTimeout> | null = null;
  private tossTimer: ReturnType<typeof setTimeout> | null = null;
  private catchTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private trashCustom = false;
  private doneCustom = false;
  private hideDoneTimer: ReturnType<typeof setTimeout> | null = null;
  private dayTimer: ReturnType<typeof setTimeout> | null = null;
  private callTimer: ReturnType<typeof setInterval> | null = null;
  private callSession: LiveSession | null = null;
  private callStartedAt = 0;
  private callGeneration = 0;
  private callRecordingId: string | null = null;
  private voiceAudio: HTMLAudioElement | null = null;
  private clippyTimer: ReturnType<typeof setTimeout> | null = null;
  private clippySession = false;
  private seenNoteIds: Set<string> | null = null;
  private identityKeys = new Map<string, string>();
  private alarmTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private beepOsc: OscillatorNode | null = null;
  private beepGain: GainNode | null = null;
  private beepPulse: ReturnType<typeof setInterval> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private soundingTone: string | null = null;
  private alarmNotified = new Set<string>();
  private patchChains = new Map<string, Promise<void>>();
  private followToday = true;
  private trashOpenedAt = 0;
  private doneOpenedAt = 0;
  private zRanks: Record<string, number> = {};
  private zTop = 10;
  readonly imageNaturals = signal<Record<string, { w: number; h: number }>>({});
  readonly noteColors = NOTE_COLORS;
  readonly alarmTones = ALARM_TONES;
  readonly clockHours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  readonly clockMinutes = [0, 15, 30, 45];
  readonly sparkIndex = [0, 1, 2, 3, 4, 5];
  readonly spawning = signal<Record<string, number>>({});
  readonly spawnBursts = signal<Array<{ id: string; noteId: string; x: number; y: number; w: number; h: number; hex: string }>>([]);
  readonly noteFlyout = signal<{
    kind: 'color' | 'remind';
    noteId: string;
    x: number;
    y: number;
    side: 'left' | 'right';
    expanded: boolean;
  } | null>(null);
  readonly remindDraft = signal<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    tone: string;
  } | null>(null);
  readonly nowTick = signal(Date.now());
  readonly alarmingIds = computed(() => {
    const now = this.nowTick();
    const ids = new Set<string>();
    for (const note of this.notes()) {
      if (!note.reminder_at || note.archived || note.reminder_silenced) continue;
      const at = Date.parse(note.reminder_at);
      if (Number.isFinite(at) && at <= now) ids.add(note.id);
    }
    return ids;
  });
  readonly upcomingReminderIds = computed(() => {
    const now = this.nowTick();
    const ids = new Set<string>();
    for (const note of this.notes()) {
      if (!note.reminder_at || note.archived || note.reminder_silenced) continue;
      const at = Date.parse(note.reminder_at);
      if (Number.isFinite(at) && at > now) ids.add(note.id);
    }
    return ids;
  });
  readonly clockDrag = signal<{ kind: 'hour' | 'minute'; cx: number; cy: number } | null>(null);
  readonly flyoutNote = computed(() => {
    const id = this.noteFlyout()?.noteId;
    return id ? (this.notes().find((note) => note.id === id) ?? null) : null;
  });
  readonly remindCalendarCells = computed(() => {
    const draft = this.remindDraft();
    if (!draft) return [];
    const lead = (new Date(draft.year, draft.month, 1).getDay() + 6) % 7;
    const days = new Date(draft.year, draft.month + 1, 0).getDate();
    const cells: Array<{ day: number | null; key: string | null }> = [];
    for (let i = 0; i < lead; i += 1) cells.push({ day: null, key: null });
    for (let day = 1; day <= days; day += 1) {
      cells.push({ day, key: BoardPage.localDayKey(new Date(draft.year, draft.month, day)) });
    }
    return cells;
  });

  constructor() {
    this.refresh();
    this.syncToday();
    this.armDayClock();
    this.armAlarms();
    effect(() => {
      this.alarmingIds();
      untracked(() => this.syncAlarmSound());
    });
  }

  private static localDayKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private static parseDayKey(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  ngAfterViewInit(): void {
    const savedTrash = this.readDockPos('meeter.trash-pos');
    if (savedTrash) {
      this.trashCustom = true;
      this.trashPos.set(this.clampTrash(savedTrash.x, savedTrash.y));
    } else {
      this.trashPos.set(this.placeTrashDefault());
    }
    const savedDone = this.readDockPos('meeter.done-pos');
    if (savedDone) {
      this.doneCustom = true;
      this.donePos.set(this.clampDone(savedDone.x, savedDone.y));
    } else {
      this.donePos.set(this.placeDoneAboveTrash());
    }
    this.trashPos.update((pos) => this.clampTrash(this.donePos().x, pos.y));
  }

  ngOnDestroy(): void {
    this.keepTrashOpen();
    this.keepDoneOpen();
    if (this.tossTimer) clearTimeout(this.tossTimer);
    if (this.catchTimer) clearTimeout(this.catchTimer);
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    if (this.dayTimer) clearTimeout(this.dayTimer);
    if (this.callTimer) clearInterval(this.callTimer);
    if (this.clippyTimer) clearTimeout(this.clippyTimer);
    if (this.alarmTimer) clearInterval(this.alarmTimer);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.stopAlarmSound();
    this.stopVoice();
    if (this.callSession) {
      void this.callSession.stop();
      this.callSession = null;
    }
  }

  toggleCalendar(event: Event): void {
    event.stopPropagation();
    if (this.calendarOpen()) {
      this.calendarOpen.set(false);
      return;
    }
    const selected = BoardPage.parseDayKey(this.selectedDay());
    this.viewYear.set(selected.getFullYear());
    this.viewMonth.set(selected.getMonth());
    this.calendarOpen.set(true);
  }

  selectDay(key: string): void {
    this.followToday = key === BoardPage.localDayKey();
    this.selectedDay.set(key);
    this.calendarOpen.set(false);
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'visible') this.syncToday();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.syncToday();
  }

  private syncToday(): void {
    const today = BoardPage.localDayKey();
    this.todayKey.set(today);
    if (!this.followToday) return;
    this.selectedDay.set(today);
    const date = new Date();
    this.viewYear.set(date.getFullYear());
    this.viewMonth.set(date.getMonth());
  }

  private armDayClock(): void {
    if (this.dayTimer) clearTimeout(this.dayTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
    this.dayTimer = setTimeout(() => {
      this.syncToday();
      this.armDayClock();
    }, Math.max(1000, next.getTime() - now.getTime()));
  }

  shiftMonth(delta: number): void {
    const date = new Date(this.viewYear(), this.viewMonth() + delta, 1);
    this.viewYear.set(date.getFullYear());
    this.viewMonth.set(date.getMonth());
  }

  shiftYear(delta: number): void {
    this.viewYear.update((year) => year + delta);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentDown(event: PointerEvent): void {
    void this.ensureAudio()?.resume();
    const target = event.target as HTMLElement | null;
    if (this.calendarOpen() && !target?.closest('.date-filter')) this.calendarOpen.set(false);
    if (!target?.closest('.note-flyout, .note-color-wrap, .note-remind-wrap')) {
      this.closeNoteFlyout();
    }
  }

  private readDockPos(key: string): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const pos = JSON.parse(raw) as { x: number; y: number; custom?: boolean };
      if (!pos?.custom || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
      return pos;
    } catch {
      return null;
    }
  }

  private writeDockPos(key: string, pos: { x: number; y: number }): void {
    try {
      localStorage.setItem(key, JSON.stringify({ ...pos, custom: true }));
    } catch {
      /* ignore */
    }
  }

  private placeTrashDefault(): { x: number; y: number } {
    const board = this.stage?.nativeElement.getBoundingClientRect();
    const right = board?.right ?? window.innerWidth;
    const bottom = board?.bottom ?? window.innerHeight;
    return this.clampTrash(right - 140, bottom - 180);
  }

  private clampTrash(x: number, y: number): { x: number; y: number } {
    const board = this.stage?.nativeElement.getBoundingClientRect();
    const minX = (board?.left ?? 0) + 8;
    const minY = (board?.top ?? 0) + 8;
    const maxX = Math.max(minX, (board?.right ?? window.innerWidth) - 72);
    const maxY = Math.max(minY, (board?.bottom ?? window.innerHeight) - 96);
    return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
  }

  private clampDone(x: number, y: number): { x: number; y: number } {
    const board = this.stage?.nativeElement.getBoundingClientRect();
    const minX = (board?.left ?? 0) + 8;
    const minY = (board?.top ?? 0) + 8;
    const maxX = Math.max(minX, (board?.right ?? window.innerWidth) - 72);
    const maxY = Math.max(minY, (board?.bottom ?? window.innerHeight) - 96);
    return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
  }

  private placeDoneAboveTrash(): { x: number; y: number } {
    const trash = this.trashPos();
    return this.clampDone(trash.x, trash.y - 100);
  }

  rotationOf(note: Note): string {
    return `rotate(${note.rotation}deg)`;
  }

  zOf(note: Note): number {
    return this.zRanks[note.id] ?? 10;
  }

  priorityClass(note: Note, level: number): string {
    if (note.priority !== level) {
      return 'bg-black/10 text-[#5c431c]/70 hover:bg-black/15';
    }
    const active: Record<number, string> = {
      1: 'bg-[#c23b22] text-white shadow',
      2: 'bg-[#e07a2f] text-white shadow',
      3: 'bg-[#c9a227] text-[#1c1408] shadow',
      4: 'bg-[#4f7a5a] text-white shadow',
      5: 'bg-[#4a6280] text-white shadow',
    };
    return active[level] ?? active[3];
  }

  bringForward(note: Note): void {
    this.zTop += 1;
    this.zRanks[note.id] = this.zTop;
    this.activeId.set(note.id);
  }

  isSpawning(note: Note): boolean {
    return this.spawning()[note.id] != null;
  }

  noteIdentity(note: Note): string {
    return this.identityKeys.get(note.id) ?? note.id;
  }

  private paperHex(note: Note): string {
    return NOTE_COLORS.find((item) => item.id === this.colorOf(note))?.hex ?? '#ffe45c';
  }

  private captureNewNotes(): void {
    const notes = this.notes();
    if (!this.seenNoteIds) {
      this.seenNoteIds = new Set(notes.map((note) => note.id));
      return;
    }
    const spawning = this.spawning();
    const localSpawning = Object.keys(spawning).some((id) => id.startsWith('local-'));
    for (const note of notes) {
      if (this.seenNoteIds.has(note.id)) continue;
      this.seenNoteIds.add(note.id);
      if (spawning[note.id] != null) continue;
      if (localSpawning && !note.id.startsWith('local-')) continue;
      if (!note.archived) this.revealNote(note);
    }
    for (const id of [...this.seenNoteIds]) {
      if (!notes.some((note) => note.id === id)) this.seenNoteIds.delete(id);
    }
  }

  private revealNote(note: Note): void {
    if (this.spawning()[note.id] != null) return;
    if (
      this.spawnBursts().some(
        (burst) => Math.abs(burst.x - note.pos_x) < 12 && Math.abs(burst.y - note.pos_y) < 12,
      )
    ) {
      return;
    }
    const started = Date.now();
    this.spawning.update((map) => ({ ...map, [note.id]: started }));
    this.playSpawnSound();
    window.setTimeout(() => {
      this.spawning.update((map) => {
        const hit = Object.entries(map).find(([, at]) => at === started);
        if (!hit) return map;
        const next = { ...map };
        delete next[hit[0]];
        return next;
      });
    }, 800);
  }

  spawnBurstLeft(burst: { noteId: string; x: number }): number {
    return this.notes().find((note) => note.id === burst.noteId)?.pos_x ?? burst.x;
  }

  spawnBurstTop(burst: { noteId: string; y: number }): number {
    return this.notes().find((note) => note.id === burst.noteId)?.pos_y ?? burst.y;
  }

  private transferSpawn(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const key = this.identityKeys.get(fromId) ?? fromId;
    this.identityKeys.set(toId, key);
    this.identityKeys.delete(fromId);
    this.spawning.update((map) => {
      if (map[fromId] == null) return map;
      const next = { ...map };
      next[toId] = next[fromId];
      delete next[fromId];
      return next;
    });
    if (this.zRanks[fromId] != null) {
      this.zRanks[toId] = this.zRanks[fromId];
      delete this.zRanks[fromId];
    }
    if (this.activeId() === fromId) this.activeId.set(toId);
    this.seenNoteIds?.delete(fromId);
    this.seenNoteIds?.add(toId);
    this.spawnBursts.update((bursts) =>
      bursts.map((burst) => (burst.noteId === fromId ? { ...burst, noteId: toId } : burst)),
    );
  }

  private playSpawnSound(): void {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    const tap = ctx.createOscillator();
    const gain = ctx.createGain();
    tap.type = 'sine';
    tap.frequency.setValueAtTime(420, now);
    tap.frequency.exponentialRampToValueAtTime(220, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    tap.connect(gain);
    gain.connect(ctx.destination);
    tap.start(now);
    tap.stop(now + 0.18);
  }

  refresh(): void {
    forkJoin({
      board: this.notesApi.list(false),
      trash: this.notesApi.list(true),
    }).subscribe({
      next: ({ board, trash }) => {
        const remote = [...board, ...trash].map((note) => this.normalize(note));
        const local = this.cached().filter(
          (note) => note.id.startsWith('local-') && !remote.some((item) => item.id === note.id),
        );
        this.notes.set([...remote, ...local]);
        this.cache();
        for (const note of remote) {
          const original = [...board, ...trash].find((item) => item.id === note.id);
          if (original?.pinned && original.archived && !note.archived) this.save(note);
        }
        queueMicrotask(() => {
          this.arrangeByPriority();
          this.captureNewNotes();
        });
      },
      error: () => {
        this.notes.set(this.cached());
        this.error.set('');
        queueMicrotask(() => {
          this.arrangeByPriority();
          this.captureNewNotes();
        });
      },
    });
  }

  startPadDrag(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.draggingPad.set(true);
    this.ghost.set({ x: event.clientX - 124, y: event.clientY - 40 });
  }

  async startCallCapture(internalAudio = false): Promise<void> {
    const generation = ++this.callGeneration;
    this.callError.set('');
    this.callTranscript.set('');
    this.callRecordingId = null;
    this.callInternal.set(internalAudio);
    this.callLive.set(true);
    this.callStartedAt = Date.now();
    this.callTick.set(0);
    this.armCallClock();
    try {
      const session = await this.liveCapture.start((text) => {
        if (generation !== this.callGeneration) return;
        this.callTranscript.set(text);
      }, { internalAudio });
      if (generation !== this.callGeneration) {
        await session.stop();
        return;
      }
      this.callSession = session;
      if (this.clippyStep() === 'offer' || this.clippyStep() === 'recording') {
        this.clippySession = true;
        this.clippyStep.set('recording');
        this.clippyMood.set('listen');
      }
    } catch {
      if (generation !== this.callGeneration) return;
      this.callLive.set(false);
      this.callSession = null;
      this.callStartedAt = 0;
      if (this.callTimer) {
        clearInterval(this.callTimer);
        this.callTimer = null;
      }
      this.callError.set(
        this.voiceCapture()
          ? 'No se pudo acceder al micrófono. Permite el audio para grabar la nota de voz.'
          : 'No se pudo acceder al micrófono. Permite el audio para capturar la llamada.',
      );
      if (this.clippyStep() === 'recording') {
        this.clippyStep.set('offer');
        this.clippyMood.set('ask');
      }
    }
  }

  async stopCallCapture(): Promise<void> {
    const session = this.callSession;
    const voice = this.voiceCapture();
    this.callSession = null;
    this.callLive.set(false);
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
    if (this.clippySession) {
      this.clippyStep.set('saving');
      this.clippyMood.set('think');
    }
    if (!session) {
      if (voice) {
        this.callError.set('No se grabó audio. Inténtalo de nuevo.');
        this.clippyStep.set('offer');
        this.clippyMood.set('ask');
        return;
      }
      this.afterCallStopped();
      return;
    }
    this.callBusy.set(true);
    try {
      const result = await session.stop();
      if (result.transcript) this.callTranscript.set(result.transcript);
      if (result.blob.size) {
        const file = new File(
          [result.blob],
          voice ? 'nota-de-voz.webm' : 'llamada.webm',
          { type: result.blob.type || 'audio/webm' },
        );
        const title = voice ? `Nota de voz ${this.dateLabel()}` : `Llamada ${this.dateLabel()}`;
        const recording = await firstValueFrom(
          this.recordingsApi.upload(file, title, result.durationSeconds),
        );
        this.callRecordingId = recording.id;
      }
      if (voice) {
        if (!this.callRecordingId) throw new Error('empty-audio');
        await this.saveVoiceNote(this.callRecordingId, result.transcript, result.durationSeconds);
        return;
      }
    } catch {
      this.callError.set(voice ? 'No se pudo guardar la nota de voz.' : 'No se pudo detener la captura.');
      if (voice) {
        this.clippyStep.set('offer');
        this.clippyMood.set('ask');
        return;
      }
    } finally {
      this.callBusy.set(false);
    }
    this.afterCallStopped();
  }

  private armCallClock(): void {
    if (this.callTimer) clearInterval(this.callTimer);
    this.callTimer = setInterval(() => this.callTick.update((value) => value + 1), 250);
  }

  clippyTap(): void {
    if (this.clippyStep() !== 'minimized' && this.clippyStep() !== 'enter') return;
    if (this.clippySession && this.callLive()) {
      this.clippyStep.set('recording');
      this.clippyMood.set('listen');
      return;
    }
    if (this.clippyTimer) clearTimeout(this.clippyTimer);
    this.voiceCapture.set(false);
    this.clippyStep.set('enter');
    this.clippyMood.set('idle');
    this.clippyTimer = window.setTimeout(() => {
      this.clippyStep.set('offer');
      this.clippyMood.set('ask');
    }, 340);
  }

  clippyMinimize(): void {
    const keepSession =
      this.clippySession &&
      (this.callLive() || this.clippyStep() === 'saving' || this.clippyStep() === 'making' || this.clippyStep() === 'recording');
    this.clippyStep.set('minimized');
    this.clippyMood.set(this.callLive() ? 'listen' : 'sleep');
    if (!keepSession) {
      this.clippySession = false;
      this.voiceCapture.set(false);
    }
  }

  clippyAcceptCall(): void {
    this.voiceCapture.set(false);
    this.clippySession = true;
    this.clippyStep.set('recording');
    this.clippyMood.set('listen');
    void this.startCallCapture(false);
  }

  clippyAcceptInternal(): void {
    this.voiceCapture.set(false);
    this.clippySession = true;
    this.clippyStep.set('recording');
    this.clippyMood.set('listen');
    void this.startCallCapture(true);
  }

  clippyAcceptVoice(): void {
    this.voiceCapture.set(true);
    this.clippySession = true;
    this.clippyStep.set('recording');
    this.clippyMood.set('listen');
    void this.startCallCapture(false);
  }

  clippyMakeNotes(): void {
    this.clippyStep.set('making');
    this.clippyMood.set('think');
    const finish = () => {
      this.clippySession = false;
      this.clippyStep.set('done');
      this.clippyMood.set('happy');
      this.refresh();
      window.setTimeout(() => {
        if (this.clippyStep() === 'done') this.clippyMinimize();
      }, 4200);
    };
    this.notesApi
      .fromCall({
        transcript: this.callTranscript(),
        title: `Llamada ${this.dateLabel()}`,
        created_at: this.timestampForSelectedDay(),
        pos_x: 52,
        pos_y: 132,
        color: 'amber',
        recording_id: this.callRecordingId,
      })
      .subscribe({
        next: finish,
        error: () => void this.spawnNotesFromText(this.callTranscript()).then(finish),
      });
  }

  private afterCallStopped(): void {
    if (!this.clippySession) return;
    if (this.voiceCapture()) return;
    this.clippyStep.set('notes');
    this.clippyMood.set('ask');
  }

  private async saveVoiceNote(recordingId: string, transcript: string, durationSeconds: number): Promise<void> {
    const createdAt = this.timestampForSelectedDay();
    const spoken = transcript.trim();
    const clock = this.formatVoiceTime(durationSeconds);
    const body = spoken || `Nota de voz de ${clock}. Pulsa reproducir para escucharla.`;
    await firstValueFrom(
      this.notesApi.create({
        title: 'Nota de voz',
        body,
        color: 'sky',
        recording_id: recordingId,
        priority: 1,
        pos_x: 52,
        pos_y: 132,
        rotation: -1.8,
        width: NOTE_W,
        height: NOTE_H,
        created_at: createdAt,
      }),
    );
    this.clippySession = false;
    this.clippyStep.set('done');
    this.clippyMood.set('happy');
    this.refresh();
    window.setTimeout(() => {
      if (this.clippyStep() === 'done') this.clippyMinimize();
    }, 4200);
  }

  isVoicePlaying(note: Note): boolean {
    return this.voicePlaying() && this.voiceNoteId() === note.id;
  }

  voiceProgress(note: Note): number {
    if (this.voiceNoteId() !== note.id) return 0;
    const duration = this.voiceDuration();
    if (!duration) return 0;
    return Math.min(100, (this.voiceCurrent() / duration) * 100);
  }

  voiceClock(note: Note): string {
    const current = this.voiceNoteId() === note.id ? this.voiceCurrent() : 0;
    const duration = this.voiceNoteId() === note.id ? this.voiceDuration() : 0;
    if (!duration) return this.formatVoiceTime(current);
    return `${this.formatVoiceTime(current)} / ${this.formatVoiceTime(duration)}`;
  }

  toggleVoice(note: Note): void {
    if (!note.recording_id) return;
    if (this.voiceNoteId() === note.id && this.voiceAudio) {
      if (this.voicePlaying()) {
        this.voiceAudio.pause();
        this.voicePlaying.set(false);
      } else {
        void this.voiceAudio.play();
        this.voicePlaying.set(true);
      }
      return;
    }
    this.stopVoice();
    const audio = new Audio(this.recordingsApi.audioUrl(note.recording_id));
    this.voiceAudio = audio;
    this.voiceNoteId.set(note.id);
    this.voiceCurrent.set(0);
    this.voiceDuration.set(0);
    audio.addEventListener('loadedmetadata', () => {
      if (this.voiceAudio === audio) this.voiceDuration.set(Number.isFinite(audio.duration) ? audio.duration : 0);
    });
    audio.addEventListener('timeupdate', () => {
      if (this.voiceAudio === audio) this.voiceCurrent.set(audio.currentTime || 0);
    });
    audio.addEventListener('ended', () => {
      if (this.voiceAudio !== audio) return;
      this.voicePlaying.set(false);
      this.voiceCurrent.set(this.voiceDuration());
    });
    audio.addEventListener('error', () => {
      if (this.voiceAudio !== audio) return;
      this.stopVoice();
      this.error.set('No se pudo reproducir la nota de voz.');
    });
    void audio.play().then(
      () => this.voicePlaying.set(true),
      () => {
        this.error.set('No se pudo reproducir la nota de voz.');
        this.stopVoice();
      },
    );
  }

  seekVoice(event: MouseEvent, note: Note): void {
    if (!note.recording_id) return;
    if (this.voiceNoteId() !== note.id || !this.voiceAudio) {
      this.toggleVoice(note);
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const ratio = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
    const duration = this.voiceAudio.duration || this.voiceDuration();
    if (!duration || !Number.isFinite(duration)) return;
    this.voiceAudio.currentTime = ratio * duration;
    this.voiceCurrent.set(this.voiceAudio.currentTime);
  }

  private formatVoiceTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  private stopVoice(): void {
    if (this.voiceAudio) {
      this.voiceAudio.pause();
      this.voiceAudio.removeAttribute('src');
      this.voiceAudio.load();
      this.voiceAudio = null;
    }
    this.voicePlaying.set(false);
    this.voiceNoteId.set(null);
    this.voiceCurrent.set(0);
    this.voiceDuration.set(0);
  }

  private async spawnNotesFromText(text: string): Promise<void> {
    const body = text.trim() || 'Llamada capturada. Añade aquí lo que quieras recordar.';
    const createdAt = this.timestampForSelectedDay();
    await new Promise<void>((resolve) => {
      this.notesApi
        .create({
          title: 'Notas de la llamada',
          body,
          color: 'yellow',
          recording_id: this.callRecordingId,
          priority: 1,
          pos_x: 52,
          pos_y: 132,
          rotation: -2.2,
          created_at: createdAt,
        })
        .subscribe({ next: () => resolve(), error: () => resolve() });
    });
  }

  startMove(event: PointerEvent, note: Note): void {
    event.preventDefault();
    event.stopPropagation();
    this.bringForward(note);
    this.draggingNoteId.set(note.id);
    const rect = (event.currentTarget as HTMLElement).closest('article')?.getBoundingClientRect();
    this.moving = {
      note,
      dx: event.clientX - (rect?.left ?? note.pos_x),
      dy: event.clientY - (rect?.top ?? note.pos_y),
    };
  }

  startNoteResize(event: PointerEvent, note: Note): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.bringForward(note);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const size = this.noteSize(note);
    this.resizingNote = {
      note,
      startX: event.clientX,
      startY: event.clientY,
      startW: size.w,
      startH: size.h,
    };
    this.noteResize.set({ id: note.id, w: size.w, h: size.h });
  }

  noteSize(note: Note): { w: number; h: number } {
    const drag = this.noteResize();
    if (drag?.id === note.id) return drag;
    const w = note.width || NOTE_W;
    const h = note.height || NOTE_H;
    if (
      (w === 248 && h === 280) ||
      (w === 208 && h === 236) ||
      (w === 176 && h === 198)
    ) {
      return { w: NOTE_W, h: NOTE_H };
    }
    return { w, h };
  }

  startTrashMove(event: PointerEvent): void {
    event.stopPropagation();
    this.trashWasDragged = false;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.movingTrash = {
      dx: event.clientX - this.trashPos().x,
      dy: event.clientY - this.trashPos().y,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  startDoneMove(event: PointerEvent): void {
    event.stopPropagation();
    this.doneWasDragged = false;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.movingDone = {
      dx: event.clientX - this.donePos().x,
      dy: event.clientY - this.donePos().y,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(event: PointerEvent): void {
    if (this.clockDrag()) {
      event.preventDefault();
      this.applyClockDrag(event);
      return;
    }
    if (this.movingPalette) {
      event.preventDefault();
      this.palettePos.set({
        x: Math.min(window.innerWidth - 84, Math.max(8, event.clientX - this.movingPalette.dx)),
        y: Math.min(window.innerHeight - 80, Math.max(8, event.clientY - this.movingPalette.dy)),
      });
      return;
    }
    if (this.drawing) {
      event.preventDefault();
      const draft = this.drawDraft();
      if (!draft) return;
      const rect = this.drawing.layer.getBoundingClientRect();
      this.drawDraft.set({
        ...draft,
        w: event.clientX - rect.left - draft.x,
        h: event.clientY - rect.top - draft.y,
      });
      return;
    }
    if (this.movingMark) {
      event.preventDefault();
      const rect = this.movingMark.layer.getBoundingClientRect();
      this.markDrag.set({
        id: this.movingMark.id,
        x: Math.round(event.clientX - rect.left - this.movingMark.dx),
        y: Math.round(event.clientY - rect.top - this.movingMark.dy),
      });
      return;
    }
    if (this.resizingNote) {
      event.preventDefault();
      const { note, startX, startY, startW, startH } = this.resizingNote;
      this.noteResize.set({
        id: note.id,
        w: Math.max(1, Math.round(startW + event.clientX - startX)),
        h: Math.max(1, Math.round(startH + event.clientY - startY)),
      });
      return;
    }
    if (this.movingImage) {
      event.preventDefault();
      const { canvas, dx, dy, id, mode, start } = this.movingImage;
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left + canvas.scrollLeft;
      const pointerY = event.clientY - rect.top + canvas.scrollTop;
      if (mode === 'move') {
        this.imageDrag.set({
          id,
          x: Math.round(pointerX - dx),
          y: Math.round(pointerY - dy),
          w: start.w,
          h: start.h,
        });
      } else {
        this.imageDrag.set({ id, ...this.resizedFrame(start, mode, pointerX, pointerY, this.movingImage.ratio) });
      }
      return;
    }
    if (this.movingTrash) {
      event.preventDefault();
      const dragged =
        Math.hypot(event.clientX - this.movingTrash.startX, event.clientY - this.movingTrash.startY) > 8;
      if (!dragged) return;
      this.trashWasDragged = true;
      this.trashOpen.set(false);
      this.trashPos.set(
        this.clampTrash(event.clientX - this.movingTrash.dx, event.clientY - this.movingTrash.dy),
      );
      return;
    }
    if (this.movingDone) {
      event.preventDefault();
      const dragged =
        Math.hypot(event.clientX - this.movingDone.startX, event.clientY - this.movingDone.startY) > 8;
      if (!dragged) return;
      this.doneWasDragged = true;
      this.doneOpen.set(false);
      this.donePos.set(
        this.clampDone(event.clientX - this.movingDone.dx, event.clientY - this.movingDone.dy),
      );
      return;
    }
    if (this.draggingPad()) {
      event.preventDefault();
      this.ghost.set({ x: event.clientX - 124, y: event.clientY - 40 });
      return;
    }
    if (!this.moving || !this.stage) return;
    event.preventDefault();
    const origin = this.stage.nativeElement.getBoundingClientRect();
    this.moving.note.pos_x = Math.max(8, event.clientX - origin.left - this.moving.dx);
    this.moving.note.pos_y = Math.max(8, event.clientY - origin.top - this.moving.dy);
    this.notes.update((items) => [...items]);
  }

  openTrash(): void {
    this.keepTrashOpen();
    this.trashOpenedAt = Date.now();
    this.trashOpen.set(true);
  }

  onTrashClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.trashWasDragged) this.openTrash();
  }

  keepTrashOpen(): void {
    if (this.hideTrashTimer) {
      clearTimeout(this.hideTrashTimer);
      this.hideTrashTimer = null;
    }
  }

  hideTrashSoon(): void {
    if (Date.now() - this.trashOpenedAt < 280) return;
    this.keepTrashOpen();
    this.hideTrashTimer = setTimeout(() => {
      this.trashOpen.set(false);
      this.hideTrashTimer = null;
    }, 160);
  }

  openDone(): void {
    this.keepDoneOpen();
    this.doneOpenedAt = Date.now();
    this.doneOpen.set(true);
  }

  onDoneClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.doneWasDragged) this.openDone();
  }

  keepDoneOpen(): void {
    if (this.hideDoneTimer) {
      clearTimeout(this.hideDoneTimer);
      this.hideDoneTimer = null;
    }
  }

  hideDoneSoon(): void {
    if (Date.now() - this.doneOpenedAt < 280) return;
    this.keepDoneOpen();
    this.hideDoneTimer = setTimeout(() => {
      this.doneOpen.set(false);
      this.hideDoneTimer = null;
    }, 160);
  }

  preview(note: Note): string {
    const text = this.textOf(note).trim();
    if (!text) return this.imagesOf(note).length ? 'Nota con imagen' : 'Nota vacía';
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }

  titleOf(note: Note): string {
    return (note.title ?? '').trim();
  }

  setTitle(note: Note, title: string): void {
    note.title = title;
    this.scheduleCache();
  }

  colorOf(note: Note): string {
    const value = (note.color || 'yellow').toLowerCase();
    return NOTE_COLORS.some((item) => item.id === value) ? value : 'yellow';
  }

  isAlarming(note: Note): boolean {
    return this.alarmingIds().has(note.id);
  }

  hasUpcomingReminder(note: Note): boolean {
    return this.upcomingReminderIds().has(note.id);
  }

  reminderTitle(note: Note): string {
    if (this.isAlarming(note)) return 'Alarma sonando';
    if (!this.hasUpcomingReminder(note) || !note.reminder_at) return 'Recordatorio';
    const date = new Date(note.reminder_at);
    if (Number.isNaN(date.getTime())) return 'Recordatorio';
    const hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `Recordatorio ${(hour % 12) || 12}:${minute} ${hour >= 12 ? 'p. m.' : 'a. m.'}`;
  }

  toggleColorPicker(note: Note, expanded = false): void {
    this.toggleNoteFlyout(note, 'color', expanded);
  }

  setNoteColor(note: Note, color: string): void {
    note.color = color;
    this.patchNote(note.id, { color });
    this.notes.update((items) => [...items]);
    this.closeNoteFlyout();
  }

  toggleReminderPicker(note: Note, expanded = false): void {
    this.toggleNoteFlyout(note, 'remind', expanded);
  }

  private toggleNoteFlyout(note: Note, kind: 'color' | 'remind', expanded: boolean): void {
    const current = this.noteFlyout();
    if (current?.kind === kind && current.noteId === note.id) {
      this.closeNoteFlyout();
      return;
    }
    if (kind === 'remind') this.initRemindDraft(note);
    const width = kind === 'remind' ? 268 : 156;
    const height = kind === 'remind' ? 348 : 196;
    const rect =
      (expanded
        ? document.querySelector('.note-expanded')?.getBoundingClientRect()
        : document.getElementById(`note-card-${note.id}`)?.getBoundingClientRect()) ??
      new DOMRect(note.pos_x, note.pos_y, this.noteSize(note).w, this.noteSize(note).h);
    const gap = 12;
    const side: 'left' | 'right' = window.innerWidth - rect.right >= width + gap + 8 ? 'right' : 'left';
    let x = side === 'right' ? rect.right + gap : rect.left - width - gap;
    let y = rect.top;
    x = Math.min(Math.max(8, x), window.innerWidth - width - 8);
    y = Math.min(Math.max(8, y), window.innerHeight - height - 8);
    this.noteFlyout.set({ kind, noteId: note.id, x, y, side, expanded });
  }

  closeNoteFlyout(): void {
    this.noteFlyout.set(null);
    this.remindDraft.set(null);
  }

  private soonRemindDate(): Date {
    const date = new Date(Date.now() + 2 * 60 * 1000);
    date.setSeconds(0, 0);
    return date;
  }

  private initRemindDraft(note: Note): void {
    const parsed = note.reminder_at ? new Date(note.reminder_at) : null;
    const keep =
      parsed &&
      !Number.isNaN(parsed.getTime()) &&
      !note.reminder_silenced &&
      parsed.getTime() > Date.now();
    const date = keep ? parsed : this.soonRemindDate();
    this.remindDraft.set({
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      tone: this.toneOf(note),
    });
  }

  toneOf(note: Note): string {
    const value = note.alarm_tone || 'classic';
    return ALARM_TONES.some((item) => item.id === value) ? value : 'classic';
  }

  remindHour12(): number {
    const hour = this.remindDraft()?.hour ?? 0;
    return hour % 12 || 12;
  }

  remindClockLabel(): string {
    const draft = this.remindDraft();
    if (!draft) return '';
    const minute = String(draft.minute).padStart(2, '0');
    return `${this.remindHour12()}:${minute} ${draft.hour >= 12 ? 'p. m.' : 'a. m.'}`;
  }

  remindTimeInput(): string {
    const draft = this.remindDraft();
    if (!draft) return '';
    return `${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`;
  }

  remindWhenLabel(): string {
    const draft = this.remindDraft();
    if (!draft) return '';
    const date = new Date(draft.year, draft.month, draft.day, draft.hour, draft.minute, 0, 0);
    const today = BoardPage.localDayKey();
    const key = BoardPage.localDayKey(date);
    const when = key === today ? 'Hoy' : `${draft.day} ${this.monthNames[draft.month]}`;
    const suffix = date.getTime() <= Date.now() ? ' · suena ahora' : '';
    return `${when} a las ${this.remindClockLabel()}${suffix}`;
  }

  setRemindTimeInput(event: Event): void {
    const draft = this.remindDraft();
    const value = (event.target as HTMLInputElement).value;
    if (!draft || !value) return;
    const [hourText, minuteText] = value.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    this.remindDraft.set({
      ...draft,
      hour: Math.min(23, Math.max(0, hour)),
      minute: Math.min(59, Math.max(0, minute)),
    });
  }

  shiftRemindMonth(delta: number): void {
    const draft = this.remindDraft();
    if (!draft) return;
    const date = new Date(draft.year, draft.month + delta, Math.min(draft.day, 28));
    this.remindDraft.set({ ...draft, year: date.getFullYear(), month: date.getMonth(), day: date.getDate() });
  }

  setRemindDay(day: number): void {
    const draft = this.remindDraft();
    if (!draft) return;
    this.remindDraft.set({ ...draft, day });
  }

  setRemindHour12(hour12: number): void {
    const draft = this.remindDraft();
    if (!draft) return;
    const pm = draft.hour >= 12;
    this.remindDraft.set({ ...draft, hour: (hour12 % 12) + (pm ? 12 : 0) });
  }

  setRemindPeriod(pm: boolean): void {
    const draft = this.remindDraft();
    if (!draft) return;
    const base = draft.hour % 12;
    this.remindDraft.set({ ...draft, hour: base + (pm ? 12 : 0) });
  }

  setRemindMinute(minute: number): void {
    const draft = this.remindDraft();
    if (!draft) return;
    this.remindDraft.set({ ...draft, minute: ((minute % 60) + 60) % 60 });
  }

  startClockDrag(event: PointerEvent, kind: 'hour' | 'minute' | 'face'): void {
    event.preventDefault();
    event.stopPropagation();
    const clock = (event.currentTarget as HTMLElement).closest('.alarm-clock');
    if (!clock) return;
    const rect = clock.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(event.clientX - cx, event.clientY - cy);
    const mode = kind === 'face' ? (dist < rect.width * 0.32 ? 'hour' : 'minute') : kind;
    this.clockDrag.set({ kind: mode, cx, cy });
    this.applyClockDrag(event);
  }

  private applyClockDrag(event: PointerEvent): void {
    const drag = this.clockDrag();
    const draft = this.remindDraft();
    if (!drag || !draft) return;
    let deg = (Math.atan2(event.clientX - drag.cx, drag.cy - event.clientY) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    if (drag.kind === 'minute') {
      this.setRemindMinute(Math.round(deg / 6) % 60);
      return;
    }
    this.setRemindHour12(Math.round(deg / 30) % 12 || 12);
  }

  pickAlarmTone(tone: string): void {
    const draft = this.remindDraft();
    if (!draft) return;
    this.remindDraft.set({ ...draft, tone });
    this.previewAlarmTone(tone);
  }

  saveReminderDraft(note: Note): void {
    const draft = this.remindDraft();
    if (!draft) return;
    const date = new Date(draft.year, draft.month, draft.day, draft.hour, draft.minute, 0, 0);
    note.reminder_at = date.toISOString();
    note.alarm_tone = draft.tone;
    note.reminder_silenced = false;
    this.alarmNotified.delete(note.id);
    this.patchNote(note.id, {
      reminder_at: note.reminder_at,
      alarm_tone: note.alarm_tone,
      reminder_silenced: false,
    });
    this.notes.update((items) => [...items]);
    this.closeNoteFlyout();
    this.syncAlarmSound();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  clearReminder(note: Note): void {
    note.reminder_at = null;
    note.reminder_silenced = false;
    this.alarmNotified.delete(note.id);
    this.patchNote(note.id, { reminder_at: null, reminder_silenced: false });
    this.notes.update((items) => [...items]);
    this.closeNoteFlyout();
    this.syncAlarmSound();
  }

  silenceAlarm(note: Note): void {
    note.reminder_silenced = true;
    this.alarmNotified.add(note.id);
    this.patchNote(note.id, { reminder_silenced: true });
    this.notes.update((items) => [...items]);
    this.closeNoteFlyout();
    this.syncAlarmSound();
  }

  private armAlarms(): void {
    this.alarmTimer = window.setInterval(() => {
      this.nowTick.set(Date.now());
      this.syncAlarmSound();
    }, 400);
  }

  private ensureAudio(): AudioContext | null {
    const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.audioCtx) this.audioCtx = new Ctor();
    return this.audioCtx;
  }

  private syncAlarmSound(): void {
    const ringing = this.notes().filter((note) => this.isAlarming(note));
    if (!ringing.length) {
      this.soundingTone = null;
      this.stopAlarmSound();
      return;
    }
    const tone = this.toneOf(ringing[0]);
    if (this.soundingTone === tone) {
      for (const note of ringing) this.notifyAlarm(note);
      return;
    }
    this.stopAlarmSound();
    this.startAlarmSound(tone);
    for (const note of ringing) this.notifyAlarm(note);
  }

  private notifyAlarm(note: Note): void {
    if (this.alarmNotified.has(note.id)) return;
    this.alarmNotified.add(note.id);
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(this.titleOf(note) || 'Recordatorio', {
        body: this.textOf(note).slice(0, 120) || 'Es hora de ver esta nota.',
      });
    } catch {
      /* ignore */
    }
  }

  private toneConfig(id: string): {
    type: OscillatorType;
    freqs: number[];
    interval: number;
    dur: number;
    vol: number;
    decay?: boolean;
  } {
    switch (id) {
      case 'soft':
        return { type: 'sine', freqs: [523.25, 659.25], interval: 520, dur: 0.32, vol: 0.1 };
      case 'urgent':
        return { type: 'square', freqs: [1240, 420], interval: 130, dur: 0.07, vol: 0.11 };
      case 'digital':
        return { type: 'triangle', freqs: [659, 784, 988], interval: 190, dur: 0.13, vol: 0.12 };
      case 'bell':
        return { type: 'sine', freqs: [784, 392], interval: 920, dur: 0.72, vol: 0.16, decay: true };
      default:
        return { type: 'square', freqs: [980, 660], interval: 280, dur: 0.16, vol: 0.13 };
    }
  }

  private previewAlarmTone(tone: string): void {
    this.stopAlarmSound();
    this.startAlarmSound(tone);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      if (!this.notes().some((note) => this.isAlarming(note))) this.stopAlarmSound();
      else this.syncAlarmSound();
    }, 1400);
  }

  private startAlarmSound(tone = 'classic'): void {
    this.stopAlarmSound();
    const ctx = this.ensureAudio();
    if (!ctx) return;
    this.soundingTone = tone;
    const begin = () => {
      if (this.beepOsc || this.soundingTone !== tone) return;
      const cfg = this.toneConfig(tone);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cfg.type;
      osc.frequency.value = cfg.freqs[0];
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      this.beepOsc = osc;
      this.beepGain = gain;
      this.soundingTone = tone;
      let index = 0;
      const ping = () => {
        if (!this.beepGain || !this.audioCtx || !this.beepOsc) return;
        const t = this.audioCtx.currentTime;
        this.beepOsc.frequency.setValueAtTime(cfg.freqs[index % cfg.freqs.length], t);
        this.beepGain.gain.cancelScheduledValues(t);
        this.beepGain.gain.setValueAtTime(0.0001, t);
        this.beepGain.gain.exponentialRampToValueAtTime(cfg.vol, t + 0.02);
        this.beepGain.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
        index += 1;
      };
      ping();
      this.beepPulse = window.setInterval(ping, cfg.interval);
    };
    if (ctx.state === 'suspended') {
      void ctx.resume().then(begin);
      return;
    }
    begin();
  }

  private stopAlarmSound(): void {
    if (this.beepPulse) {
      clearInterval(this.beepPulse);
      this.beepPulse = null;
    }
    try {
      this.beepOsc?.stop();
    } catch {
      /* already stopped */
    }
    this.beepOsc?.disconnect();
    this.beepGain?.disconnect();
    this.beepOsc = null;
    this.beepGain = null;
    this.soundingTone = null;
  }

  focusBody(note: Note): void {
    const expanded = this.expandedId() === note.id;
    const id = expanded ? `note-body-exp-${note.id}` : `note-body-${note.id}`;
    document.getElementById(id)?.focus();
  }

  textOf(note: Note): string {
    const body = note.body ?? '';
    const cuts = [body.indexOf(IMAGE_MARK), body.indexOf(MARK_MARK)].filter((index) => index >= 0);
    const index = cuts.length ? Math.min(...cuts) : -1;
    return (index === -1 ? body : body.slice(0, index)).replace(/\s+$/, '');
  }

  imagesOf(note: Note): NoteImage[] {
    const parsed = this.payloadOf(note.body, IMAGE_MARK);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, itemIndex) => this.asNoteImage(item, itemIndex))
      .filter((item): item is NoteImage => Boolean(item));
  }

  imageBox(image: NoteImage): { x: number; y: number; w: number; h: number } {
    const drag = this.imageDrag();
    return drag?.id === image.id ? drag : { x: image.x, y: image.y, w: image.w, h: image.h };
  }

  originalSize(image: NoteImage): { w: number; h: number } {
    const loaded = this.imageNaturals()[image.id];
    if (loaded?.w && loaded?.h) return loaded;
    return { w: image.origW || image.w || 0, h: image.origH || image.h || 0 };
  }

  displayBox(note: Note, image: NoteImage): { x: number; y: number; w: number; h: number } {
    const drag = this.imageDrag();
    if (drag?.id === image.id) return drag;
    const copy = { x: image.x, y: image.y, w: image.w, h: image.h };
    const orig = this.originalSize(image);
    if (this.showsOriginalImage(note)) {
      return {
        x: copy.x,
        y: copy.y,
        w: image.fullW || orig.w || copy.w,
        h: image.fullH || orig.h || copy.h,
      };
    }
    const scale = this.viewScale(note);
    if (scale <= 1) return copy;
    const width = Math.round(Math.min(orig.w || copy.w * scale, copy.w * scale));
    const height = Math.round(Math.min(orig.h || copy.h * scale, copy.h * scale));
    return { x: copy.x, y: copy.y, w: width, h: height };
  }

  showsOriginalImage(note: Note): boolean {
    return this.expandedId() === note.id && this.expandLevel() === 2;
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  marksOf(note: Note): NoteMark[] {
    const parsed = this.payloadOf(note.body, MARK_MARK);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is NoteMark => Boolean(item) && typeof item === 'object' && 'kind' in item)
      .map((item) => ({ ...item, width: item.width || 3 }));
  }

  visibleMarks(note: Note): NoteMark[] {
    const draft = this.drawDraft();
    const marks = draft ? [...this.marksOf(note), draft] : this.marksOf(note);
    const drag = this.markDrag();
    if (!drag) return marks;
    return marks.map((mark) => (mark.id === drag.id ? { ...mark, x: drag.x, y: drag.y } : mark));
  }

  placedMark(mark: NoteMark): NoteMark {
    const drag = this.markDrag();
    return drag?.id === mark.id ? { ...mark, x: drag.x, y: drag.y } : mark;
  }

  hitWidth(mark: NoteMark): number {
    return Math.max(18, (mark.width || 3) + 14);
  }

  shapeBox(mark: NoteMark): { x: number; y: number; w: number; h: number } {
    const x = mark.w < 0 ? mark.x + mark.w : mark.x;
    const y = mark.h < 0 ? mark.y + mark.h : mark.y;
    return { x, y, w: Math.abs(mark.w), h: Math.abs(mark.h) };
  }

  placePalette(): void {
    const width = 76;
    const height = 520;
    this.palettePos.set({
      x: Math.max(12, window.innerWidth - width - 20),
      y: Math.max(12, Math.round((window.innerHeight - height) / 2)),
    });
  }

  nudgeWidth(delta: number): void {
    this.drawWidth.update((value) => Math.min(16, Math.max(1, value + delta)));
  }

  startPaletteMove(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.movingPalette = {
      dx: event.clientX - this.palettePos().x,
      dy: event.clientY - this.palettePos().y,
    };
  }

  onTextPointerDown(event: PointerEvent, note: Note, mark: NoteMark): void {
    event.stopPropagation();
    if (this.drawTool() !== 'cursor') return;
    this.startMarkMove(event, note, mark);
  }

  startMarkMove(event: PointerEvent, note: Note, mark: NoteMark): void {
    if (this.drawTool() !== 'cursor' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = (event.currentTarget as Element).closest('.note-draw-layer') as HTMLElement | null;
    if (!layer) return;
    layer.setPointerCapture?.(event.pointerId);
    const shown = this.placedMark(mark);
    const rect = layer.getBoundingClientRect();
    this.movingMark = {
      note,
      id: mark.id,
      kind: mark.kind,
      dx: event.clientX - rect.left - shown.x,
      dy: event.clientY - rect.top - shown.y,
      layer,
    };
    this.markDrag.set({ id: mark.id, x: shown.x, y: shown.y });
  }

  onDrawPointerDown(event: PointerEvent, note: Note): void {
    const tool = this.drawTool();
    if (tool === 'cursor' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget as HTMLElement;
    layer.setPointerCapture?.(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const x = Math.round(event.clientX - rect.left);
    const y = Math.round(event.clientY - rect.top);
    if (tool === 'text') {
      const mark: NoteMark = {
        id: `mark-${Date.now()}`,
        kind: 'text',
        color: this.drawColor(),
        x,
        y,
        w: 180,
        h: 48,
        width: this.drawWidth(),
        text: '',
      };
      this.writeBody(note, this.imagesOf(note), [...this.marksOf(note), mark]);
      this.save(note);
      this.notes.update((items) => [...items]);
      window.setTimeout(() => document.getElementById(`mark-text-${mark.id}`)?.focus(), 0);
      return;
    }
    const draft: NoteMark = {
      id: `mark-${Date.now()}`,
      kind: tool,
      color: this.drawColor(),
      x,
      y,
      w: 0,
      h: 0,
      width: this.drawWidth(),
    };
    this.drawing = { note, layer };
    this.drawDraft.set(draft);
  }

  setMarkText(note: Note, id: string, text: string): void {
    const marks = this.marksOf(note).map((mark) => (mark.id === id ? { ...mark, text } : mark));
    this.writeBody(note, this.imagesOf(note), marks, this.textOf(note));
  }

  undoMark(note: Note): void {
    const marks = this.marksOf(note).slice(0, -1);
    this.writeBody(note, this.imagesOf(note), marks);
    this.save(note);
    this.notes.update((items) => [...items]);
  }

  private normalizedMark(mark: NoteMark): NoteMark {
    if (mark.kind === 'arrow') return mark;
    const box = this.shapeBox(mark);
    return { ...mark, x: box.x, y: box.y, w: box.w, h: box.h };
  }

  private viewScale(note: Note): number {
    if (this.expandedId() !== note.id || this.expandLevel() !== 1) return 1;
    const small = this.smallCopyMax();
    const expanded = this.expandedCopyMax();
    return Math.max(1, Math.min(expanded.w / small.w, expanded.h / small.h));
  }

  canvasExtent(note: Note): { w: number; h: number } {
    const fromImages = this.imagesOf(note).reduce(
      (extent, image) => {
        const box = this.displayBox(note, image);
        return {
          w: Math.max(extent.w, box.x + (box.w || 0) + 12),
          h: Math.max(extent.h, box.y + (box.h || 0) + 12),
        };
      },
      { w: 0, h: 0 },
    );
    return this.visibleMarks(note).reduce((extent, mark) => {
      const box = mark.kind === 'text' ? { x: mark.x, y: mark.y, w: 180, h: 48 } : this.shapeBox(mark);
      return {
        w: Math.max(extent.w, box.x + box.w + 12),
        h: Math.max(extent.h, box.y + box.h + 12),
      };
    }, fromImages);
  }

  setText(note: Note, text: string): void {
    this.writeBody(note, this.imagesOf(note), this.marksOf(note), text);
  }

  maximize(note: Note): void {
    if (this.expandedId() !== note.id) {
      this.expandedId.set(note.id);
      this.expandLevel.set(1);
      this.activeId.set(note.id);
      this.trashOpen.set(false);
      this.doneOpen.set(false);
      return;
    }
    if (this.expandLevel() === 1) {
      this.expandLevel.set(2);
      this.drawTool.set('cursor');
      this.placePalette();
      return;
    }
    this.expandLevel.set(1);
    this.drawTool.set('cursor');
    this.drawDraft.set(null);
    this.markDrag.set(null);
    this.drawing = null;
    this.movingMark = null;
  }

  closeExpanded(persist = true): void {
    const note = this.expandedNote();
    if (persist && note) this.save(note);
    this.expandedId.set(null);
    this.expandLevel.set(1);
    this.drawTool.set('cursor');
    this.drawDraft.set(null);
    this.markDrag.set(null);
    this.drawing = null;
    this.movingMark = null;
  }

  onNoteDragOver(event: DragEvent, note: Note): void {
    const types = [...(event.dataTransfer?.types ?? [])];
    if (!types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dropTargetId.set(note.id);
  }

  onNoteDrop(event: DragEvent, note: Note): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetId.set(null);
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const canvas = event.currentTarget as HTMLElement;
    const rect = canvas.getBoundingClientRect();
    void this.addImageFiles(note, files, {
      x: Math.max(0, event.clientX - rect.left + canvas.scrollLeft),
      y: Math.max(0, event.clientY - rect.top + canvas.scrollTop),
    });
  }

  startImageMove(event: PointerEvent, note: Note, id: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const image = this.imagesOf(note).find((item) => item.id === id);
    const canvas = (event.currentTarget as HTMLElement).closest('.note-canvas') as HTMLElement | null;
    if (!image || !canvas) return;
    this.bringForward(note);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const shown = this.displayBox(note, image);
    const orig = this.originalSize(image);
    const rect = canvas.getBoundingClientRect();
    this.movingImage = {
      note,
      id,
      canvas,
      mode: 'move',
      dx: event.clientX - rect.left + canvas.scrollLeft - shown.x,
      dy: event.clientY - rect.top + canvas.scrollTop - shown.y,
      start: { x: shown.x, y: shown.y, w: shown.w, h: shown.h },
      ratio: (orig.w || shown.w) / (orig.h || shown.h || 1),
    };
    this.imageDrag.set({ id, ...shown });
  }

  startImageResize(event: PointerEvent, note: Note, id: string, corner: ImageCorner): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const image = this.imagesOf(note).find((item) => item.id === id);
    const canvas = (event.currentTarget as HTMLElement).closest('.note-canvas') as HTMLElement | null;
    if (!image || !canvas) return;
    this.bringForward(note);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const box = this.displayBox(note, image);
    const orig = this.originalSize(image);
    this.movingImage = {
      note,
      id,
      canvas,
      mode: corner,
      dx: 0,
      dy: 0,
      start: { x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h) },
      ratio: (orig.w || box.w) / (orig.h || box.h || 1),
    };
    this.imageDrag.set({ id, ...box });
  }

  onImageLoad(note: Note, image: NoteImage, event: Event): void {
    const target = event.target as HTMLImageElement;
    const origW = target.naturalWidth || image.origW;
    const origH = target.naturalHeight || image.origH;
    if (origW && origH) {
      this.imageNaturals.update((current) =>
        current[image.id]?.w === origW && current[image.id]?.h === origH
          ? current
          : { ...current, [image.id]: { w: origW, h: origH } },
      );
    }
    const sameOrig = image.origW === origW && image.origH === origH;
    if (image.w && image.h && sameOrig) return;
    const fitted = image.w && image.h ? { w: image.w, h: image.h } : this.fitCopySize(note, origW, origH);
    const images = this.imagesOf(note).map((item) =>
      item.id === image.id
        ? { ...item, origW, origH, w: fitted.w, h: fitted.h, fullW: item.fullW || origW, fullH: item.fullH || origH }
        : item,
    );
    if (!images.length) return;
    this.writeBody(note, images, this.marksOf(note));
    this.save(note);
    this.notes.update((items) => [...items]);
  }

  removeImage(note: Note, index: number): void {
    const images = this.imagesOf(note).filter((_, item) => item !== index);
    this.writeBody(note, images, this.marksOf(note));
    this.save(note);
    this.notes.update((items) => [...items]);
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, .board-search, .date-filter')) return;
    const files = this.clipboardImages(event);
    if (!files.length) return;
    const note = this.expandedNote() ?? this.notes().find((item) => item.id === this.activeId());
    if (!note || note.archived || note.pinned) return;
    event.preventDefault();
    void this.addImageFiles(note, files);
  }

  @HostListener('document:dragend')
  onDragEnd(): void {
    this.dropTargetId.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.noteFlyout()) {
      this.closeNoteFlyout();
      return;
    }
    if (this.expandedId()) this.closeExpanded();
  }

  highlightedParts(text: string): Array<{ text: string; hit: boolean }> {
    const tokens = this.searchTokens();
    if (!text) return [];
    if (!tokens.length) return [{ text, hit: false }];
    const chars = [...text];
    const foldedChars: string[] = [];
    const foldToOrig: number[] = [];
    chars.forEach((char, index) => {
      const folded = this.normalizeText(char);
      for (const piece of folded) {
        foldedChars.push(piece);
        foldToOrig.push(index);
      }
    });
    const folded = foldedChars.join('');
    const ranges: Array<[number, number]> = [];
    for (const token of tokens) {
      const needle = this.normalizeText(token);
      if (!needle) continue;
      let from = 0;
      while (from <= folded.length - needle.length) {
        const at = folded.indexOf(needle, from);
        if (at === -1) break;
        const start = foldToOrig[at];
        const end = foldToOrig[at + needle.length - 1] + 1;
        ranges.push([start, end]);
        from = at + needle.length;
      }
    }
    if (!ranges.length) return [{ text, hit: false }];
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    const parts: Array<{ text: string; hit: boolean }> = [];
    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor) parts.push({ text: chars.slice(cursor, start).join(''), hit: false });
      parts.push({ text: chars.slice(start, end).join(''), hit: true });
      cursor = end;
    }
    if (cursor < chars.length) parts.push({ text: chars.slice(cursor).join(''), hit: false });
    return parts;
  }

  priorityHit(level: number): boolean {
    return this.searchTokens().some((token) => this.normalizeText(token) === String(level));
  }

  private matchesQuery(note: Note): boolean {
    const tokens = this.searchTokens();
    if (!tokens.length) return true;
    const haystack = this.normalizeText(`${note.title} ${this.textOf(note)} ${note.priority}`);
    return tokens.every((token) => haystack.includes(this.normalizeText(token)));
  }

  private matchesDay(note: Note, kind: 'board' | 'trash'): boolean {
    const selected = this.selectedDay();
    const created = this.dayKey(note.created_at);
    if (kind === 'board') return created === selected;
    return created === selected || this.dayKey(note.updated_at) === selected;
  }

  private dayKey(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return BoardPage.localDayKey(date);
  }

  private timestampForSelectedDay(): string {
    const date = BoardPage.parseDayKey(this.selectedDay());
    date.setHours(12, 0, 0, 0);
    return date.toISOString();
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
  }

  restore(note: Note): void {
    note.archived = false;
    note.pinned = false;
    note.updated_at = new Date().toISOString();
    this.save(note);
    this.notes.update((items) => [...items]);
    this.arrangeByPriority(note.id);
  }

  @HostListener('document:pointerup')
  onUp(): void {
    if (this.clockDrag()) {
      this.clockDrag.set(null);
      return;
    }
    if (this.movingPalette) {
      this.movingPalette = null;
      return;
    }
    if (this.drawing) {
      const note = this.drawing.note;
      const draft = this.drawDraft();
      this.drawing = null;
      this.drawDraft.set(null);
      if (draft && (Math.abs(draft.w) > 6 || Math.abs(draft.h) > 6)) {
        this.writeBody(note, this.imagesOf(note), [...this.marksOf(note), this.normalizedMark(draft)]);
        this.save(note);
        this.notes.update((items) => [...items]);
      }
      return;
    }
    if (this.movingMark) {
      const drag = this.markDrag();
      const { note, id, kind } = this.movingMark;
      this.movingMark = null;
      this.markDrag.set(null);
      if (!drag) return;
      const current = this.marksOf(note).find((mark) => mark.id === id);
      if (current && (drag.x !== current.x || drag.y !== current.y)) {
        const marks = [
          ...this.marksOf(note).filter((mark) => mark.id !== id),
          { ...current, x: drag.x, y: drag.y },
        ];
        this.writeBody(note, this.imagesOf(note), marks);
        this.save(note);
        this.notes.update((items) => [...items]);
      } else if (kind === 'text') {
        document.getElementById(`mark-text-${id}`)?.focus();
      }
      return;
    }
    if (this.movingImage) {
      const drag = this.imageDrag();
      const { note, id } = this.movingImage;
      this.movingImage = null;
      this.imageDrag.set(null);
      if (drag) {
        const current = this.imagesOf(note).find((image) => image.id === id);
        const stored = current ? this.toStoredFrame(note, current, drag) : drag;
        const images = this.imagesOf(note).map((image) =>
          image.id === id ? { ...image, ...stored } : image,
        );
        this.writeBody(note, images, this.marksOf(note));
        this.save(note);
        this.notes.update((items) => [...items]);
      }
      return;
    }
    if (this.movingTrash) {
      const clicked = !this.trashWasDragged;
      this.movingTrash = null;
      if (!clicked) {
        this.trashCustom = true;
        this.writeDockPos('meeter.trash-pos', this.trashPos());
      }
      if (clicked) this.openTrash();
      else this.trashOpen.set(false);
      return;
    }
    if (this.movingDone) {
      const clicked = !this.doneWasDragged;
      this.movingDone = null;
      if (!clicked) {
        this.doneCustom = true;
        this.writeDockPos('meeter.done-pos', this.donePos());
      }
      if (clicked) this.openDone();
      else this.doneOpen.set(false);
      return;
    }
    if (this.draggingPad()) {
      this.dropPad();
      return;
    }
    if (this.resizingNote) {
      const drag = this.noteResize();
      const { note } = this.resizingNote;
      this.resizingNote = null;
      this.noteResize.set(null);
      if (drag) {
        note.width = drag.w;
        note.height = drag.h;
        this.save(note);
        this.notes.update((items) => [...items]);
      }
      return;
    }
    if (this.moving) {
      this.save(this.moving.note);
      this.moving = null;
      this.draggingNoteId.set(null);
    }
  }

  setPriority(note: Note, priority: number): void {
    if (note.priority === priority) {
      this.arrangeByPriority(note.id);
      return;
    }
    note.priority = priority;
    this.arrangeByPriority(note.id);
  }

  toggleDone(note: Note): void {
    this.markDone(note);
  }

  markDone(note: Note): void {
    if (this.voiceNoteId() === note.id) this.stopVoice();
    if (this.expandedId() === note.id) this.closeExpanded(false);
    this.launchTowardDone(note);
    note.archived = false;
    note.pinned = true;
    note.updated_at = new Date().toISOString();
    this.notes.update((items) => [...items]);
    this.patchNote(note.id, { archived: false, pinned: true });
    this.arrangeByPriority(undefined, false);
  }

  discard(note: Note): void {
    if (this.voiceNoteId() === note.id) this.stopVoice();
    const from = this.discardOrigin(note) ?? this.fallbackNoteRect(note);
    if (this.expandedId() === note.id) {
      this.expandedId.set(null);
      this.expandLevel.set(1);
      this.drawTool.set('cursor');
    }
    this.launchTowardTrash(note, from);
    note.archived = true;
    note.pinned = false;
    note.updated_at = new Date().toISOString();
    this.notes.update((items) => [...items]);
    this.patchNote(note.id, { archived: true, pinned: false });
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = null;
      this.arrangeByPriority(undefined, false);
    }, 980);
  }

  stackTransform(index: number): string {
    const tilts = [-16, -8, 5, 13, -4, 9];
    return `translateX(-50%) rotate(${tilts[index % tilts.length]}deg) translateY(${-index * 2}px)`;
  }

  private launchTowardDone(note: Note): void {
    const card = document.getElementById(`note-card-${note.id}`);
    const pile = this.doneDock?.nativeElement.querySelector('.done-pile') as HTMLElement | null;
    if (!card || !pile) return;
    const from = card.getBoundingClientRect();
    const to = pile.getBoundingClientRect();
    this.flyingNote.set({
      x: from.left,
      y: from.top,
      w: from.width,
      h: from.height,
      dx: to.left + to.width / 2 - (from.left + from.width / 2),
      dy: to.top + to.height / 3 - (from.top + from.height / 2),
      rot: `${note.rotation + 16}deg`,
      body: this.textOf(note),
      moving: false,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.flyingNote.update((fly) => (fly ? { ...fly, moving: true } : null));
      });
    });
    window.setTimeout(() => this.flyingNote.set(null), 680);
  }

  private discardOrigin(note: Note): DOMRect | null {
    if (this.expandedId() === note.id) {
      const expanded = document.querySelector('.note-expanded');
      if (expanded) return expanded.getBoundingClientRect();
    }
    const card = document.getElementById(`note-card-${note.id}`);
    if (card) return card.getBoundingClientRect();
    return null;
  }

  private fallbackNoteRect(note: Note): DOMRect {
    const stage = this.stage?.nativeElement.getBoundingClientRect();
    const size = this.noteSize(note);
    const left = (stage?.left ?? 0) + note.pos_x;
    const top = (stage?.top ?? 0) + note.pos_y;
    return new DOMRect(left, top, size.w, size.h);
  }

  private launchTowardTrash(note: Note, from: DOMRect): void {
    const can = this.trashDock?.nativeElement.querySelector('.trash-visual') as HTMLElement | null;
    const to = can?.getBoundingClientRect() ?? new DOMRect(this.trashPos().x, this.trashPos().y, 48, 48);
    const lift = Math.min(160, Math.max(84, Math.hypot(
      to.left + to.width / 2 - (from.left + from.width / 2),
      to.top + 20 - (from.top + from.height / 2),
    ) * 0.28));
    if (this.tossTimer) clearTimeout(this.tossTimer);
    if (this.catchTimer) clearTimeout(this.catchTimer);
    this.trashCatching.set(true);
    this.tossingNote.set({
      x: from.left,
      y: from.top,
      w: from.width,
      h: from.height,
      dx: to.left + to.width / 2 - (from.left + from.width / 2),
      dy: to.top + 18 - (from.top + from.height / 2),
      lift,
      spin: `${note.rotation + (from.left > to.left ? -34 : 38)}deg`,
      body: this.preview(note),
      moving: false,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.tossingNote.update((toss) => (toss ? { ...toss, moving: true } : null));
      });
    });
    this.catchTimer = window.setTimeout(() => {
      this.trashCatching.set(false);
      this.catchTimer = null;
    }, 1080);
    this.tossTimer = window.setTimeout(() => {
      this.tossingNote.set(null);
      this.tossTimer = null;
    }, 980);
  }

  private resizedFrame(
    start: { x: number; y: number; w: number; h: number },
    corner: ImageCorner,
    pointerX: number,
    pointerY: number,
    ratio: number,
  ): { x: number; y: number; w: number; h: number } {
    const min = 36;
    const aspect = ratio || start.w / start.h || 1;
    const right = start.x + start.w;
    const bottom = start.y + start.h;
    if (corner === 'se') {
      const w = Math.max(min, pointerX - start.x, (pointerY - start.y) * aspect);
      const h = w / aspect;
      return { x: start.x, y: start.y, w: Math.round(w), h: Math.round(h) };
    }
    if (corner === 'sw') {
      const w = Math.max(min, right - pointerX, (pointerY - start.y) * aspect);
      const h = w / aspect;
      return { x: Math.round(right - w), y: start.y, w: Math.round(w), h: Math.round(h) };
    }
    if (corner === 'ne') {
      const w = Math.max(min, pointerX - start.x, (bottom - pointerY) * aspect);
      const h = w / aspect;
      return { x: start.x, y: Math.round(bottom - h), w: Math.round(w), h: Math.round(h) };
    }
    const w = Math.max(min, right - pointerX, (bottom - pointerY) * aspect);
    const h = w / aspect;
    return { x: Math.round(right - w), y: Math.round(bottom - h), w: Math.round(w), h: Math.round(h) };
  }

  private rawPayload(body: string | undefined, mark: string): string | null {
    const source = body ?? '';
    const index = source.indexOf(mark);
    if (index === -1) return null;
    const nextMark = mark === IMAGE_MARK ? source.indexOf(MARK_MARK, index + mark.length) : -1;
    const region = nextMark === -1 ? source : source.slice(0, nextMark);
    const close = region.indexOf('-->', index + mark.length);
    if (close <= index) return null;
    return region.slice(index + mark.length, close);
  }

  private payloadOf(body: string | undefined, mark: string): unknown {
    const raw = this.rawPayload(body, mark);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private encodeBody(text: string, images: NoteImage[], marks: NoteMark[] = []): string {
    let body = text;
    if (images.length) body += `\n${IMAGE_MARK}${JSON.stringify(images)}-->`;
    if (marks.length) body += `\n${MARK_MARK}${JSON.stringify(marks)}-->`;
    return body;
  }

  private writeBody(note: Note, images?: NoteImage[], marks?: NoteMark[], text?: string): void {
    const nextText = text ?? this.textOf(note);
    const nextMarks = marks ?? this.marksOf(note);
    const nextImages = images ?? this.imagesOf(note);
    if (nextImages.length) {
      note.body = this.encodeBody(nextText, nextImages, nextMarks);
      return;
    }
    const deleting = images !== undefined && images.length === 0 && this.imagesOf(note).length > 0;
    const rawImages = this.rawPayload(note.body, IMAGE_MARK);
    if (!deleting && rawImages && this.imagesOf(note).length === 0) {
      note.body =
        `${nextText}\n${IMAGE_MARK}${rawImages}-->` +
        (nextMarks.length ? `\n${MARK_MARK}${JSON.stringify(nextMarks)}-->` : '');
      return;
    }
    note.body = this.encodeBody(nextText, nextImages, nextMarks);
  }

  private clipboardImages(event: ClipboardEvent): File[] {
    const found: File[] = [];
    for (const file of event.clipboardData?.files ?? []) {
      if (file.type.startsWith('image/')) found.push(file);
    }
    for (const item of event.clipboardData?.items ?? []) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file && !found.some((existing) => existing.size === file.size && existing.type === file.type)) {
        found.push(file);
      }
    }
    return found.sort((a, b) => b.size - a.size);
  }

  private asNoteImage(item: unknown, index: number): NoteImage | null {
    if (typeof item === 'string') {
      return { id: `legacy-${index}`, src: item, x: 8 + index * 16, y: 56 + index * 16, w: 0, h: 0, origW: 0, origH: 0, fullW: 0, fullH: 0 };
    }
    if (!item || typeof item !== 'object' || !('src' in item)) return null;
    const image = item as Partial<NoteImage>;
    if (typeof image.src !== 'string') return null;
    const w = Number(image.w) || 0;
    const h = Number(image.h) || 0;
    return {
      id: image.id || `legacy-${index}`,
      src: image.src,
      x: Number(image.x) || 8,
      y: Number(image.y) || 8,
      w,
      h,
      origW: Number(image.origW) || w,
      origH: Number(image.origH) || h,
      fullW: Number(image.fullW) || Number(image.origW) || w,
      fullH: Number(image.fullH) || Number(image.origH) || h,
    };
  }

  private async addImageFiles(note: Note, files: File[], at?: { x: number; y: number }): Promise<void> {
    const images = this.imagesOf(note);
    let x = at?.x ?? 12;
    let y = at?.y ?? 48;
    for (const file of files) {
      if (!file.type.startsWith('image/') || images.length >= 8) continue;
      try {
        const image = await this.readOriginalImage(file);
        this.imageNaturals.update((current) => ({
          ...current,
          [image.id]: { w: image.origW, h: image.origH },
        }));
        const fitted = this.fitCopySize(note, image.origW, image.origH);
        image.w = fitted.w;
        image.h = fitted.h;
        image.fullW = image.origW;
        image.fullH = image.origH;
        image.x = x;
        image.y = y;
        images.push(image);
        x += 24;
        y += 24;
      } catch {
        this.error.set('No se pudo leer una de las imágenes.');
      }
    }
    this.writeBody(note, images, this.marksOf(note));
    this.save(note);
    this.notes.update((items) => [...items]);
  }

  private smallCopyMax(): { w: number; h: number } {
    return { w: 200, h: 148 };
  }

  private expandedCopyMax(): { w: number; h: number } {
    if (typeof window === 'undefined') return { w: 680, h: 520 };
    return {
      w: Math.min(760, window.innerWidth * 0.92) - 48,
      h: Math.min(window.innerHeight * 0.84, 860) - 88,
    };
  }

  private toStoredFrame(
    note: Note,
    image: NoteImage,
    display: { x: number; y: number; w: number; h: number },
  ): Pick<NoteImage, 'x' | 'y' | 'w' | 'h' | 'fullW' | 'fullH'> {
    if (this.showsOriginalImage(note)) {
      return {
        x: display.x,
        y: display.y,
        w: image.w,
        h: image.h,
        fullW: Math.max(36, display.w),
        fullH: Math.max(36, display.h),
      };
    }
    const scale = this.viewScale(note);
    const copy = scale <= 1 ? display : {
      x: display.x,
      y: display.y,
      w: Math.max(36, Math.round(display.w / scale)),
      h: Math.max(36, Math.round(display.h / scale)),
    };
    return { ...copy, fullW: image.fullW || image.origW, fullH: image.fullH || image.origH };
  }

  private fitCopySize(note: Note, origW: number, origH: number): { w: number; h: number } {
    const max = this.copyMaxSize(note);
    const scale = Math.min(1, max.w / Math.max(1, origW), max.h / Math.max(1, origH));
    return {
      w: Math.max(36, Math.round(origW * scale)),
      h: Math.max(36, Math.round(origH * scale)),
    };
  }

  private copyMaxSize(_note: Note): { w: number; h: number } {
    return this.smallCopyMax();
  }

  private readOriginalImage(file: File): Promise<NoteImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const source = String(reader.result ?? '');
        const image = new Image();
        image.onload = () => {
          const origW = image.naturalWidth;
          const origH = image.naturalHeight;
          resolve({
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            src: source,
            x: 12,
            y: 48,
            w: origW,
            h: origH,
            origW,
            origH,
            fullW: origW,
            fullH: origH,
          });
        };
        image.onerror = () => reject(new Error('image'));
        image.src = source;
      };
      reader.readAsDataURL(file);
    });
  }

  save(note: Note): void {
    note.title = (note.title ?? '').trim();
    this.patchNote(note.id, {
      title: note.title,
      body: note.body,
      priority: note.priority,
      pos_x: note.pos_x,
      pos_y: note.pos_y,
      rotation: note.rotation,
      width: note.width || NOTE_W,
      height: note.height || NOTE_H,
      archived: note.archived,
      pinned: note.pinned,
      color: this.colorOf(note),
      reminder_at: note.reminder_at ?? null,
      alarm_tone: this.toneOf(note),
      reminder_silenced: Boolean(note.reminder_silenced),
    });
  }

  private patchNote(id: string, payload: Partial<Note>): void {
    if (id.startsWith('local-')) {
      this.scheduleCache();
      return;
    }
    const previous = this.patchChains.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            this.notesApi.update(id, payload).subscribe({
              next: () => {
                this.scheduleCache();
                resolve();
              },
              error: () => {
                this.scheduleCache();
                resolve();
              },
            });
          }),
      );
    this.patchChains.set(id, next);
  }

  private arrangeByPriority(movedId?: string, persist = true): void {
    const width = this.stage?.nativeElement.getBoundingClientRect().width ?? window.innerWidth;
    const noteW = NOTE_W;
    const noteH = NOTE_H;
    const gapX = 22;
    const gapY = 26;
    const startX = 36;
    const startY = 132;
    const cols = Math.max(1, Math.floor((width - startX - 28) / (noteW + gapX)));
    const previous = new Map(this.notes().map((note) => [note.id, `${note.pos_x},${note.pos_y}`]));
    let y = startY;

    for (const level of this.priorities) {
      const group = this.notes().filter(
        (note) =>
          !note.archived && !note.pinned && (note.priority || 1) === level && this.matchesDay(note, 'board'),
      );
      if (!group.length) continue;
      group.sort((a, b) => {
        if (a.id === movedId) return 1;
        if (b.id === movedId) return -1;
        return a.pos_x - b.pos_x || a.pos_y - b.pos_y || a.created_at.localeCompare(b.created_at);
      });
      group.forEach((note, index) => {
        note.pos_x = startX + (index % cols) * (noteW + gapX);
        note.pos_y = y + Math.floor(index / cols) * (noteH + gapY);
      });
      y += Math.ceil(group.length / cols) * (noteH + gapY);
    }

    this.notes.update((items) => [...items]);
    if (persist) {
      for (const note of this.notes()) {
        if (note.archived || note.id.startsWith('local-')) continue;
        const moved = previous.get(note.id) !== `${note.pos_x},${note.pos_y}`;
        if (moved || note.id === movedId) this.patchNote(note.id, { pos_x: note.pos_x, pos_y: note.pos_y });
      }
    }
    this.scheduleCache();
  }

  private dropPad(): void {
    const ghost = this.ghost();
    this.draggingPad.set(false);
    this.ghost.set(null);
    const stageEl = this.stage?.nativeElement;
    if (!stageEl || !ghost) return;
    const board = stageEl.getBoundingClientRect();
    const pos_x = Math.min(Math.max(16, ghost.x - board.left), Math.max(16, board.width - 260));
    const pos_y = Math.min(Math.max(16, ghost.y - board.top), Math.max(16, board.height - 300));
    const rotation = Math.round((Math.random() * 10 - 5) * 10) / 10;
    const createdAt = this.timestampForSelectedDay();
    const local: Note = {
      id: `local-${crypto.randomUUID()}`,
      title: '',
      body: '',
      color: 'yellow',
      pinned: false,
      archived: false,
      recording_id: null,
      priority: 1,
      pos_x,
      pos_y,
      rotation,
      width: NOTE_W,
      height: NOTE_H,
      reminder_at: null,
      alarm_tone: 'classic',
      reminder_silenced: false,
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.notes.update((items) => [...items, local]);
    this.bringForward(local);
    this.seenNoteIds?.add(local.id);
    this.revealNote(local);
    queueMicrotask(() => document.getElementById(`note-body-${local.id}`)?.focus());
    const persist = () => {
      this.arrangeByPriority(local.id);
      const placed = this.notes().find((item) => item.id === local.id) ?? local;
      this.notesApi
        .create({
          title: '',
          body: '',
          color: 'yellow',
          priority: 1,
          pos_x: placed.pos_x,
          pos_y: placed.pos_y,
          rotation,
          width: NOTE_W,
          height: NOTE_H,
          created_at: createdAt,
        })
        .subscribe({
          next: (created) => {
            const current = this.notes().find((item) => item.id === local.id);
            const saved = this.normalize({
              ...created,
              pos_x: current?.pos_x ?? created.pos_x,
              pos_y: current?.pos_y ?? created.pos_y,
              rotation,
              priority: current?.priority ?? 1,
              created_at: createdAt,
              updated_at: createdAt,
            });
            this.notes.update((items) => items.map((item) => (item.id === local.id ? saved : item)));
            this.transferSpawn(local.id, saved.id);
            this.bringForward(saved);
            this.cache();
            if (this.dayKey(created.created_at) !== this.selectedDay()) {
              this.notesApi.update(saved.id, { created_at: createdAt }).subscribe({
                error: () => this.error.set('No se pudo guardar la fecha de la nota.'),
              });
            }
            queueMicrotask(() => document.getElementById(`note-body-${saved.id}`)?.focus());
          },
          error: () => this.error.set('No se pudo guardar la nota en el servidor.'),
        });
    };
    requestAnimationFrame(() => requestAnimationFrame(persist));
  }

  private cache(): void {
    this.flushCache();
  }

  private scheduleCache(): void {
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = window.setTimeout(() => {
      this.cacheTimer = null;
      this.flushCache();
    }, 280);
  }

  private flushCache(): void {
    try {
      localStorage.setItem('meeter.board-notes', JSON.stringify(this.notes()));
    } catch {
      /* Las imágenes a tamaño original pueden superar la cuota de localStorage. */
    }
  }

  private cached(): Note[] {
    try {
      const raw = localStorage.getItem('meeter.board-notes');
      return raw ? (JSON.parse(raw) as Note[]).map((note) => this.normalize(note)) : [];
    } catch {
      return [];
    }
  }

  private normalize(note: Note): Note {
    return {
      ...note,
      archived: Boolean(note.archived) && !Boolean(note.pinned),
      pinned: Boolean(note.pinned),
      priority: note.priority || 1,
      pos_x: note.pos_x ?? 80,
      pos_y: note.pos_y ?? 90,
      rotation: note.rotation ?? -1.5,
      width: note.width || NOTE_W,
      height: note.height || NOTE_H,
      color: this.colorOf(note),
      reminder_at: note.reminder_at ?? null,
      alarm_tone: this.toneOf(note),
      reminder_silenced: Boolean(note.reminder_silenced),
    };
  }
}
