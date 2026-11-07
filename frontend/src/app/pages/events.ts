import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, EventSummary } from '../core/api.service';

@Component({
  selector: 'app-events',
  imports: [RouterLink, DatePipe],
  template: `
    <h2>Upcoming events</h2>
    <div class="grid">
      @for (e of events(); track e.id) {
        <a class="card event" [routerLink]="['/events', e.id]">
          <h3>{{ e.name }}</h3>
          <p>{{ e.date | date: 'fullDate' }} · {{ e.date | date: 'shortTime' }}</p>
          <p>📍 {{ e.venue }}</p>
          <p class="desc">{{ e.description }}</p>
          <p><strong>{{ e.totalSeats - e.bookedSeats - e.heldSeats }}</strong> of {{ e.totalSeats }} seats available</p>
        </a>
      } @empty {
        <p>No events yet.</p>
      }
    </div>
  `,
})
export class EventsPage {
  events = signal<EventSummary[]>([]);
  constructor() {
    inject(ApiService).events().subscribe((e) => this.events.set(e));
  }
}
