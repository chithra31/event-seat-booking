import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Booking, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-bookings',
  imports: [DatePipe, RouterLink],
  template: `
    <h2>My bookings</h2>
    @if (error()) { <p class="error">{{ error() }}</p> }
    <table>
      <thead><tr><th>Event</th><th>When</th><th>Seats</th><th>Status</th><th></th></tr></thead>
      <tbody>
        @for (b of bookings(); track b.id) {
          <tr>
            <td><a [routerLink]="['/events', b.eventId]">{{ b.eventName }}</a><br /><small>{{ b.venue }}</small></td>
            <td>{{ b.eventDate | date: 'medium' }}</td>
            <td>{{ b.seats.join(', ') }}</td>
            <td><span class="badge" [class]="'badge ' + b.status">{{ b.status }}</span></td>
            <td>
              @if (b.status === 'confirmed' || b.status === 'held') {
                <button (click)="cancel(b)">Cancel</button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="5">No bookings yet.</td></tr>
        }
      </tbody>
    </table>
  `,
})
export class BookingsPage {
  private api = inject(ApiService);
  bookings = signal<Booking[]>([]);
  error = signal('');
  constructor() {
    this.load();
  }
  load() {
    this.api.myBookings().subscribe((b) => this.bookings.set(b));
  }
  cancel(b: Booking) {
    if (!confirm(`Cancel booking for ${b.seats.join(', ')}?`)) return;
    this.api.cancel(b.id).subscribe({ next: () => this.load(), error: (e) => this.error.set(errorMessage(e)) });
  }
}
