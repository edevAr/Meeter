import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../core/auth.service';
import { PrefsService } from '../../core/prefs.service';

type AuthView = 'login' | 'register' | 'forgot' | 'reset';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  template: `
    <section class="auth-screen">
      <div class="auth-glow"></div>
      <div class="auth-copy">
        <p class="text-[11px] uppercase tracking-[0.32em] text-sun/80">Meeter</p>
        <h1 class="font-note text-4xl font-semibold tracking-tight text-[#f8ecd4]">{{ t('login.headline') }}</h1>
        <p class="mt-2 max-w-sm text-[14px] text-[#d7c4a6]/80">
          {{ t('login.lede') }}
        </p>
      </div>

      <form class="auth-card sticky-paper" data-color="yellow" (submit)="submit($event)">
        <div class="sticky-tape mx-auto mb-3 h-3 w-16 rounded-sm"></div>
        <p class="auth-kicker">{{ kicker() }}</p>
        <h2 class="font-note text-2xl text-[#3b2a12]">{{ title() }}</h2>

        @if (view() === 'register') {
          <label class="auth-field">
            <span>{{ t('login.field.name') }}</span>
            <input name="name" [(ngModel)]="name" autocomplete="name" placeholder="Ana" />
          </label>
        }

        <label class="auth-field">
          <span>{{ t('login.field.email') }}</span>
          <input name="email" type="email" [(ngModel)]="email" autocomplete="email" required placeholder="tu@correo.com" />
        </label>

        @if (view() === 'login' || view() === 'register') {
          <label class="auth-field">
            <span>{{ t('login.field.password') }}</span>
            <div class="auth-secret">
              <input
                name="password"
                [type]="showPassword() ? 'text' : 'password'"
                [(ngModel)]="password"
                [attr.autocomplete]="view() === 'login' ? 'current-password' : 'new-password'"
                required
                minlength="8"
                [placeholder]="t('login.hint.password')"
              />
              <button
                type="button"
                class="auth-eye"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Ocultar clave' : 'Mostrar clave'"
                [attr.aria-pressed]="showPassword()"
              >
                @if (showPassword()) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z"/>
                    <circle cx="12" cy="12" r="2.6"/>
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12c2.4-3.2 5.5-4.8 9-4.8"/>
                    <path d="M21 12c-2.4 3.2-5.5 4.8-9 4.8"/>
                    <path d="M4 15.5c1.2.7 2.6 1.1 4 1.3"/>
                    <path d="M16 16.8c1.4-.2 2.8-.6 4-1.3"/>
                    <path d="M8 8.6c.6-.3 2.2-.8 4-.8 1.5 0 2.8.3 4 .8"/>
                  </svg>
                }
              </button>
            </div>
          </label>
        }

        @if (view() === 'register') {
          <label class="auth-field">
            <span>{{ t('login.field.confirm') }}</span>
            <div class="auth-secret">
              <input
                name="confirm"
                [type]="showConfirm() ? 'text' : 'password'"
                [(ngModel)]="confirm"
                autocomplete="new-password"
                required
                minlength="8"
              />
              <button
                type="button"
                class="auth-eye"
                (click)="showConfirm.set(!showConfirm())"
                [attr.aria-label]="showConfirm() ? 'Ocultar clave' : 'Mostrar clave'"
                [attr.aria-pressed]="showConfirm()"
              >
                @if (showConfirm()) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z"/>
                    <circle cx="12" cy="12" r="2.6"/>
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12c2.4-3.2 5.5-4.8 9-4.8"/>
                    <path d="M21 12c-2.4 3.2-5.5 4.8-9 4.8"/>
                    <path d="M4 15.5c1.2.7 2.6 1.1 4 1.3"/>
                    <path d="M16 16.8c1.4-.2 2.8-.6 4-1.3"/>
                    <path d="M8 8.6c.6-.3 2.2-.8 4-.8 1.5 0 2.8.3 4 .8"/>
                  </svg>
                }
              </button>
            </div>
          </label>
        }

        @if (view() === 'reset') {
          @if (resetCode()) {
            <p class="auth-code">Tu código es <strong>{{ resetCode() }}</strong>. Úsalo ahora; caduca en 30 minutos.</p>
          }
          <label class="auth-field">
            <span>{{ t('login.field.code') }}</span>
            <input name="code" [(ngModel)]="code" required placeholder="000000" inputmode="numeric" />
          </label>
          <label class="auth-field">
            <span>{{ t('login.field.newPassword') }}</span>
            <div class="auth-secret">
              <input
                name="password"
                [type]="showPassword() ? 'text' : 'password'"
                [(ngModel)]="password"
                autocomplete="new-password"
                required
                minlength="8"
              />
              <button
                type="button"
                class="auth-eye"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Ocultar clave' : 'Mostrar clave'"
                [attr.aria-pressed]="showPassword()"
              >
                @if (showPassword()) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z"/>
                    <circle cx="12" cy="12" r="2.6"/>
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12c2.4-3.2 5.5-4.8 9-4.8"/>
                    <path d="M21 12c-2.4 3.2-5.5 4.8-9 4.8"/>
                    <path d="M4 15.5c1.2.7 2.6 1.1 4 1.3"/>
                    <path d="M16 16.8c1.4-.2 2.8-.6 4-1.3"/>
                    <path d="M8 8.6c.6-.3 2.2-.8 4-.8 1.5 0 2.8.3 4 .8"/>
                  </svg>
                }
              </button>
            </div>
          </label>
        }

        @if (error()) {
          <p class="auth-error">{{ error() }}</p>
        }
        @if (notice()) {
          <p class="auth-notice">{{ notice() }}</p>
        }

        <button type="submit" class="auth-submit" [disabled]="busy()">
          {{ busy() ? t('login.busy') : action() }}
        </button>

        <div class="auth-links">
          @if (view() === 'login') {
            <button type="button" (click)="show('register')">{{ t('login.link.register') }}</button>
            <button type="button" (click)="show('forgot')">{{ t('login.link.forgot') }}</button>
          } @else if (view() === 'register') {
            <button type="button" (click)="show('login')">{{ t('login.link.login') }}</button>
          } @else if (view() === 'forgot') {
            <button type="button" (click)="show('login')">{{ t('login.link.back') }}</button>
            <button type="button" (click)="show('reset')">{{ t('login.link.code') }}</button>
          } @else {
            <button type="button" (click)="show('forgot')">{{ t('login.link.again') }}</button>
            <button type="button" (click)="show('login')">{{ t('login.link.back') }}</button>
          }
        </div>
      </form>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly prefs = inject(PrefsService);
  readonly view = signal<AuthView>('login');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly resetCode = signal('');
  readonly showPassword = signal(false);
  readonly showConfirm = signal(false);
  email = '';
  password = '';
  confirm = '';
  name = '';
  code = '';

  t(key: string): string {
    return this.prefs.t(key);
  }

  kicker(): string {
    return this.t(`login.kicker.${this.view()}`);
  }

  title(): string {
    return this.t(`login.title.${this.view()}`);
  }

  action(): string {
    return this.t(`login.action.${this.view()}`);
  }

  show(view: AuthView): void {
    this.view.set(view);
    this.error.set('');
    this.notice.set('');
    this.password = '';
    this.confirm = '';
    this.showPassword.set(false);
    this.showConfirm.set(false);
    if (view !== 'reset') this.resetCode.set('');
  }

  submit(event: Event): void {
    event.preventDefault();
    this.error.set('');
    this.notice.set('');
    const email = this.email.trim();
    if (!email) {
      this.error.set('Escribe tu correo.');
      return;
    }
    this.busy.set(true);
    const done = () => this.busy.set(false);
    const fail = (err: HttpErrorResponse) => {
      this.error.set(this.messageOf(err));
      done();
    };
    if (this.view() === 'login') {
      this.auth.login(email, this.password).subscribe({
        next: () => void this.router.navigateByUrl('/tablero'),
        error: fail,
      });
      return;
    }
    if (this.view() === 'register') {
      if (this.password !== this.confirm) {
        this.error.set('Las claves no coinciden.');
        done();
        return;
      }
      this.auth.register(email, this.password, this.name).subscribe({
        next: () => void this.router.navigateByUrl('/tablero'),
        error: fail,
      });
      return;
    }
    if (this.view() === 'forgot') {
      this.auth.forgotPassword(email).subscribe({
        next: (res) => {
          this.view.set('reset');
          this.password = '';
          this.notice.set(res.detail);
          this.resetCode.set(res.reset_code || '');
          done();
        },
        error: fail,
      });
      return;
    }
    this.auth.resetPassword(email, this.code, this.password).subscribe({
      next: (res) => {
        this.show('login');
        this.notice.set(res.detail);
        done();
      },
      error: fail,
    });
  }

  private messageOf(err: HttpErrorResponse): string {
    const detail = err.error?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    return 'No se pudo completar. Inténtalo otra vez.';
  }
}
