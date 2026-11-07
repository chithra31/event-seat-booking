import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Seat, SeatMap, errorMessage } from '../core/api.service';

@Component({
  selector: 'app-event-detail',
  imports: [DatePipe],
  template: `
    @if (map(); as m) {
      <h2>{{ m.event.name }}</h2>
      <p>{{ m.event.date | date: 'full' }} · 📍 {{ m.event.venue }}</p>
      <p class="desc">{{ m.event.description }}</p>

      <div class="legend">
        <span class="seat available"></span> Available
        <span class="seat selected"></span> Selected
        <span class="seat held"></span> Held
        <span class="seat booked"></span> Booked
        <span class="seat mine"></span> Yours
      </div>
      <div class="stage">STAGE</div>

      <div class="seatmap">
        @for (row of rows(); track row.label) {
          <div class="seatrow">
            <span class="rowlabel">{{ row.label }}</span>
            @for (s of row.seats; track s.id) {
              <button
                class="seat"
                [class]="'seat ' + cls(s)"
                [disabled]="s.status !== 'available' || !!activeHold()"
                [title]="s.row + s.number + ' – ' + s.status"
                (click)="toggle(s)"
              >{{ s.number }}</button>
            }
          </div>
        }
      </div>

      @if (error()) { <p class="error">{{ error() }}</p> }

      @if (activeHold(); as h) {
        <div class="card hold">
          <h3>Seats held for you</h3>
          <p>{{ h.labels.join(', ') }} — confirm within <strong class="timer">{{ remaining() }}</strong></p>
          <button class="primary" (click)="confirm(h.bookingId)">Confirm booking</button>
          <button (click)="release(h.bookingId)">Release</button>
        </div>
      } @else {
        <div class="card hold">
          <p>
            Selected: <strong>{{ selectedLabels().join(', ') || 'none' }}</strong>
            @if (maxSeats()) { <small>(max {{ maxSeats() }})</small> }
          </p>
          <button class="primary" [disabled]="selected().size === 0" (click)="hold()">Hold selected seats</button>
        </div>
      }
    } @else {
      <p>Loading…</p>
    }
  `,
})
export class EventDetailPage implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private id = Number(this.route.snapshot.paramMap.get('id'));
  private poll?: ReturnType<typeof setInterval>;
  private tick?: ReturnType<typeof setInterval>;
  private skew = 0; // serverTime - clientTime, so the countdown follows the server clock

  map = signal<SeatMap | null>(null);
  selected = signal<Set<number>>(new Set());
  error = signal('');
  maxSeats = signal(0);
  now = signal(Date.now());

  rows = computed(() => {
    const groups = new Map<string, Seat[]>();
    for (const s of this.map()?.seats ?? []) {
      if (!groups.has(s.row)) groups.set(s.row, []);
      groups.get(s.row)!.push(s);
    }
    return [...groups].map(([label, seats]) => ({ label, seats }));
  });

  selectedLabels = computed(() =>
    (this.map()?.seats ?? []).filter((s) => this.selected().has(s.id)).map((s) => s.row + s.number),
  );

  /** My live hold, derived from the seat map so it survives page reloads. */
  activeHold = computed(() => {
    const mine = (this.map()?.seats ?? []).filter((s) => s.mine && s.status === 'held');
    if (!mine.length) return null;
    return {
      bookingId: mine[0].bookingId!,
      expires: new Date(mine[0].holdExpiresAt!).getTime(),
      labels: mine.map((s) => s.row + s.number),
    };
  });

  remaining = computed(() => {
    const h = this.activeHold();
    if (!h) return '';
    const secs = Math.max(0, Math.floor((h.expires - (this.now() + this.skew)) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  });

  ngOnInit() {
    this.api.settings().subscribe((s) => this.maxSeats.set(s.maxSeatsPerBooking));
    this.refresh();
    this.poll = setInterval(() => this.refresh(), 3000); // live updates from other attendees
    this.tick = setInterval(() => this.now.set(Date.now()), 1000);
  }
  ngOnDestroy() {
    clearInterval(this.poll);
    clearInterval(this.tick);
  }

  refresh() {
    this.api.seatMap(this.id).subscribe({
      next: (m) => {
        this.skew = new Date(m.serverTime).getTime() - Date.now();
        this.map.set(m);
        // drop selections that someone else just took
        const free = new Set(m.seats.filter((s) => s.status === 'available').map((s) => s.id));
        this.selected.update((sel) => new Set([...sel].filter((id) => free.has(id))));
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  cls(s: Seat) {
    if (this.selected().has(s.id)) return 'selected';
    if (s.mine && s.status !== 'available') return 'mine';
    return s.status;
  }

  toggle(s: Seat) {
    this.error.set('');
    const sel = new Set(this.selected());
    if (sel.has(s.id)) sel.delete(s.id);
    else {
      if (this.maxSeats() && sel.size >= this.maxSeats()) {
        this.error.set(`You can select at most ${this.maxSeats()} seats.`);
        return;
      }
      sel.add(s.id);
    }
    this.selected.set(sel);
  }

  hold() {
    this.error.set('');
    this.api.hold(this.id, [...this.selected()]).subscribe({
      next: () => {
        this.selected.set(new Set());
        this.refresh();
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.refresh();
      },
    });
  }

  confirm(bookingId: number) {
    this.api.confirm(bookingId).subscribe({
      next: () => this.router.navigate(['/bookings']),
      error: (e) => {
        this.error.set(errorMessage(e));
        this.refresh();
      },
    });
  }

  release(bookingId: number) {
    this.api.cancel(bookingId).subscribe(() => this.refresh());
  }
}
