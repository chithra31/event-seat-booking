import { Routes } from '@angular/router';
import { authGuard, organizerGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  { path: 'events', canActivate: [authGuard], loadComponent: () => import('./pages/events').then((m) => m.EventsPage) },
  { path: 'events/:id', canActivate: [authGuard], loadComponent: () => import('./pages/event-detail').then((m) => m.EventDetailPage) },
  { path: 'bookings', canActivate: [authGuard], loadComponent: () => import('./pages/bookings').then((m) => m.BookingsPage) },
  { path: 'admin/new-event', canActivate: [authGuard, organizerGuard], loadComponent: () => import('./pages/event-form').then((m) => m.EventFormPage) },
  { path: 'admin/settings', canActivate: [authGuard, organizerGuard], loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
  { path: '', pathMatch: 'full', redirectTo: 'events' },
  { path: '**', redirectTo: 'events' },
];
