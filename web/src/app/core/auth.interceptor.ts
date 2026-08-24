import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const headers = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(headers).pipe(
    catchError((error: HttpErrorResponse) => {
      const isAuthCall = req.url.includes('/api/auth/');
      if (error.status === 401 && !isAuthCall) {
        auth.clear();
        void router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};
