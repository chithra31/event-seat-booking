import { AuthService } from '../src/auth/auth.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { Clock } from '../src/common/clock.js';
import { DbService } from '../src/db/db.service.js';
import { EventsService } from '../src/events/events.service.js';
import { SettingsService } from '../src/settings/settings.service.js';

/** A clock that only moves when the test says so. */
export class FixedClock extends Clock {
  constructor(private current: Date = new Date('2030-01-01T12:00:00Z')) {
    super();
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const DAY = 24 * 3600 * 1000;

export interface Ctx {
  db: DbService;
  clock: FixedClock;
  auth: AuthService;
  settings: SettingsService;
  events: EventsService;
  bookings: BookingsService;
}

/** Builds the services by hand (no HTTP) against the test database. */
export async function makeCtx(): Promise<Ctx> {
  const db = new DbService();
  await db.applySchema();
  const clock = new FixedClock();
  const settings = new SettingsService(db);
  return {
    db,
    clock,
    settings,
    auth: new AuthService(db),
    events: new EventsService(db, clock),
    bookings: new BookingsService(db, clock, settings),
  };
}

/** Wipes all data and restores default settings. */
export async function resetDb(db: DbService) {
  await db.query(
    'TRUNCATE booking_seats, bookings, seats, events, users, settings RESTART IDENTITY CASCADE',
  );
  await db.applySchema(); // re-inserts default settings
}

export async function makeUsers(ctx: Ctx, count = 3) {
  const organizer = await ctx.auth.createUser('org@test.dev', 'Org', 'secret1', 'organizer');
  const attendees = [];
  for (let i = 1; i <= count; i++) {
    attendees.push(await ctx.auth.createUser(`a${i}@test.dev`, `Attendee ${i}`, 'secret1', 'attendee'));
  }
  return { organizer, attendees };
}

export async function makeEvent(ctx: Ctx, organizerId: number, rows = 5, seatsPerRow = 10) {
  const date = new Date(ctx.clock.now().getTime() + 30 * DAY).toISOString();
  const { id } = await ctx.events.create(organizerId, {
    name: 'Test Event',
    date,
    venue: 'Test Hall',
    rows,
    seatsPerRow,
  });
  const { rows: seats } = await ctx.db.query<{ id: number }>(
    'SELECT id FROM seats WHERE event_id = $1 ORDER BY row_label, seat_number',
    [id],
  );
  return { eventId: id, seatIds: seats.map((s) => s.id) };
}
