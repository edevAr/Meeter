import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

const SIDEBAR_KEY = 'meeter.sidebar-collapsed';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell-frame" [class.is-collapsed]="collapsed()">
      <aside class="shell-aside" [class.is-collapsed]="collapsed()">
        <div class="shell-brand">
          <p class="shell-kicker">Meeter</p>
          @if (!collapsed()) {
            <h1 class="mt-1.5 text-xl font-extrabold tracking-tight">Agenda digital</h1>
            <p class="shell-lead">Notas, pendientes y llamadas con transcripción en vivo.</p>
          }
        </div>
        <nav class="shell-nav">
          @for (item of links; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="is-on"
              [title]="item.label"
              class="shell-link"
            >
              <span class="shell-dot" [class]="item.dot"></span>
              <span class="shell-link-label">{{ item.label }}</span>
            </a>
          }
        </nav>
        <button
          type="button"
          class="shell-toggle"
          [attr.aria-expanded]="!collapsed()"
          [attr.aria-label]="collapsed() ? 'Mostrar menú' : 'Ocultar menú'"
          [title]="collapsed() ? 'Mostrar menú' : 'Ocultar menú'"
          (click)="toggleSidebar()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M14 6l-6 6 6 6"/>
          </svg>
        </button>
      </aside>
      <main class="min-h-screen min-w-0">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly collapsed = signal(ShellComponent.readCollapsed());
  readonly links = [
    { path: '/tablero', label: 'Tablero', dot: 'bg-sun' },
    { path: '/agenda', label: 'Pendientes', dot: 'bg-accent' },
    { path: '/captura', label: 'Grabar llamada', dot: 'bg-rec' },
    { path: '/llamadas', label: 'Llamadas', dot: 'bg-mint' },
  ];

  toggleSidebar(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  private static readCollapsed(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  }
}
