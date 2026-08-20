import { Routes } from '@angular/router';

import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
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
];
