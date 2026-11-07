import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-event-form',
  imports: [FormsModule],
  template: `
    <div class="card narrow">
      <h2>New event</h2>
      <form (ngSubmit)="submit()">
        <label>Name <input name="name" [(ngModel)]="name" required /></label>
        <label>Date &amp; time <input name="date" type="datetime-local" [(ngModel)]="date" required /></label>
        <label>Venue <input name="venue" [(ngModel)]="venue" required /></label>
        <label>Description <textarea name="description" rows="3" [(ngModel)]="description"></textarea></label>
        <button type="button" (click)="draft()" [disabled]="!name || drafting()">
          {{ drafting() ? 'Drafting…' : '✨ Draft description with AI' }}
        </button>
        <div class="two">
          <label>Rows (1–26) <input name="rows" type="number" min="1" max="26" [(ngModel)]="rows" required /></label>
          <label>Seats per row (1–50) <input name="spr" type="number" min="1" max="50" [(ngModel)]="seatsPerRow" required /></label>
        </div>
        <p class="hint">Total seats: {{ (rows || 0) * (seatsPerRow || 0) }}</p>
        @if (error()) { <p class="error">{{ error() }}</p> }
        <button class="primary" type="submit">Create event</button>
      </form>
    </div>
  `,
})
export class EventFormPage {
  private api = inject(ApiService);
  private router = inject(Router);
  name = '';
  date = '';
  venue = '';
  description = '';
  rows = 10;
  seatsPerRow = 12;
  error = signal('');
  drafting = signal(false);

  draft() {
    this.error.set('');
    this.drafting.set(true);
    this.api.draftDescription({ name: this.name, venue: this.venue, date: this.date ? new Date(this.date).toISOString() : undefined, notes: this.description }).subscribe({
      next: (r) => { this.description = r.description; this.drafting.set(false); },
      error: (e) => { this.error.set(errorMessage(e)); this.drafting.set(false); },
    });
  }

  submit() {
    this.error.set('');
    this.api
      .createEvent({
        name: this.name,
        date: this.date ? new Date(this.date).toISOString() : '',
        venue: this.venue,
        description: this.description,
        rows: Number(this.rows),
        seatsPerRow: Number(this.seatsPerRow),
      })
      .subscribe({
        next: (r) => this.router.navigate(['/events', r.id]),
        error: (e) => this.error.set(errorMessage(e)),
      });
  }
}
