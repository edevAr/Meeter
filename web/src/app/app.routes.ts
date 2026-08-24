import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'tablero',
      },
      {
        path: 'tablero',
        loadComponent: () => import('./features/board/board.page').then((m) => m.BoardPage),
      },
      {
        path: 'agenda',
        loadComponent: () => import('./features/agenda/agenda.page').then((m) => m.AgendaPage),
      },
      {
        path: 'captura',
        loadComponent: () => import('./features/capture/capture.page').then((m) => m.CapturePage),
      },
      {
        path: 'llamadas',
        loadComponent: () => import('./features/library/library.page').then((m) => m.LibraryPage),
      },
      {
        path: 'llamadas/:id',
        loadComponent: () =>
          import('./features/library/recording-detail.page').then((m) => m.RecordingDetailPage),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
