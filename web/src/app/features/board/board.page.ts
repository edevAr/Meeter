import { NgClass } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import { NotesService } from '../../core/notes.service';
import { LiveCaptureService, LiveSession, microphoneErrorMessage } from '../../core/live-capture.service';
import { RecordingsApi } from '../../core/recordings.service';
import { AuthService } from '../../core/auth.service';
import { PrefsService } from '../../core/prefs.service';
import { SyncService } from '../../core/sync.service';
import { Note, NoteShare } from '../../core/models';
import { applyList, isRichHtml, offsetsFromRange, rangeFromOffsets, sanitizeRich, stripHtml, wrapSelection } from './rich-text';

const IMAGE_MARK = '<!--meeter-images:';
const MARK_MARK = '<!--meeter-marks:';
const NOTE_W = 180;
const NOTE_H = 204;
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
const RICH_FONTS = [
  { id: 'Patrick Hand, cursive', label: 'Nota' },
  { id: 'Georgia, serif', label: 'Georgia' },
  { id: 'Times New Roman, Times, serif', label: 'Times' },
  { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { id: 'Courier New, monospace', label: 'Courier' },
] as const;
const RICH_SIZES = [
  { cmd: '2', label: 'S' },
  { cmd: '3', label: 'M' },
  { cmd: '5', label: 'L' },
  { cmd: '7', label: 'XL' },
] as const;
const RICH_MARKS = ['#ffe45c', '#ffb0c4', '#8ee0b5', '#8ecdf5', '#ffb14a', 'transparent'] as const;
const VOICE_RATES = [1, 1.5, 2, 3, 4] as const;

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
          <p class="board-kicker text-[11px] uppercase tracking-[0.32em]">{{ t('board.kicker') }}</p>
          <h2 class="board-title font-note text-3xl font-semibold tracking-tight">{{ t('board.title') }}</h2>
          <p class="board-lede mt-1 max-w-xl text-[13px]">
            {{ t('board.hint') }}
          </p>
        </div>
        <div class="mt-1 flex items-start gap-2">
          @if (!sync.online()) {
            <p class="sync-pill is-off">{{ t('sync.offline') }}</p>
          } @else if (sync.syncing() || sync.pending()) {
            <p class="sync-pill">{{ t('sync.pending') }}</p>
          }
          <div class="board-search-wrap relative z-40">
          <label class="board-search group relative flex w-[min(280px,36vw)] items-center">
            <svg class="pointer-events-none absolute left-3.5 h-4 w-4 text-[#d7c4a6]/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"/>
              <path d="M20 20l-3-3" stroke-linecap="round"/>
            </svg>
            <input
              class="w-full rounded-full border border-[#f8ecd4]/20 bg-black/40 py-2.5 pl-10 pr-10 text-sm text-[#f8ecd4] outline-none placeholder:text-[#d7c4a6]/55 backdrop-blur-md transition focus:border-[#ffe45c]/50 focus:bg-black/55"
              type="search"
              name="board-search"
              [placeholder]="t('board.search')"
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
                [attr.aria-label]="t('board.clearSearch')"
              >
                ×
              </button>
            }
          </label>
          @if (searchGroups().length) {
            <div class="search-groups" (pointerdown)="$event.stopPropagation()">
              <p class="search-groups-kicker">{{ t('board.searchPast') }}</p>
              @for (group of searchGroups(); track group.key) {
                <section class="search-group">
                  <h3>{{ group.label }}</h3>
                  @for (hit of group.notes; track hit.id) {
                    <button type="button" class="search-hit-row" (click)="jumpToSearch(hit)">
                      <strong>{{ titleOf(hit) || t('board.untitled') }}</strong>
                      <span>{{ preview(hit) }}</span>
                    </button>
                  }
                </section>
              }
            </div>
          }
          </div>

          <div class="date-filter relative z-40" id="board-date-filter">
            <button
              type="button"
              class="date-filter-btn flex min-w-[148px] items-center gap-2 rounded-full border border-[#f8ecd4]/20 bg-black/40 px-2.5 py-1.5 text-left backdrop-blur-md transition hover:border-[#ffe45c]/40 hover:bg-black/55"
              [class.is-catching]="dateCatching()"
              (click)="toggleCalendar($event)"
              [attr.aria-expanded]="calendarOpen()"
            >
              <svg class="h-3.5 w-3.5 shrink-0 text-[#ffe45c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="5" width="18" height="16" rx="2"/>
                <path d="M3 10h18M8 3v4M16 3v4" stroke-linecap="round"/>
              </svg>
              <span class="min-w-0">
                <span class="block text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#d7c4a6]/75">
                  {{ isToday() ? t('board.today') : t('board.date') }}
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
                    {{ monthNames()[viewMonth()] }} {{ viewYear() }}
                  </p>
                  <button type="button" class="cal-nav" (click)="shiftMonth(1)" aria-label="Mes siguiente">›</button>
                  <button type="button" class="cal-nav" (click)="shiftYear(1)" aria-label="Año siguiente">»</button>
                </div>
                <div class="mb-0.5 grid grid-cols-7 text-center text-[8px] font-extrabold uppercase tracking-wide text-[#7a5a28]/80">
                  @for (day of weekDays(); track $index) {
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
                    {{ t('board.goToday') }}
                  </button>
                }
              </div>
            }
          </div>
          <div class="account-wrap relative" (pointerdown)="$event.stopPropagation()">
            <button
              type="button"
              class="account-avatar"
              [class.is-open]="accountOpen()"
              [attr.aria-expanded]="accountOpen()"
              [attr.aria-label]="t('account.open')"
              (click)="toggleAccount($event)"
            >
              <span>{{ initials() }}</span>
            </button>
            @if (accountOpen()) {
              <div class="account-menu" role="dialog" [attr.aria-label]="t('account.open')">
                <span class="account-menu-tape"></span>
                <div class="account-person">
                  <span class="account-person-mark">{{ initials() }}</span>
                  <div class="min-w-0">
                    <p class="account-person-name">{{ displayName() }}</p>
                    @if (auth.user()?.email) {
                      <p class="account-person-email">{{ auth.user()?.email }}</p>
                    }
                  </div>
                </div>
                <p class="account-label">{{ t('account.language') }}</p>
                <div class="account-pills">
                  <button type="button" [class.is-on]="prefs.lang() === 'es'" (click)="prefs.setLang('es')">{{ t('account.spanish') }}</button>
                  <button type="button" [class.is-on]="prefs.lang() === 'en'" (click)="prefs.setLang('en')">{{ t('account.english') }}</button>
                </div>
                <p class="account-label">{{ t('account.color') }}</p>
                <div class="account-pills">
                  <button type="button" [class.is-on]="prefs.theme() === 'light'" (click)="prefs.setTheme('light')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path stroke-linecap="round" d="M12 3v1.6M12 19.4V21M4.6 4.6l1.1 1.1M18.3 18.3l1.1 1.1M3 12h1.6M19.4 12H21M4.6 19.4l1.1-1.1M18.3 5.7l1.1-1.1"/></svg>
                    {{ t('account.light') }}
                  </button>
                  <button type="button" [class.is-on]="prefs.theme() === 'dark'" (click)="prefs.setTheme('dark')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16.2 13.2A6.2 6.2 0 0 1 10.4 5a6.4 6.4 0 1 0 5.8 8.2Z"/></svg>
                    {{ t('account.dark') }}
                  </button>
                </div>
                <button type="button" class="account-logout" (click)="logout()">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2"/>
                    <path d="M4 12h11M12 8l4 4-4 4"/>
                  </svg>
                  {{ t('account.logout') }}
                </button>
              </div>
            }
          </div>
        </div>
      </header>

      @if (!visibleNotes().length) {
        <p class="pointer-events-none absolute left-1/2 top-36 z-20 -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-sm text-[#d7c4a6]">
          @if (query().trim() && searchGroups().length) {
            {{ t('board.emptyDayQuery') }}
          } @else if (query().trim()) {
            {{ t('board.emptyQuery') }} “{{ query().trim() }}”
          } @else {
            {{ t('board.emptyDay') }} {{ dateLabel() }}
          }
        </p>
      }

      <div #stage class="absolute inset-0 z-10 overflow-auto pb-[200px]">
        @for (note of visibleNotes(); track noteIdentity(note)) {
          <article
            class="sticky-paper absolute flex flex-col rounded-[3px] p-3 pb-2 shadow-sticky"
            [attr.id]="'note-card-' + note.id"
            [attr.data-color]="colorOf(note)"
            [class.is-alarming]="isAlarming(note)"
            [class.is-spawning]="isSpawning(note)"
            [class.is-spawn-run]="isSpawnRun(note)"
            [style.left.px]="note.pos_x"
            [style.top.px]="note.pos_y"
            [style.width.px]="noteSize(note).w"
            [style.height.px]="noteSize(note).h"
            [style.--note-rot]="note.rotation + 'deg'"
            [style.transform]="spawnTransform(note)"
            [style.opacity]="isSpawning(note) && !isSpawnRun(note) ? 0 : null"
            [style.z-index]="zOf(note)"
            [class.is-dragging]="draggingNoteId() === note.id"
            [class.is-resizing]="noteResize()?.id === note.id"
            [class.invisible]="expandedId() === note.id"
            (pointerdown)="bringForward(note)"
            (focusin)="beginEdit(note)"
            (pointerleave)="onNotePointerLeave($event, note)"
            (focusout)="onNoteFocusOut($event, note)"
          >
            <div
              class="note-drag-bar group relative -mx-1 mb-0.5 flex min-h-[22px] items-center justify-between gap-0.5 px-0.5"
              (pointerdown)="startMove($event, note)"
            >
              <div class="relative z-20 -ml-1.5 flex shrink-0 items-center gap-0.5">
                <div class="note-color-wrap relative shrink-0">
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
              <div class="note-remind-wrap relative z-20 shrink-0">
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
              <div class="note-date-wrap relative z-20 shrink-0">
                <button
                  type="button"
                  class="note-icon-btn is-date"
                  title="Mover a otra fecha"
                  (click)="toggleDateMover(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2"/>
                    <path d="M4 10h16M8 3v4M16 3v4"/>
                  </svg>
                </button>
              </div>
              @if (canEdit(note)) {
                <div class="note-rich-wrap relative z-20 shrink-0">
                  <button
                    type="button"
                    class="note-icon-btn is-rich"
                    [class.is-on]="isRichEditing(note)"
                    title="Texto enriquecido"
                    (pointerdown)="keepNoteSelection($event, note)"
                    (click)="toggleRichTools(note); $event.stopPropagation()"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 20l4.2-1.1L19 8.1a1.6 1.6 0 0 0 0-2.3L17.2 4a1.6 1.6 0 0 0-2.3 0L4.9 14.0 4 20z"/>
                      <path d="M13.2 6.5l4.3 4.3"/>
                    </svg>
                  </button>
                </div>
              }
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
                @if (isOwner(note)) {
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
                }
              </div>
            </div>
            <input
              class="note-title"
              [attr.id]="'note-title-' + note.id"
              [ngModel]="note.title"
              (ngModelChange)="setTitle(note, $event)"
              (keydown.enter)="focusBody(note); $event.preventDefault()"
              (pointerdown)="$event.stopPropagation()"
              placeholder="Título (opcional)"
              maxlength="120"
              autocomplete="off"
              [readonly]="!canEdit(note)"
            />
            @if (note.recording_id) {
              <div
                class="note-voice-block"
                (pointerdown)="$event.stopPropagation()"
                (click)="$event.stopPropagation()"
              >
                <div class="note-voice">
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
                <button
                  type="button"
                  class="note-voice-rate"
                  title="Velocidad de reproducción"
                  (click)="cycleVoiceRate(note); $event.stopPropagation()"
                >{{ voiceRateLabel() }}</button>
                @if (canEdit(note)) {
                  <button
                    type="button"
                    class="note-voice-text-btn"
                    [class.is-busy]="isVoiceTranscribing(note)"
                    [disabled]="isVoiceTranscribing(note)"
                    title="Extraer el texto de la grabación"
                    (click)="extractVoiceText(note)"
                  >
                    @if (isVoiceTranscribing(note)) {
                      <span>…</span>
                    } @else {
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                        <path d="M8 4h7l4 4v12H8z" stroke-linejoin="round"/>
                        <path d="M15 4v4h4M10 13h6M10 17h4" stroke-linecap="round"/>
                      </svg>
                    }
                  </button>
                }
                </div>
                @if (isVoiceTranscribing(note)) {
                  <p class="note-voice-status">Extrayendo el texto…</p>
                }
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
                @if (query().trim() && !isRich(note)) {
                  <div
                    class="note-highlight pointer-events-none absolute inset-0 overflow-hidden font-note text-[12px] leading-5 text-[#3b2a12]"
                    aria-hidden="true"
                  >
                    @for (part of highlightedParts(plainOf(note)); track $index) {
                      @if (part.hit) {
                        <mark class="search-hit">{{ part.text }}</mark>
                      } @else {
                        {{ part.text }}
                      }
                    }
                  </div>
                }
                @if (isRichEditing(note)) {
                  <div
                    class="note-canvas-text note-rich-html font-note text-[12px] leading-5 text-[#3b2a12] outline-none"
                    [attr.id]="'note-rich-' + note.id"
                    contenteditable="true"
                    (input)="onRichInput(note, $event)"
                    (paste)="onRichPaste($event)"
                  ></div>
                } @else if (isRich(note)) {
                  <div
                    class="note-canvas-text note-rich-html font-note text-[12px] leading-5 text-[#3b2a12]"
                    [innerHTML]="safeRich(note)"
                  ></div>
                } @else {
                  <textarea
                    class="note-canvas-text font-note text-[12px] leading-5 text-[#3b2a12] outline-none placeholder:text-[#3b2a12]/35"
                    [class.text-transparent]="!!query().trim()"
                    [class.caret-[#3b2a12]]="!!query().trim()"
                    [attr.id]="'note-body-' + note.id"
                    [ngModel]="textOf(note)"
                    (ngModelChange)="setText(note, $event)"
                    [placeholder]="note.recording_id ? 'Pulsa el botón de texto para extraer lo que dijiste.' : 'Escribe, pega o arrastra una imagen…'"
                    [readonly]="!canEdit(note)"
                  ></textarea>
                }
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
            @if (canShare(note)) {
              <div class="note-share-wrap">
                <button
                  type="button"
                  class="note-share-btn"
                  [attr.id]="'note-share-' + note.id"
                  [class.is-on]="noteFlyout()?.kind === 'share' && noteFlyout()?.noteId === note.id"
                  [class.has-people]="(note.share_count || 0) > 0"
                  title="Compartir"
                  (click)="toggleSharePanel(note); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5"/>
                  </svg>
                </button>
              </div>
            }
            @if (!isOwner(note)) {
              <span class="note-shared-tag" [title]="note.owner_name ? 'De ' + note.owner_name : 'Nota compartida'">
                {{ note.access === 'write' ? 'Editar' : 'Leer' }}
              </span>
            }
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
          class="sticky-paper is-pad-ghost pointer-events-none fixed z-50 rounded-[3px] opacity-95 shadow-sticky"
          [style.width.px]="noteW"
          [style.height.px]="noteH"
          [style.transform]="'translate3d(' + g.x + 'px,' + g.y + 'px,0)'"
        >
          <div class="sticky-tape mx-auto mt-3 h-4 w-16 rounded-sm"></div>
        </div>
      }

      <div class="absolute bottom-7 left-1/2 z-[88] flex -translate-x-1/2 items-end gap-6">
        @if (canCreateNotes()) {
          <div class="flex flex-col items-center">
            <div
              #createPad
              class="note-pad group relative h-[68px] w-[62px] cursor-grab touch-none active:cursor-grabbing"
              [class.is-held]="draggingPad()"
              (pointerdown)="startPadDrag($event)"
              (pointerup)="endPadDrag()"
              (pointercancel)="endPadDrag()"
              role="button"
              tabindex="0"
              aria-label="Arrastrar una nota amarilla al tablero"
            >
              <span class="note-pad-layer absolute left-2 top-2.5 h-[50px] w-[44px] rotate-6 rounded-[2px] shadow-lg"></span>
              <span class="note-pad-layer absolute left-1 top-1.5 h-[50px] w-[44px] -rotate-3 rounded-[2px] shadow-lg"></span>
              <span
                class="note-pad-front note-pad-layer absolute left-0 top-0 h-[52px] w-[46px] rounded-[2px] shadow-dock ring-1 ring-black/10"
              >
                <span class="sticky-tape mx-auto mt-2 block h-2.5 w-8 rounded-sm"></span>
              </span>
            </div>
            <p
              class="mt-3 rounded-full bg-black/35 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#f8ecd4]/80 backdrop-blur"
            >
              {{ isToday() ? t('board.drag') : t('board.forDate') }}
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
          <div class="trash-fly-paper sticky-paper overflow-hidden p-3" [attr.data-color]="toss.color">
            <div class="sticky-tape mx-auto h-3 w-10 rounded-sm"></div>
            <p class="mt-2 line-clamp-4 font-note text-sm leading-5 text-[#3b2a12]">{{ toss.body }}</p>
          </div>
        </div>
      }

      @if (flyingNote(); as fly) {
        <div
          class="done-fly sticky-paper pointer-events-none fixed z-[90] overflow-hidden p-3"
          [attr.data-color]="fly.color"
          [class.date-fly]="fly.kind === 'date'"
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
        [class.done-dock-empty]="doneCount() === 0"
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
          [attr.aria-label]="'Notas hechas' + (doneCount() ? ' (' + doneCount() + ')' : '')"
          [attr.aria-hidden]="doneCount() === 0 ? true : null"
        >
          <span class="relative flex h-12 w-12 items-center justify-center overflow-visible">
            @for (note of stackedNotes(); track note.id; let i = $index) {
              <span
                class="done-sheet sticky-paper absolute left-1/2 top-0 rounded-[2px] shadow-sticky"
                [attr.data-color]="colorOf(note)"
                [style.z-index]="i + 1"
                [style.transform]="stackTransform(i, stackedNotes().length)"
              >
                <span class="sticky-tape mx-auto mt-1 block h-1 w-3.5 rounded-sm"></span>
                @if (titleOf(note)) {
                  <span class="note-title-preview mt-0.5 block px-1 text-[13px] leading-3 text-[#3b2a12]">{{ titleOf(note) }}</span>
                } @else {
                  <span class="mt-0.5 block px-1 font-note text-[7px] leading-3 text-[#3b2a12]/80">{{ preview(note) }}</span>
                }
              </span>
            }
            @if (doneCount() > 0) {
              <span class="dock-count pointer-events-none">{{ doneCount() }}</span>
            }
          </span>
          <span class="mt-2 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f8ecd4]/85">
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
            (focusin)="beginEdit(note)"
            (pointerleave)="onNotePointerLeave($event, note)"
            (focusout)="onNoteFocusOut($event, note)"
            (dragover)="onNoteDragOver($event, note)"
            (drop)="onNoteDrop($event, note)"
          >
            <div class="mb-3 flex items-start justify-between gap-2">
              <div class="flex shrink-0 items-center gap-0.5">
                <div class="note-color-wrap relative shrink-0">
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
                <div class="note-remind-wrap relative shrink-0">
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
                <div class="note-date-wrap relative shrink-0">
                  <button
                    type="button"
                    class="note-icon-btn is-date"
                    title="Mover a otra fecha"
                    (click)="toggleDateMover(note, true); $event.stopPropagation()"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="4" y="5" width="16" height="15" rx="2"/>
                      <path d="M4 10h16M8 3v4M16 3v4"/>
                    </svg>
                  </button>
                </div>
                @if (canEdit(note)) {
                  <div class="note-rich-wrap relative shrink-0">
                    <button
                      type="button"
                      class="note-icon-btn is-rich"
                      [class.is-on]="isRichEditing(note)"
                      title="Texto enriquecido"
                      (pointerdown)="keepNoteSelection($event, note)"
                      (click)="toggleRichTools(note, true); $event.stopPropagation()"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4 20l4.2-1.1L19 8.1a1.6 1.6 0 0 0 0-2.3L17.2 4a1.6 1.6 0 0 0-2.3 0L4.9 14.0 4 20z"/>
                        <path d="M13.2 6.5l4.3 4.3"/>
                      </svg>
                    </button>
                  </div>
                }
              </div>
              <input
                class="note-title note-title-lg min-w-0 flex-1"
                [attr.id]="'note-title-exp-' + note.id"
                [ngModel]="note.title"
                (ngModelChange)="setTitle(note, $event)"
                (keydown.enter)="focusBody(note); $event.preventDefault()"
                placeholder="Título (opcional)"
                maxlength="120"
                autocomplete="off"
                [readonly]="!canEdit(note)"
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
                @if (isOwner(note)) {
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
                }
              </div>
            </div>
            @if (note.recording_id) {
              <div class="note-voice-block">
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
                <button
                  type="button"
                  class="note-voice-rate is-wide"
                  title="Velocidad de reproducción"
                  (click)="cycleVoiceRate(note); $event.stopPropagation()"
                >{{ voiceRateLabel() }}</button>
                @if (canEdit(note)) {
                  <button
                    type="button"
                    class="note-voice-text-btn is-wide"
                    [class.is-busy]="isVoiceTranscribing(note)"
                    [disabled]="isVoiceTranscribing(note)"
                    title="Extraer el texto de la grabación"
                    (click)="extractVoiceText(note)"
                  >
                    @if (isVoiceTranscribing(note)) {
                      <span>Extrayendo…</span>
                    } @else {
                      Extraer texto
                    }
                  </button>
                }
                </div>
                @if (isVoiceTranscribing(note)) {
                  <p class="note-voice-status">Whisper está sacando el texto de la grabación…</p>
                }
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
                @if (isRichEditing(note)) {
                  <div
                    class="note-canvas-text note-rich-html bg-transparent font-note text-[14px] leading-6 text-[#3b2a12] outline-none"
                    [attr.id]="'note-rich-exp-' + note.id"
                    contenteditable="true"
                    (input)="onRichInput(note, $event)"
                    (paste)="onRichPaste($event)"
                  ></div>
                } @else if (isRich(note)) {
                  <div
                    class="note-canvas-text note-rich-html bg-transparent font-note text-[14px] leading-6 text-[#3b2a12]"
                    [innerHTML]="safeRich(note)"
                  ></div>
                } @else {
                  <textarea
                    class="note-canvas-text bg-transparent font-note text-[14px] leading-6 text-[#3b2a12] outline-none"
                    [attr.id]="'note-body-exp-' + note.id"
                    [ngModel]="textOf(note)"
                    (ngModelChange)="setText(note, $event)"
                    [placeholder]="note.recording_id ? 'Pulsa Extraer texto para ver lo que dijiste.' : 'Escribe, pega o arrastra una imagen…'"
                    [readonly]="!canEdit(note)"
                  ></textarea>
                }
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
            @if (canShare(note)) {
              <div class="note-share-wrap is-expanded">
                <button
                  type="button"
                  class="note-share-btn"
                  [attr.id]="'note-share-exp-' + note.id"
                  [class.is-on]="noteFlyout()?.kind === 'share' && noteFlyout()?.noteId === note.id"
                  [class.has-people]="(note.share_count || 0) > 0"
                  title="Compartir"
                  (click)="toggleSharePanel(note, true); $event.stopPropagation()"
                  (pointerdown)="$event.stopPropagation()"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5"/>
                  </svg>
                </button>
              </div>
            }
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
            [class.is-date]="panel.kind === 'date'"
            [class.is-share]="panel.kind === 'share'"
            [class.is-rich]="panel.kind === 'rich'"
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
                    <p>{{ monthNames()[draft.month] }} {{ draft.year }}</p>
                    <button type="button" class="cal-nav" (click)="shiftRemindMonth(1)" aria-label="Mes siguiente">›</button>
                  </div>
                  <div class="remind-cal-week">
                    @for (day of weekDays(); track $index) {
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
            @if (panel.kind === 'date' && dateDraft(); as draft) {
              <p class="note-flyout-kicker">Mover a otra fecha</p>
              <div class="remind-cal-nav">
                <button type="button" class="cal-nav" (click)="shiftMoveYear(-1)" aria-label="Año anterior">«</button>
                <button type="button" class="cal-nav" (click)="shiftMoveMonth(-1)" aria-label="Mes anterior">‹</button>
                <p>{{ monthNames()[draft.month] }} {{ draft.year }}</p>
                <button type="button" class="cal-nav" (click)="shiftMoveMonth(1)" aria-label="Mes siguiente">›</button>
                <button type="button" class="cal-nav" (click)="shiftMoveYear(1)" aria-label="Año siguiente">»</button>
              </div>
              <div class="remind-cal-week">
                @for (day of weekDays(); track $index) {
                  <span>{{ day }}</span>
                }
              </div>
              <div class="remind-cal-grid">
                @for (cell of moveCalendarCells(); track $index) {
                  @if (cell.day; as day) {
                    <button
                      type="button"
                      class="remind-cal-day"
                      [class.is-on]="cell.key === dayKey(note.created_at)"
                      [class.is-today]="cell.key === todayKey()"
                      [class.is-off]="!!cell.key && cell.key < todayKey()"
                      [disabled]="!!cell.key && cell.key < todayKey()"
                      (click)="cell.key && moveNoteToDate(note, cell.key)"
                    >
                      {{ day }}
                    </button>
                  } @else {
                    <span></span>
                  }
                }
              </div>
              <p class="note-flyout-hint">Elige un día de hoy en adelante. La nota saldrá de este tablero.</p>
            }
            @if (panel.kind === 'share') {
              <p class="note-flyout-kicker">Compartir nota</p>
              <label class="note-share-field">
                <span>Nombre o correo</span>
                <input
                  type="text"
                  [ngModel]="shareQuery()"
                  (ngModelChange)="shareQuery.set($event)"
                  (keydown.enter)="submitShare(note); $event.preventDefault()"
                  placeholder="ana o ana@correo.com"
                  autocomplete="off"
                />
              </label>
              <div class="note-share-perms">
                <label>
                  <input
                    type="checkbox"
                    [checked]="shareCanRead()"
                    (change)="setShareDraftRead($event)"
                  />
                  Lectura
                </label>
                <label>
                  <input
                    type="checkbox"
                    [checked]="shareCanWrite()"
                    (change)="setShareDraftWrite($event)"
                  />
                  Escritura
                </label>
              </div>
              @if (shareError()) {
                <p class="note-share-error">{{ shareError() }}</p>
              }
              <div class="note-flyout-actions">
                <button type="button" class="is-save" [disabled]="shareBusy()" (click)="submitShare(note)">
                  {{ shareBusy() ? 'Un segundo…' : 'Compartir' }}
                </button>
              </div>
              @if (shares().length) {
                <p class="note-flyout-kicker note-share-people">Personas</p>
                <div class="note-share-list">
                  @for (person of shares(); track person.id) {
                    <div class="note-share-row">
                      <div>
                        <strong>{{ person.name || person.email }}</strong>
                        <em>{{ person.email }}</em>
                      </div>
                      <label title="Lectura">
                        <input
                          type="checkbox"
                          [checked]="person.can_read || person.can_write"
                          (change)="setSharePerm(note, person, 'read', $event)"
                        />
                        L
                      </label>
                      <label title="Escritura">
                        <input
                          type="checkbox"
                          [checked]="person.can_write"
                          (change)="setSharePerm(note, person, 'write', $event)"
                        />
                        E
                      </label>
                      <button type="button" title="Dejar de compartir" (click)="removeShare(note, person)">×</button>
                    </div>
                  }
                </div>
              }
            }
            @if (panel.kind === 'rich') {
              <p class="note-flyout-kicker">Texto enriquecido</p>
              <div class="rich-toolbar" (mousedown)="onRichToolbarDown($event)">
                <button type="button" class="rich-bold" title="Negrita" (click)="richCommand('bold')"><b>B</b></button>
                <button type="button" title="Cursiva" (click)="richCommand('italic')"><i>I</i></button>
                <button type="button" title="Subrayado" (click)="richCommand('underline')"><u>U</u></button>
                <button type="button" title="Tachado" (click)="richCommand('strikeThrough')"><s>S</s></button>
                <button type="button" title="Lista" (click)="richCommand('insertUnorderedList')">•</button>
                <button type="button" title="Lista numerada" (click)="richCommand('insertOrderedList')">1.</button>
                <select title="Tipografía" (mousedown)="$event.stopPropagation()" (change)="richFont($event)">
                  @for (font of richFonts; track font.id) {
                    <option [value]="font.id" [style.font-family]="font.id">{{ font.label }}</option>
                  }
                </select>
                <span class="rich-sizes">
                  @for (size of richSizes; track size.cmd) {
                    <button type="button" [title]="'Tamaño ' + size.label" (click)="richCommand('fontSize', size.cmd)">{{ size.label }}</button>
                  }
                </span>
                <span class="rich-marks">
                  @for (color of richMarks; track color) {
                    <button
                      type="button"
                      class="rich-mark"
                      [class.is-clear]="color === 'transparent'"
                      [style.background]="color === 'transparent' ? '#fffdf6' : color"
                      [title]="color === 'transparent' ? 'Quitar resaltado' : 'Resaltar'"
                      (click)="richHighlight(color)"
                    ></button>
                  }
                </span>
              </div>
              <p class="note-flyout-hint">Selecciona texto en la nota y aplica el formato.</p>
            }
          </div>
        }
      }
    </section>
    <div
      class="clippy-dock"
      [attr.data-mood]="clippyMood()"
      [class.is-minimized]="clippyStep() === 'minimized'"
      [class.is-live]="callLive() && !callPaused()"
      [style.top.px]="trashPos().y"
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
                <span class="call-live-dot" [class.is-on]="callLive() && !callPaused()" [class.is-paused]="callPaused()"></span>
                <span>{{ callPaused() ? 'Grabación en pausa' : (callLive() ? voiceCapture() ? 'Grabando nota de voz' : (callInternal() ? 'Escuchando esta computadora' : 'Escuchando el micrófono') : (voiceCapture() ? 'Guardando tu nota de voz' : 'Cerrando captura')) }}</span>
                <span class="call-clock">{{ callClock() }}</span>
              </div>
              <div class="call-waves" [class.is-on]="callLive() && !callPaused()" [class.is-paused]="callPaused()" aria-hidden="true">
                @for (bar of callBars; track bar) {
                  <span [style.animation-delay.ms]="bar * 90"></span>
                }
              </div>
              @if (callError()) {
                <p class="clippy-error">{{ callError() }}</p>
              }
              <p class="clippy-listening">{{ callPaused() ? 'Pausado' : (callLive() ? 'Escuchando...' : (voiceCapture() ? 'Guardando tu nota de voz' : 'Cerrando captura')) }}</p>
            </div>
            @if (clippyStep() === 'recording') {
              <div class="clippy-actions">
                <button
                  type="button"
                  class="clippy-no"
                  (click)="toggleCallPause($event)"
                >{{ callPaused() ? 'Reanudar' : 'Pausar' }}</button>
                <button
                  type="button"
                  class="clippy-yes"
                  (pointerdown)="stopCallCapture($event)"
                  (click)="stopCallCapture($event)"
                >Listo</button>
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
  readonly auth = inject(AuthService);
  readonly prefs = inject(PrefsService);
  readonly sync = inject(SyncService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly accountOpen = signal(false);
  @ViewChild('stage') private stage?: ElementRef<HTMLElement>;
  @ViewChild('trashDock') private trashDock?: ElementRef<HTMLElement>;
  @ViewChild('doneDock') private doneDock?: ElementRef<HTMLElement>;
  @ViewChild('createPad') private createPad?: ElementRef<HTMLElement>;

  readonly notes = signal<Note[]>([]);
  readonly error = signal('');
  readonly callLive = signal(false);
  readonly callBusy = signal(false);
  readonly callTranscript = signal('');
  readonly callInternal = signal(false);
  readonly callError = signal('');
  readonly callTick = signal(0);
  readonly callPaused = signal(false);
  readonly callBars = [0, 1, 2, 3, 4, 5, 6];
  readonly clippyStep = signal<'enter' | 'offer' | 'recording' | 'saving' | 'notes' | 'making' | 'done' | 'minimized'>('enter');
  readonly clippyMood = signal<'idle' | 'ask' | 'listen' | 'think' | 'happy' | 'sleep'>('sleep');
  readonly voiceCapture = signal(false);
  readonly voiceNoteId = signal<string | null>(null);
  readonly voicePlaying = signal(false);
  readonly voiceCurrent = signal(0);
  readonly voiceDuration = signal(0);
  readonly voiceTranscribingId = signal<string | null>(null);
  readonly voiceRate = signal(1);
  readonly editingId = signal<string | null>(null);
  readonly richFonts = RICH_FONTS;
  readonly richSizes = RICH_SIZES;
  readonly richMarks = RICH_MARKS;
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
    let elapsed = Date.now() - this.callStartedAt - this.callPausedMs;
    if (this.callPaused() && this.callPausedAt) elapsed -= Date.now() - this.callPausedAt;
    const total = Math.max(0, Math.floor(elapsed / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  });
  private padPointer: { x: number; y: number; dx: number; dy: number } | null = null;
  readonly activeId = signal<string | null>(null);
  readonly draggingNoteId = signal<string | null>(null);
  readonly trashOpen = signal(false);
  readonly trashPos = signal({
    x: 24,
    y: typeof window === 'undefined' ? 400 : Math.max(24, window.innerHeight - 136),
  });
  readonly doneOpen = signal(false);
  readonly donePos = signal({
    x: 24,
    y: typeof window === 'undefined' ? 300 : Math.max(24, window.innerHeight - 236),
  });
  readonly query = signal('');
  readonly searchTokens = computed(() => this.query().trim().split(/\s+/).filter(Boolean));
  readonly selectedDay = signal(BoardPage.localDayKey());
  readonly calendarOpen = signal(false);
  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth());
  readonly weekDays = computed(() =>
    this.prefs.lang() === 'en' ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  );
  readonly monthNames = computed(() =>
    this.prefs.lang() === 'en'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  );
  readonly todayKey = signal(BoardPage.localDayKey());
  readonly isToday = computed(() => this.selectedDay() === this.todayKey());
  readonly canCreateNotes = computed(() => this.selectedDay() >= this.todayKey());
  readonly dateLabel = computed(() => {
    const date = BoardPage.parseDayKey(this.selectedDay());
    const formatted = date.toLocaleDateString(this.prefs.locale(), {
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
  readonly searchGroups = computed(() => {
    const tokens = this.searchTokens();
    if (!tokens.length) return [];
    const selected = this.selectedDay();
    const groups = new Map<string, Note[]>();
    for (const note of this.notes()) {
      if (note.archived) continue;
      if (!this.matchesQuery(note)) continue;
      const key = this.dayKey(note.created_at);
      if (key === selected) continue;
      const list = groups.get(key) ?? [];
      list.push(note);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([key, notes]) => ({
        key,
        label: this.searchDateLabel(key),
        notes,
      }));
  });
  readonly stackedNotes = computed(() =>
    this.notes()
      .filter((note) => note.pinned && !note.archived && this.matchesDay(note, 'board'))
      .slice(-12),
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
    kind: 'done' | 'date';
    x: number;
    y: number;
    w: number;
    h: number;
    dx: number;
    dy: number;
    rot: string;
    body: string;
    color: string;
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
    color: string;
    moving: boolean;
  } | null>(null);
  readonly ghost = signal<{ x: number; y: number } | null>(null);
  readonly draggingPad = signal(false);
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
  private dateFlyTimer: ReturnType<typeof setTimeout> | null = null;
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
  private callPausedMs = 0;
  private callPausedAt = 0;
  private callGeneration = 0;
  private callStopRequested = false;
  private callRecordingId: string | null = null;
  private voiceAudio: HTMLAudioElement | null = null;
  private clippyTimer: ReturnType<typeof setTimeout> | null = null;
  private clippySession = false;
  private seenNoteIds: Set<string> | null = null;
  private lastCreatedNoteId: string | null = null;
  private identityKeys = new Map<string, string>();
  private alarmTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private beepOsc: OscillatorNode | null = null;
  private beepGain: GainNode | null = null;
  private beepPulse: ReturnType<typeof setInterval> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private soundingTone: string | null = null;
  private alarmNotified = new Set<string>();
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
  readonly noteW = NOTE_W;
  readonly noteH = NOTE_H;
  readonly spawning = signal<Record<string, number>>({});
  readonly spawnRun = signal<Record<string, boolean>>({});
  readonly spawnBursts = signal<Array<{ id: string; noteId: string; x: number; y: number; w: number; h: number; hex: string }>>([]);
  readonly noteFlyout = signal<{
    kind: 'color' | 'remind' | 'date' | 'share' | 'rich';
    noteId: string;
    x: number;
    y: number;
    side: 'left' | 'right';
    expanded: boolean;
  } | null>(null);
  readonly shares = signal<NoteShare[]>([]);
  readonly shareQuery = signal('');
  readonly shareCanRead = signal(true);
  readonly shareCanWrite = signal(false);
  readonly shareBusy = signal(false);
  readonly shareError = signal('');
  readonly dateDraft = signal<{ year: number; month: number } | null>(null);
  readonly dateCatching = signal(false);
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
  readonly moveCalendarCells = computed(() => {
    const draft = this.dateDraft();
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
    const cached = this.cached();
    if (cached.length) this.notes.set(cached);
    this.refresh();
    this.syncToday();
    this.armDayClock();
    this.armAlarms();
    effect(() => {
      this.alarmingIds();
      untracked(() => this.syncAlarmSound());
    });
    effect(() => {
      const pulled = this.sync.lastPull();
      if (!pulled) return;
      untracked(() => this.applyRemote(pulled));
    });
    effect(() => {
      const event = this.sync.lastEvent();
      if (!event) return;
      untracked(() => this.applyLiveEvent(event));
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
  }

  ngOnDestroy(): void {
    this.keepTrashOpen();
    this.keepDoneOpen();
    if (this.tossTimer) clearTimeout(this.tossTimer);
    if (this.catchTimer) clearTimeout(this.catchTimer);
    if (this.dateFlyTimer) clearTimeout(this.dateFlyTimer);
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
    if (this.accountOpen() && !target?.closest('.account-wrap')) this.accountOpen.set(false);
    const flyout = this.noteFlyout();
    if (flyout?.kind === 'rich' && target?.closest(`#note-card-${flyout.noteId}, .note-expanded`)) return;
    if (!target?.closest('.note-flyout, .note-color-wrap, .note-remind-wrap, .note-date-wrap, .note-share-wrap, .note-rich-wrap')) {
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
    const pad = this.createPad?.nativeElement.getBoundingClientRect();
    const y = pad?.top ?? (board?.bottom ?? window.innerHeight) - 136;
    return this.clampTrash(right - 140, y);
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

  isSpawnRun(note: Note): boolean {
    return this.spawnRun()[note.id] === true;
  }

  spawnTransform(note: Note): string | null {
    if (!this.isSpawning(note)) return this.rotationOf(note);
    if (this.isSpawnRun(note)) return null;
    return `rotate(${note.rotation}deg) scale(0.2)`;
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.spawning()[note.id] !== started) return;
        this.spawnRun.update((map) => ({ ...map, [note.id]: true }));
        this.playSpawnSound();
      });
    });
    window.setTimeout(() => {
      this.spawning.update((map) => {
        const hit = Object.entries(map).find(([, at]) => at === started);
        if (!hit) return map;
        const next = { ...map };
        delete next[hit[0]];
        return next;
      });
      this.spawnRun.update((map) => {
        const live = this.spawning();
        const next = { ...map };
        for (const id of Object.keys(next)) {
          if (live[id] == null) delete next[id];
        }
        return next;
      });
    }, 980);
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
    this.spawnRun.update((map) => {
      if (!map[fromId]) return map;
      const next = { ...map };
      next[toId] = true;
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
    tap.frequency.exponentialRampToValueAtTime(260, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    tap.connect(gain);
    gain.connect(ctx.destination);
    tap.start(now);
    tap.stop(now + 0.18);
  }

  refresh(): void {
    void this.sync.flush();
  }

  private applyRemote(remote: Note[]): void {
    const incoming = remote.map((note) => this.normalize(note));
    this.sync.forgetStale(incoming);
    const localById = new Map(this.notes().map((note) => [note.id, note]));
    const draggingId = this.draggingNoteId();
    const merged: Note[] = [];
    for (const note of incoming) {
      const local = localById.get(note.id);
      if (
        local &&
        (local.id === draggingId || this.isNoteBusy(local.id) || !this.sync.shouldApplyRemote(note.id, note.updated_at, local.updated_at))
      ) {
        merged.push(local);
        continue;
      }
      if (local) {
        Object.assign(local, note);
        merged.push(local);
      } else {
        merged.push(note);
      }
    }
    for (const local of this.notes()) {
      if (!merged.some((note) => note.id === local.id) && this.sync.isUpsertQueued(local.id)) {
        merged.push(local);
      }
    }
    this.notes.set(merged);
    this.cache();
    queueMicrotask(() => this.captureNewNotes());
  }

  private applyLiveEvent(event: { op: string; id: string; updated_at?: string; deleted?: boolean; note?: Note }): void {
    if (this.draggingNoteId() === event.id || this.isNoteBusy(event.id)) return;
    if (event.op === 'delete' || event.deleted) {
      const localDeleted = this.notes().find((note) => note.id === event.id);
      if (!this.sync.shouldApplyRemote(event.id, event.updated_at, localDeleted?.updated_at)) return;
      this.sync.forget(event.id);
      const next = this.notes().filter((note) => note.id !== event.id);
      if (next.length === this.notes().length) return;
      this.notes.set(next);
      this.cache();
      return;
    }
    if (!event.note) return;
    const incoming = this.normalize(event.note);
    const local = this.notes().find((note) => note.id === incoming.id);
    if (!this.sync.shouldApplyRemote(incoming.id, event.updated_at || incoming.updated_at, local?.updated_at)) {
      return;
    }
    this.sync.forget(incoming.id);
    if (local) {
      Object.assign(local, incoming);
      this.notes.update((items) => [...items]);
    } else {
      this.notes.update((items) => [...items, incoming]);
    }
    this.cache();
    queueMicrotask(() => this.captureNewNotes());
  }

  startPadDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.draggingPad.set(true);
    const pad = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const originX = pad.left + pad.width / 2 - NOTE_W / 2;
    const originY = pad.top + pad.height / 2 - NOTE_H / 2;
    this.padPointer = {
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - originX,
      dy: event.clientY - originY,
    };
  }

  endPadDrag(): void {
    if (!this.draggingPad()) return;
    this.dropPad();
  }

  async startCallCapture(internalAudio = false): Promise<void> {
    const generation = ++this.callGeneration;
    this.callStopRequested = false;
    this.callError.set('');
    this.callTranscript.set('');
    this.callRecordingId = null;
    this.callInternal.set(internalAudio);
    this.callLive.set(true);
    this.callPaused.set(false);
    this.callPausedMs = 0;
    this.callPausedAt = 0;
    this.callStartedAt = Date.now();
    this.callTick.set(0);
    this.armCallClock();
    try {
      const session = await this.liveCapture.start(() => undefined, { internalAudio });
      if (generation !== this.callGeneration) {
        await session.stop();
        return;
      }
      this.callSession = session;
      if (this.callStopRequested) {
        await this.stopCallCapture();
        return;
      }
      if (this.clippyStep() === 'offer' || this.clippyStep() === 'recording') {
        this.clippySession = true;
        this.clippyStep.set('recording');
        this.clippyMood.set('listen');
      }
    } catch (error) {
      if (generation !== this.callGeneration) return;
      this.callStopRequested = false;
      this.callLive.set(false);
      this.callSession = null;
      this.callStartedAt = 0;
      this.callPaused.set(false);
      this.callPausedMs = 0;
      this.callPausedAt = 0;
      if (this.callTimer) {
        clearInterval(this.callTimer);
        this.callTimer = null;
      }
      this.callError.set(microphoneErrorMessage(error, this.voiceCapture()));
      if (this.clippyStep() === 'recording' || this.clippyStep() === 'saving') {
        this.clippyStep.set('offer');
        this.clippyMood.set('ask');
      }
    }
  }

  async stopCallCapture(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.callBusy()) return;
    const session = this.callSession;
    const voice = this.voiceCapture();
    this.callStopRequested = true;
    this.callLive.set(false);
    this.callPaused.set(false);
    if (this.callPausedAt) {
      this.callPausedMs += Date.now() - this.callPausedAt;
      this.callPausedAt = 0;
    }
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
    if (this.clippySession) {
      this.clippyStep.set('saving');
      this.clippyMood.set('think');
    }
    if (!session) return;
    this.callSession = null;
    this.callBusy.set(true);
    try {
      const result = await session.stop();
      if (result.blob.size) {
        const type = result.blob.type || 'audio/webm';
        const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'webm';
        const file = new File(
          [result.blob],
          voice ? `nota-de-voz.${ext}` : `llamada.${ext}`,
          { type },
        );
        const title = voice ? `Nota de voz ${this.dateLabel()}` : `Llamada ${this.dateLabel()}`;
        try {
          const recording = await firstValueFrom(
            this.recordingsApi.upload(file, title, result.durationSeconds),
          );
          this.callRecordingId = recording.id;
        } catch (error) {
          console.error('No se pudo subir el audio', error);
          if (!voice) throw error;
        }
      }
      if (voice) {
        await this.saveVoiceNote(this.callRecordingId, result.transcript, result.durationSeconds);
        return;
      }
    } catch (error) {
      console.error('No se pudo guardar la captura', error);
      this.callError.set(voice ? 'No se pudo guardar la nota de voz.' : 'No se pudo detener la captura.');
      if (voice) {
        this.clippyStep.set('offer');
        this.clippyMood.set('ask');
        return;
      }
    } finally {
      this.callBusy.set(false);
      this.callStopRequested = false;
    }
    this.afterCallStopped();
  }

  private armCallClock(): void {
    if (this.callTimer) clearInterval(this.callTimer);
    this.callTimer = setInterval(() => this.callTick.update((value) => value + 1), 250);
  }

  toggleCallPause(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const session = this.callSession;
    if (!session || !this.callLive()) return;
    if (this.callPaused()) {
      session.resume();
      if (this.callPausedAt) this.callPausedMs += Date.now() - this.callPausedAt;
      this.callPausedAt = 0;
      this.callPaused.set(false);
      this.clippyMood.set('listen');
      return;
    }
    session.pause();
    if (!session.paused()) return;
    this.callPausedAt = Date.now();
    this.callPaused.set(true);
    this.clippyMood.set('idle');
  }

  t(key: string): string {
    return this.prefs.t(key);
  }

  initials(): string {
    const user = this.auth.user();
    const source = (user?.name || user?.email || 'M').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    const token = parts[0] ?? 'M';
    if (token.includes('@')) return token[0].toUpperCase();
    return token.slice(0, 2).toUpperCase();
  }

  displayName(): string {
    const user = this.auth.user();
    return user?.name?.trim() || user?.email || 'Meeter';
  }

  toggleAccount(event: Event): void {
    event.stopPropagation();
    this.accountOpen.update((open) => !open);
  }

  logout(): void {
    this.accountOpen.set(false);
    this.auth.logout();
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
    const pos = this.nextFreeNotePos();
    this.notesApi
      .fromCall({
        transcript: this.callTranscript(),
        title: `Llamada ${this.dateLabel()}`,
        created_at: this.timestampForSelectedDay(),
        pos_x: pos.x,
        pos_y: pos.y,
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

  private async saveVoiceNote(recordingId: string | null, transcript: string, durationSeconds: number): Promise<void> {
    const createdAt = this.timestampForSelectedDay();
    const spoken = transcript.trim();
    const clock = this.formatVoiceTime(durationSeconds);
    const body = spoken || `Nota de voz de ${clock}. Pulsa reproducir para escucharla.`;
    const pos = this.nextFreeNotePos();
    this.insertLocalNote({
      title: 'Nota de voz',
      body,
      color: 'sky',
      recording_id: recordingId,
      priority: 1,
      pos_x: pos.x,
      pos_y: pos.y,
      rotation: -1.8,
      width: NOTE_W,
      height: NOTE_H,
      created_at: createdAt,
    });
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

  voiceRateLabel(): string {
    const rate = this.voiceRate();
    return rate % 1 === 0 ? `x${rate}` : `x${rate}`;
  }

  cycleVoiceRate(note: Note): void {
    const current = VOICE_RATES.indexOf(this.voiceRate() as (typeof VOICE_RATES)[number]);
    const next = VOICE_RATES[(current + 1) % VOICE_RATES.length];
    this.voiceRate.set(next);
    if (this.voiceAudio && this.voiceNoteId() === note.id) this.voiceAudio.playbackRate = next;
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
    audio.playbackRate = this.voiceRate();
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

  isVoiceTranscribing(note: Note): boolean {
    return this.voiceTranscribingId() === note.id;
  }

  extractVoiceText(note: Note): void {
    if (!note.recording_id || !this.canEdit(note) || this.voiceTranscribingId()) return;
    this.voiceTranscribingId.set(note.id);
    this.error.set('');
    const recordingId = note.recording_id;
    const language = this.prefs.lang() === 'en' ? 'en' : 'es';
    const apply = (text: string) => {
      if (this.voiceTranscribingId() !== note.id) return;
      this.voiceTranscribingId.set(null);
      const spoken = text.trim();
      if (!spoken) {
        this.error.set('No se oyó texto en esta grabación.');
        return;
      }
      this.setText(note, spoken);
      this.growForTranscript(note, spoken);
      this.save(note);
    };
    this.recordingsApi.transcript(recordingId).subscribe({
      next: (item) => apply(item.text || ''),
      error: () => {
        this.recordingsApi.transcribe(recordingId, language).subscribe({
          next: (item) => apply(item.text || ''),
          error: (err: HttpErrorResponse) => {
            if (this.voiceTranscribingId() !== note.id) return;
            this.voiceTranscribingId.set(null);
            const detail = typeof err.error?.detail === 'string' ? err.error.detail : '';
            this.error.set(detail.trim() || 'No se pudo extraer el texto. Inténtalo de nuevo.');
          },
        });
      },
    });
  }

  private growForTranscript(note: Note, text: string): void {
    const lines = Math.max(3, Math.ceil(text.length / 26));
    const needed = 108 + lines * 16;
    const size = this.noteSize(note);
    if (size.h >= needed) return;
    note.height = Math.min(460, needed);
    this.notes.update((items) => [...items]);
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
    const pos = this.nextFreeNotePos();
    this.insertLocalNote({
      title: 'Notas de la llamada',
      body,
      color: 'yellow',
      recording_id: this.callRecordingId,
      priority: 1,
      pos_x: pos.x,
      pos_y: pos.y,
      rotation: -2.2,
      created_at: this.timestampForSelectedDay(),
    });
  }

  startMove(event: PointerEvent, note: Note): void {
    if (!this.canEdit(note)) return;
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
    if (!this.canEdit(note)) return;
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
      (w === 176 && h === 198) ||
      (w === 156 && h === 176) ||
      (w === 164 && h === 185)
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
      const origin = this.padPointer;
      if (!origin) return;
      if (!this.ghost() && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8) return;
      this.ghost.set({ x: event.clientX - origin.dx, y: event.clientY - origin.dy });
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
    const text = this.plainOf(note).trim();
    if (!text) return this.imagesOf(note).length ? 'Nota con imagen' : 'Nota vacía';
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }

  titleOf(note: Note): string {
    return (note.title ?? '').trim();
  }

  setTitle(note: Note, title: string): void {
    note.title = title;
    this.beginEdit(note);
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
    if (!this.canEdit(note)) return;
    note.color = color;
    this.patchNote(note.id, { color });
    this.notes.update((items) => [...items]);
    this.closeNoteFlyout();
  }

  toggleReminderPicker(note: Note, expanded = false): void {
    this.toggleNoteFlyout(note, 'remind', expanded);
  }

  toggleDateMover(note: Note, expanded = false): void {
    this.toggleNoteFlyout(note, 'date', expanded);
  }

  private toggleNoteFlyout(note: Note, kind: 'color' | 'remind' | 'date' | 'share' | 'rich', expanded: boolean): void {
    const current = this.noteFlyout();
    if (current?.kind === kind && current.noteId === note.id) {
      this.closeNoteFlyout();
      return;
    }
    if (current?.kind === 'rich') {
      const previous = this.notes().find((item) => item.id === current.noteId);
      if (previous) this.flushRichBody(previous);
    }
    if (kind === 'remind') this.initRemindDraft(note);
    if (kind === 'date') this.initDateDraft();
    const width = kind === 'remind' ? 268 : kind === 'date' ? 196 : kind === 'share' ? 236 : kind === 'rich' ? 228 : 156;
    const height = kind === 'remind' ? 348 : kind === 'date' ? 228 : kind === 'share' ? 220 : kind === 'rich' ? 168 : 196;
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
    const panel = this.noteFlyout();
    if (panel?.kind === 'rich') {
      const note = this.notes().find((item) => item.id === panel.noteId);
      if (note) this.flushRichBody(note);
    }
    this.noteFlyout.set(null);
    this.remindDraft.set(null);
    this.dateDraft.set(null);
    this.shareError.set('');
  }

  isOwner(note: Note): boolean {
    return note.access !== 'read' && note.access !== 'write';
  }

  canEdit(note: Note): boolean {
    return note.access !== 'read';
  }

  canShare(note: Note): boolean {
    return this.isOwner(note) && !note.archived;
  }

  toggleSharePanel(note: Note, expanded = false): void {
    if (!this.canShare(note)) return;
    const current = this.noteFlyout();
    if (current?.kind === 'share' && current.noteId === note.id) {
      this.closeNoteFlyout();
      return;
    }
    this.shareQuery.set('');
    this.shareCanRead.set(true);
    this.shareCanWrite.set(false);
    this.shareError.set('');
    this.shares.set([]);
    this.toggleNoteFlyout(note, 'share', expanded);
    if (note.id.startsWith('local-')) {
      this.shareError.set('Espera a que se guarde la nota para compartirla.');
      return;
    }
    this.notesApi.listShares(note.id).subscribe({
      next: (people) => this.shares.set(people),
      error: (err: HttpErrorResponse) => {
        this.shareError.set(this.shareFailMessage(err, 'No se pudieron cargar las personas.'));
      },
    });
  }

  setShareDraftRead(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    if (!on && this.shareCanWrite()) {
      this.shareCanRead.set(true);
      return;
    }
    this.shareCanRead.set(on);
  }

  setShareDraftWrite(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.shareCanWrite.set(on);
    if (on) this.shareCanRead.set(true);
  }

  submitShare(note: Note): void {
    if (this.shareBusy() || !this.canShare(note) || note.id.startsWith('local-')) return;
    const identifier = this.shareQuery().trim();
    if (!identifier) {
      this.shareError.set('Escribe un nombre o correo.');
      return;
    }
    if (!this.shareCanRead() && !this.shareCanWrite()) {
      this.shareError.set('Elige al menos lectura o escritura.');
      return;
    }
    this.shareBusy.set(true);
    this.shareError.set('');
    this.notesApi
      .share(note.id, {
        identifier,
        can_read: this.shareCanRead() || this.shareCanWrite(),
        can_write: this.shareCanWrite(),
      })
      .subscribe({
        next: (person) => {
          this.shareBusy.set(false);
          this.shareQuery.set('');
          this.shares.update((people) => {
            const rest = people.filter((item) => item.id !== person.id && item.user_id !== person.user_id);
            return [...rest, person];
          });
          this.bumpShareCount(note.id, this.shares().length);
        },
        error: (err: HttpErrorResponse) => {
          this.shareBusy.set(false);
          this.shareError.set(this.shareFailMessage(err, 'No se pudo compartir la nota.'));
        },
      });
  }

  setSharePerm(note: Note, person: NoteShare, kind: 'read' | 'write', event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const can_write = kind === 'write' ? on : person.can_write;
    const can_read = kind === 'read' ? on || can_write : person.can_read || can_write;
    if (!can_read && !can_write) {
      this.removeShare(note, person);
      return;
    }
    this.notesApi.updateShare(note.id, person.id, { can_read, can_write }).subscribe({
      next: (saved) => {
        this.shares.update((people) => people.map((item) => (item.id === saved.id ? saved : item)));
      },
      error: (err: HttpErrorResponse) => {
        this.shareError.set(this.shareFailMessage(err, 'No se pudieron guardar los permisos.'));
      },
    });
  }

  removeShare(note: Note, person: NoteShare): void {
    this.notesApi.unshare(note.id, person.id).subscribe({
      next: () => {
        this.shares.update((people) => people.filter((item) => item.id !== person.id));
        this.bumpShareCount(note.id, this.shares().length);
      },
      error: (err: HttpErrorResponse) => {
        this.shareError.set(this.shareFailMessage(err, 'No se pudo dejar de compartir.'));
      },
    });
  }

  private bumpShareCount(noteId: string, count: number): void {
    this.notes.update((items) =>
      items.map((note) => (note.id === noteId ? { ...note, share_count: count } : note)),
    );
  }

  private shareFailMessage(err: HttpErrorResponse, fallback: string): string {
    const detail = err.error?.detail;
    return typeof detail === 'string' && detail.trim() ? detail : fallback;
  }

  private initDateDraft(): void {
    const selected = BoardPage.parseDayKey(this.selectedDay());
    const today = BoardPage.parseDayKey(this.todayKey());
    const start = selected.getTime() >= today.getTime() ? selected : today;
    this.dateDraft.set({ year: start.getFullYear(), month: start.getMonth() });
  }

  shiftMoveMonth(delta: number): void {
    const draft = this.dateDraft();
    if (!draft) return;
    const date = new Date(draft.year, draft.month + delta, 1);
    this.dateDraft.set({ year: date.getFullYear(), month: date.getMonth() });
  }

  shiftMoveYear(delta: number): void {
    const draft = this.dateDraft();
    if (!draft) return;
    this.dateDraft.set({ year: draft.year + delta, month: draft.month });
  }

  moveNoteToDate(note: Note, key: string): void {
    if (!this.canEdit(note)) return;
    if (key < this.todayKey()) return;
    if (this.dayKey(note.created_at) === key) {
      this.closeNoteFlyout();
      return;
    }
    const from = this.discardOrigin(note) ?? this.fallbackNoteRect(note);
    this.closeNoteFlyout();
    if (this.expandedId() === note.id) this.closeExpanded(false);
    this.launchTowardCalendar(note, from);
    note.created_at = this.timestampForDay(key);
    note.updated_at = new Date().toISOString();
    this.patchNote(note.id, { created_at: note.created_at });
    this.notes.update((items) => [...items]);
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = null;
      this.arrangeByPriority(undefined, false);
    }, 420);
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
    const when = key === today ? this.t('board.today') : `${draft.day} ${this.monthNames()[draft.month]}`;
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
    if (!this.canEdit(note)) return;
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
    const rich = this.isRichEditing(note) || this.isRich(note);
    const id = rich
      ? expanded
        ? `note-rich-exp-${note.id}`
        : `note-rich-${note.id}`
      : expanded
        ? `note-body-exp-${note.id}`
        : `note-body-${note.id}`;
    document.getElementById(id)?.focus();
  }

  textOf(note: Note): string {
    const body = note.body ?? '';
    const cuts = [body.indexOf(IMAGE_MARK), body.indexOf(MARK_MARK)].filter((index) => index >= 0);
    const index = cuts.length ? Math.min(...cuts) : -1;
    return (index === -1 ? body : body.slice(0, index)).replace(/\s+$/, '');
  }

  plainOf(note: Note): string {
    return stripHtml(this.textOf(note));
  }

  isRich(note: Note): boolean {
    return isRichHtml(this.textOf(note));
  }

  isRichEditing(note: Note): boolean {
    const panel = this.noteFlyout();
    return panel?.kind === 'rich' && panel.noteId === note.id;
  }

  safeRich(note: Note): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(sanitizeRich(this.textOf(note)));
  }

  beginEdit(note: Note): void {
    if (!this.canEdit(note) || note.archived || note.pinned) return;
    const current = this.editingId();
    if (current === note.id) return;
    if (current) {
      const other = this.notes().find((item) => item.id === current);
      if (other) this.commitNote(other);
    }
    this.editingId.set(note.id);
    this.sync.hold();
  }

  commitNote(note: Note): void {
    if (this.editingId() !== note.id) return;
    if (this.canEdit(note)) this.save(note);
    this.editingId.set(null);
    this.sync.release();
  }

  onNotePointerLeave(event: PointerEvent, note: Note): void {
    if (this.draggingNoteId() === note.id || this.isRichEditing(note)) return;
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    if (next && (next as HTMLElement).closest?.('.note-flyout')) return;
    this.commitNote(note);
  }

  onNoteFocusOut(event: FocusEvent, note: Note): void {
    if (this.isRichEditing(note)) return;
    const next = event.relatedTarget as HTMLElement | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    if (next?.closest('.note-flyout')) return;
    this.commitNote(note);
  }

  private isNoteBusy(id: string): boolean {
    const panel = this.noteFlyout();
    if (this.editingId() === id || (panel?.kind === 'rich' && panel.noteId === id)) return true;
    const active = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    return Boolean(active?.closest(`#note-card-${id}, .note-expanded, .note-flyout.is-rich`));
  }

  private richRange: Range | null = null;
  private richOffsets: { start: number; end: number } | null = null;

  keepNoteSelection(event: Event, note: Note): void {
    event.preventDefault();
    event.stopPropagation();
    this.captureNoteSelection(note);
  }

  toggleRichTools(note: Note, expanded = false): void {
    if (!this.canEdit(note)) return;
    const current = this.noteFlyout();
    if (current?.kind === 'rich' && current.noteId === note.id) {
      this.closeNoteFlyout();
      return;
    }
    this.captureNoteSelection(note);
    this.beginEdit(note);
    this.toggleNoteFlyout(note, 'rich', expanded);
    this.seedRichBody(note);
  }

  private richBodyEl(note: Note): HTMLElement | null {
    const expanded = this.expandedId() === note.id;
    return document.getElementById(expanded ? `note-rich-exp-${note.id}` : `note-rich-${note.id}`);
  }

  private seedRichBody(note: Note): void {
    window.setTimeout(() => {
      const editor = this.richBodyEl(note);
      if (!editor) return;
      const text = this.textOf(note);
      editor.innerHTML = isRichHtml(text) ? sanitizeRich(text) : this.plainToHtml(text);
      editor.focus();
      this.restoreRichSelection(editor);
      requestAnimationFrame(() => this.restoreRichSelection(editor));
      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        /* ignore */
      }
    });
  }

  private plainToHtml(text: string): string {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  private flushRichBody(note: Note): void {
    const editor = this.richBodyEl(note);
    if (!editor) return;
    const html = sanitizeRich(editor.innerHTML).replace(/^(<br\s*\/?>|\s|&nbsp;)*$/i, '');
    const next = isRichHtml(html) ? html : stripHtml(html);
    this.writeBody(note, this.imagesOf(note), this.marksOf(note), next);
  }

  onRichInput(note: Note, event: Event): void {
    const html = sanitizeRich((event.target as HTMLElement).innerHTML);
    const next = isRichHtml(html) ? html : stripHtml(html);
    this.writeBody(note, this.imagesOf(note), this.marksOf(note), next);
    this.beginEdit(note);
  }

  onRichToolbarDown(event: MouseEvent): void {
    this.saveRichSelection();
    const target = event.target as HTMLElement;
    if (target.closest('select')) return;
    event.preventDefault();
  }

  private captureNoteSelection(note: Note): void {
    const expanded = this.expandedId() === note.id;
    const textarea = document.getElementById(
      expanded ? `note-body-exp-${note.id}` : `note-body-${note.id}`,
    ) as HTMLTextAreaElement | null;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
      const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
      this.richOffsets = { start, end };
      this.richRange = null;
      return;
    }
    const host =
      this.richBodyEl(note) ??
      (document.querySelector(
        expanded ? '.note-expanded .note-rich-html' : `#note-card-${note.id} .note-rich-html`,
      ) as HTMLElement | null);
    const sel = window.getSelection();
    if (!host || !sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== host) return;
    this.richOffsets = offsetsFromRange(host, range);
    this.richRange = range.cloneRange();
  }

  private saveRichSelection(): void {
    const note = this.flyoutNote();
    const editor = note ? this.richBodyEl(note) : null;
    const sel = window.getSelection();
    if (!note || !editor || !sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== editor) return;
    this.richRange = range.cloneRange();
    if (!range.collapsed) this.richOffsets = offsetsFromRange(editor, range);
  }

  private restoreRichSelection(editor: HTMLElement): boolean {
    if (this.richOffsets && this.richOffsets.start !== this.richOffsets.end) {
      const mapped = rangeFromOffsets(editor, this.richOffsets.start, this.richOffsets.end);
      if (mapped) {
        try {
          const sel = window.getSelection();
          if (!sel) return false;
          sel.removeAllRanges();
          sel.addRange(mapped);
          this.richRange = mapped.cloneRange();
          editor.focus();
          return true;
        } catch {
          /* fall through */
        }
      }
    }
    const range = this.richRange;
    if (!range) return false;
    try {
      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
      return true;
    } catch {
      return false;
    }
  }

  richCommand(command: string, value?: string): void {
    const note = this.flyoutNote();
    const editor = note ? this.richBodyEl(note) : null;
    if (!note || !editor) return;
    this.restoreRichSelection(editor);
    let applied = false;
    if (command === 'bold') {
      applied = wrapSelection(editor, 'strong', { 'font-weight': '900' });
    } else if (command === 'italic') {
      applied = wrapSelection(editor, 'em');
    } else if (command === 'underline') {
      applied = wrapSelection(editor, 'u');
    } else if (command === 'strikeThrough') {
      applied = wrapSelection(editor, 's');
    } else if (command === 'insertUnorderedList') {
      applied = applyList(editor, false);
    } else if (command === 'insertOrderedList') {
      applied = applyList(editor, true);
    } else if (command === 'fontSize' && value) {
      const sizes: Record<string, string> = { '2': '12px', '3': '16px', '5': '22px', '7': '28px' };
      applied = wrapSelection(editor, 'span', { 'font-size': sizes[value] || '16px' });
    } else if (command === 'fontName' && value) {
      applied = wrapSelection(editor, 'span', { 'font-family': value });
    }
    if (!applied) {
      try {
        document.execCommand(command, false, value);
      } catch {
        /* last resort */
      }
    }
    this.flushRichBody(note);
  }

  richFont(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.richCommand('fontName', value);
  }

  richHighlight(color: string): void {
    const note = this.flyoutNote();
    const editor = note ? this.richBodyEl(note) : null;
    if (!note || !editor) return;
    this.restoreRichSelection(editor);
    if (color === 'transparent') {
      wrapSelection(editor, 'span', { 'background-color': 'transparent' });
    } else {
      wrapSelection(editor, 'mark', { 'background-color': color });
    }
    this.flushRichBody(note);
  }

  onRichPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    const payload = html ? sanitizeRich(html) : text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    try {
      document.execCommand('insertHTML', false, payload);
    } catch {
      /* ignore */
    }
    const note = this.flyoutNote();
    if (note) this.flushRichBody(note);
  }

  jumpToSearch(note: Note): void {
    const key = this.dayKey(note.created_at);
    this.selectDay(key);
    queueMicrotask(() => {
      if (note.pinned) {
        this.doneOpen.set(true);
        return;
      }
      this.bringForward(note);
      document.getElementById(`note-card-${note.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  private searchDateLabel(key: string): string {
    if (key === this.todayKey()) return this.t('board.today');
    const date = BoardPage.parseDayKey(key);
    const formatted = date.toLocaleDateString(this.prefs.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
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
    this.beginEdit(note);
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
    if (persist && note) this.commitNote(note);
    this.expandedId.set(null);
    this.expandLevel.set(1);
    this.drawTool.set('cursor');
    this.drawDraft.set(null);
    this.markDrag.set(null);
    this.drawing = null;
    this.movingMark = null;
  }

  onNoteDragOver(event: DragEvent, note: Note): void {
    if (!this.canEdit(note)) return;
    const types = [...(event.dataTransfer?.types ?? [])];
    if (!types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dropTargetId.set(note.id);
  }

  onNoteDrop(event: DragEvent, note: Note): void {
    if (!this.canEdit(note)) return;
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
    if (!note || note.archived || note.pinned || !this.canEdit(note)) return;
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
    const haystack = this.normalizeText(`${note.title} ${this.plainOf(note)} ${note.priority}`);
    return tokens.every((token) => haystack.includes(this.normalizeText(token)));
  }

  private matchesDay(note: Note, kind: 'board' | 'trash'): boolean {
    const selected = this.selectedDay();
    const created = this.dayKey(note.created_at);
    if (kind === 'board') return created === selected;
    return created === selected || this.dayKey(note.updated_at) === selected;
  }

  dayKey(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return BoardPage.localDayKey(date);
  }

  private timestampForDay(key: string): string {
    const date = BoardPage.parseDayKey(key);
    date.setHours(12, 0, 0, 0);
    return date.toISOString();
  }

  private timestampForSelectedDay(): string {
    if (this.selectedDay() === this.todayKey()) return new Date().toISOString();
    return this.timestampForDay(this.selectedDay());
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
  @HostListener('document:pointercancel')
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
      this.endPadDrag();
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
      const note = this.moving.note;
      note.pos_x = Math.round(note.pos_x);
      note.pos_y = Math.round(note.pos_y);
      this.save(note);
      this.moving = null;
      this.draggingNoteId.set(null);
    }
  }

  setPriority(note: Note, priority: number): void {
    if (!this.canEdit(note)) return;
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
    if (!this.isOwner(note)) return;
    this.commitNote(note);
    if (this.voiceNoteId() === note.id) this.stopVoice();
    if (this.voiceTranscribingId() === note.id) this.voiceTranscribingId.set(null);
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
    if (!this.isOwner(note)) return;
    this.commitNote(note);
    if (this.voiceNoteId() === note.id) this.stopVoice();
    if (this.voiceTranscribingId() === note.id) this.voiceTranscribingId.set(null);
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

  stackTransform(index: number, total = 1): string {
    if (total <= 1) return 'translateX(-50%) rotate(0deg)';
    const tilts = [-14, -7, 4, 11, -3, 8, -10, 6, 2, -5, 9, -12];
    const spread = (index - (total - 1) / 2) * 3;
    return `translateX(calc(-50% + ${spread}px)) rotate(${tilts[index % tilts.length]}deg) translateY(${-index * 2}px)`;
  }

  private launchTowardDone(note: Note): void {
    const card = document.getElementById(`note-card-${note.id}`);
    const pile = this.doneDock?.nativeElement.querySelector('.done-pile') as HTMLElement | null;
    if (!card || !pile) return;
    const from = card.getBoundingClientRect();
    const to = pile.getBoundingClientRect();
    this.flyingNote.set({
      kind: 'done',
      x: from.left,
      y: from.top,
      w: from.width,
      h: from.height,
      dx: to.left + to.width / 2 - (from.left + from.width / 2),
      dy: to.top + to.height / 3 - (from.top + from.height / 2),
      rot: `${note.rotation + 16}deg`,
      body: this.textOf(note),
      color: this.colorOf(note),
      moving: false,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.flyingNote.update((fly) => (fly ? { ...fly, moving: true } : null));
      });
    });
    window.setTimeout(() => this.flyingNote.set(null), 680);
  }

  private launchTowardCalendar(note: Note, from: DOMRect): void {
    const cal =
      document.querySelector('#board-date-filter .date-filter-btn') ??
      document.querySelector('#board-date-filter');
    const to = cal?.getBoundingClientRect() ?? new DOMRect(window.innerWidth - 180, 16, 148, 40);
    if (this.dateFlyTimer) clearTimeout(this.dateFlyTimer);
    this.dateCatching.set(true);
    this.flyingNote.set({
      kind: 'date',
      x: from.left,
      y: from.top,
      w: from.width,
      h: from.height,
      dx: to.left + to.width / 2 - (from.left + from.width / 2),
      dy: to.top + to.height / 2 - (from.top + from.height / 2),
      rot: `${note.rotation + (from.left > to.left ? -22 : 18)}deg`,
      body: this.preview(note),
      color: this.colorOf(note),
      moving: false,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.flyingNote.update((fly) => (fly ? { ...fly, moving: true } : null));
      });
    });
    this.dateFlyTimer = window.setTimeout(() => {
      this.flyingNote.set(null);
      this.dateCatching.set(false);
      this.dateFlyTimer = null;
    }, 440);
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
      color: this.colorOf(note),
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
    if (!this.canEdit(note)) return;
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

  private touch(note: Note): void {
    if (!this.canEdit(note)) return;
    note.updated_at = new Date().toISOString();
    this.sync.markNote({ ...this.normalize(note) });
    this.scheduleCache();
  }

  private patchNote(id: string, payload: Partial<Note>): void {
    const note = this.notes().find((item) => item.id === id);
    if (!note || !this.canEdit(note)) {
      this.scheduleCache();
      return;
    }
    Object.assign(note, payload);
    note.updated_at = new Date().toISOString();
    this.sync.markNote({ ...this.normalize(note) });
    this.notes.update((items) => [...items]);
    this.scheduleCache();
  }

  private boardNotesForPlacement(): Note[] {
    return this.notes().filter(
      (note) => this.isOwner(note) && !note.archived && !note.pinned && this.matchesDay(note, 'board'),
    );
  }

  private lastCreatedBoardNote(): Note | undefined {
    const items = this.boardNotesForPlacement();
    if (!items.length) return undefined;
    const recent = this.lastCreatedNoteId
      ? items.find((note) => note.id === this.lastCreatedNoteId)
      : undefined;
    if (recent) return recent;
    return items.reduce((best, note) => {
      const byCreated = String(note.created_at || '').localeCompare(String(best.created_at || ''));
      if (byCreated > 0) return note;
      if (byCreated < 0) return best;
      const byUpdated = String(note.updated_at || '').localeCompare(String(best.updated_at || ''));
      if (byUpdated > 0) return note;
      if (byUpdated < 0) return best;
      if ((note.pos_y ?? 0) > (best.pos_y ?? 0) + 8) return note;
      if (Math.abs((note.pos_y ?? 0) - (best.pos_y ?? 0)) <= 8 && (note.pos_x ?? 0) > (best.pos_x ?? 0)) {
        return note;
      }
      return best;
    });
  }

  private nextFreeNotePos(): { x: number; y: number } {
    const startX = 36;
    const startY = 132;
    try {
      const gapX = 22;
      const gapY = 26;
      const occupants = this.boardNotesForPlacement();
      const last = this.lastCreatedBoardNote();
      const stageW = this.stage?.nativeElement.getBoundingClientRect().width ?? window.innerWidth;
      const maxX = Math.max(startX, stageW - NOTE_W - 28);
      let x = last ? (last.pos_x ?? startX) + this.noteSize(last).w + gapX : startX;
      let y = last ? (last.pos_y ?? startY) : startY;
      const overlaps = (px: number, py: number) =>
        occupants.some((note) => {
          const size = this.noteSize(note);
          return Math.abs((note.pos_x ?? 0) - px) < size.w - 16 && Math.abs((note.pos_y ?? 0) - py) < size.h - 16;
        });
      for (let step = 0; step < 80; step += 1) {
        if (x > maxX) {
          x = startX;
          y += NOTE_H + gapY;
        }
        if (!overlaps(x, y)) return { x: Math.round(x), y: Math.round(y) };
        x += NOTE_W + gapX;
      }
      return { x: startX, y: Math.round(y) };
    } catch {
      return { x: startX, y: startY };
    }
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
          this.isOwner(note) &&
          !note.archived &&
          !note.pinned &&
          (note.priority || 1) === level &&
          this.matchesDay(note, 'board'),
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
        if (note.archived || note.id.startsWith('local-') || !this.canEdit(note)) continue;
        const moved = previous.get(note.id) !== `${note.pos_x},${note.pos_y}`;
        if (moved || note.id === movedId) this.patchNote(note.id, { pos_x: note.pos_x, pos_y: note.pos_y });
      }
    }
    this.scheduleCache();
  }

  private newNoteId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      /* HTTP en la red local no es un contexto seguro. */
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }

  private dropPad(): void {
    if (!this.draggingPad() && !this.padPointer) return;
    const ghost = this.ghost();
    this.draggingPad.set(false);
    this.ghost.set(null);
    this.padPointer = null;
    const stageEl = this.stage?.nativeElement;
    if (!stageEl) return;
    const board = stageEl.getBoundingClientRect();
    const dragged = Boolean(ghost);
    const pos_x = ghost
      ? Math.round(Math.max(8, ghost.x - board.left + stageEl.scrollLeft))
      : 36;
    const pos_y = ghost
      ? Math.round(Math.max(8, ghost.y - board.top + stageEl.scrollTop))
      : 132;
    const rotation = Math.round((Math.random() * 10 - 5) * 10) / 10;
    const local = this.insertLocalNote({
      pos_x,
      pos_y,
      rotation,
      created_at: this.timestampForSelectedDay(),
    });
    if (!dragged) this.revealNote(local);
    this.bringForward(local);
    if (!dragged) this.arrangeByPriority(local.id);
    window.setTimeout(() => document.getElementById(`note-body-${local.id}`)?.focus(), dragged ? 40 : 920);
  }

  private insertLocalNote(fields: Partial<Note>): Note {
    const createdAt = fields.created_at || this.timestampForSelectedDay();
    const note = this.normalize({
      id: this.newNoteId(),
      title: fields.title ?? '',
      body: fields.body ?? '',
      color: fields.color ?? 'yellow',
      pinned: Boolean(fields.pinned),
      archived: Boolean(fields.archived),
      recording_id: fields.recording_id ?? null,
      priority: fields.priority ?? 1,
      pos_x: fields.pos_x ?? 36,
      pos_y: fields.pos_y ?? 132,
      rotation: fields.rotation ?? -1.5,
      width: fields.width || NOTE_W,
      height: fields.height || NOTE_H,
      reminder_at: fields.reminder_at ?? null,
      alarm_tone: fields.alarm_tone ?? 'classic',
      reminder_silenced: Boolean(fields.reminder_silenced),
      created_at: createdAt,
      updated_at: new Date().toISOString(),
      access: 'owner',
      owner_name: null,
      share_count: 0,
    });
    this.lastCreatedNoteId = note.id;
    this.seenNoteIds?.add(note.id);
    this.notes.update((items) => [...items, note]);
    this.sync.markNote(note);
    this.cache();
    return note;
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

  private cacheKey(): string {
    const userId = this.auth.user()?.id;
    return userId ? `meeter.board-notes.${userId}` : 'meeter.board-notes';
  }

  private flushCache(): void {
    try {
      localStorage.setItem(this.cacheKey(), JSON.stringify(this.notes()));
    } catch {
      /* Las imágenes a tamaño original pueden superar la cuota de localStorage. */
    }
  }

  private cached(): Note[] {
    try {
      const raw = localStorage.getItem(this.cacheKey()) ?? localStorage.getItem('meeter.board-notes');
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
      access: note.access === 'read' || note.access === 'write' ? note.access : 'owner',
      owner_name: note.owner_name ?? null,
      share_count: note.share_count ?? 0,
    };
  }
}
