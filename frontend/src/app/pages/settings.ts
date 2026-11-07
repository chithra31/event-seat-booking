import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <div class="card narrow">
      <h2>Booking configuration</h2>
      <form (ngSubmit)="save()">
        <label>Seat hold duration (seconds)
          <input name="hold" type="number" min="1" [(ngModel)]="holdDurationSeconds" required />
        </label>
        <label>Maximum seats per booking
          <input name="max" type="number" min="1" max="50" [(ngModel)]="maxSeatsPerBooking" required />
        </label>
        @if (error()) { <p class="error">{{ error() }}</p> }
        @if (saved()) { <p class="ok">Saved. New values apply to the next booking.</p> }
        <button class="primary" type="submit">Save</button>
      </form>
    </div>
  `,
})
export class SettingsPage {
  private api = inject(ApiService);
  holdDurationSeconds = 300;
  maxSeatsPerBooking = 4;
  error = signal('');
  saved = signal(false);

  constructor() {
    this.api.settings().subscribe((s) => {
      this.holdDurationSeconds = s.holdDurationSeconds;
      this.maxSeatsPerBooking = s.maxSeatsPerBooking;
    });
  }

  save() {
    this.error.set('');
    this.saved.set(false);
    this.api
      .updateSettings({
        holdDurationSeconds: Number(this.holdDurationSeconds),
        maxSeatsPerBooking: Number(this.maxSeatsPerBooking),
      })
      .subscribe({ next: () => this.saved.set(true), error: (e) => this.error.set(errorMessage(e)) });
  }
}
