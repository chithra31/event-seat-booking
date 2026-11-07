import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';

export const API_URL = 'http://localhost:3000';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'attendee' | 'organizer';
}
export interface EventSummary {
  id: number;
  name: string;
  description: string;
  date: string;
  venue: string;
  rows: number;
  seatsPerRow: number;
  totalSeats: number;
  bookedSeats: number;
  heldSeats: number;
}
export interface Seat {
  id: number;
  row: string;
  number: number;
  status: 'available' | 'held' | 'booked';
  mine: boolean;
  bookingId: number | null;
  holdExpiresAt: string | null;
}
export interface SeatMap {
  event: EventSummary;
  serverTime: string;
  seats: Seat[];
}
export interface Booking {
  id: number;
  eventId: number;
  eventName: string;
  eventDate: string;
  venue: string;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired';
  holdExpiresAt: string;
  seats: string[];
  createdAt: string;
}
export interface Settings {
  holdDurationSeconds: number;
  maxSeatsPerBooking: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<User | null>(JSON.parse(localStorage.getItem('user') ?? 'null'));
  readonly isOrganizer = computed(() => this.user()?.role === 'organizer');
  get token(): string | null {
    return localStorage.getItem('token');
  }

  private store(res: { token: string; user: User }) {
    localStorage.setItem('token', res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
    this.user.set(res.user);
  }

  login(email: string, password: string) {
    return this.http.post<{ token: string; user: User }>(`${API_URL}/auth/login`, { email, password }).pipe(tap((r) => this.store(r)));
  }
  register(email: string, name: string, password: string) {
    return this.http.post<{ token: string; user: User }>(`${API_URL}/auth/register`, { email, name, password }).pipe(tap((r) => this.store(r)));
  }
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.user.set(null);
    this.router.navigate(['/login']);
  }

  events() {
    return this.http.get<EventSummary[]>(`${API_URL}/events`);
  }
  seatMap(eventId: number) {
    return this.http.get<SeatMap>(`${API_URL}/events/${eventId}/seats`);
  }
  createEvent(body: object) {
    return this.http.post<{ id: number }>(`${API_URL}/events`, body);
  }
  draftDescription(body: object) {
    return this.http.post<{ description: string; source: string }>(`${API_URL}/events/draft-description`, body);
  }
  hold(eventId: number, seatIds: number[]) {
    return this.http.post<{ bookingId: number; holdExpiresAt: string }>(`${API_URL}/events/${eventId}/holds`, { seatIds });
  }
  confirm(bookingId: number) {
    return this.http.post(`${API_URL}/bookings/${bookingId}/confirm`, {});
  }
  cancel(bookingId: number) {
    return this.http.delete(`${API_URL}/bookings/${bookingId}`);
  }
  myBookings() {
    return this.http.get<Booking[]>(`${API_URL}/bookings/mine`);
  }
  settings() {
    return this.http.get<Settings>(`${API_URL}/settings`);
  }
  updateSettings(s: Settings) {
    return this.http.put<Settings>(`${API_URL}/settings`, s);
  }
}

export function errorMessage(e: any): string {
  const m = e?.error?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? e?.message ?? 'Something went wrong');
}
