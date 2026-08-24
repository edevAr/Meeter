import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

import { API_BASE } from './config';
import { AuthSession, AuthUser } from './auth.models';

const TOKEN_KEY = 'meeter.session';
const USER_KEY = 'meeter.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly user = signal<AuthUser | null>(AuthService.readUser());

  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  isLoggedIn(): boolean {
    return Boolean(this.token());
  }

  register(email: string, password: string, name: string): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${API_BASE}/api/auth/register`, { email, password, name })
      .pipe(tap((session) => this.keep(session)));
  }

  login(email: string, password: string): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${API_BASE}/api/auth/login`, { email, password })
      .pipe(tap((session) => this.keep(session)));
  }

  forgotPassword(email: string): Observable<{ detail: string; reset_code: string | null }> {
    return this.http.post<{ detail: string; reset_code: string | null }>(`${API_BASE}/api/auth/forgot-password`, { email });
  }

  resetPassword(email: string, code: string, password: string): Observable<{ detail: string }> {
    return this.http.post<{ detail: string }>(`${API_BASE}/api/auth/reset-password`, { email, code, password });
  }

  logout(): void {
    const token = this.token();
    if (token) {
      this.http.post(`${API_BASE}/api/auth/logout`, {}).subscribe({ error: () => undefined });
    }
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  clear(): void {
    this.user.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  }

  private keep(session: AuthSession): void {
    this.user.set(session.user);
    try {
      localStorage.setItem(TOKEN_KEY, session.token);
      localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    } catch {
      /* ignore */
    }
  }

  private static readUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }
}
