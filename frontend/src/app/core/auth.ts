import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from './api.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(ApiService).token;
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

export const authGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  return api.token ? true : inject(Router).parseUrl('/login');
};

/** UX only - the server enforces roles independently. */
export const organizerGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  return api.isOrganizer() ? true : inject(Router).parseUrl('/events');
};
