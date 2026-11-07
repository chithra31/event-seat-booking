import 'dotenv/config';
import { AuthService } from './auth/auth.service.js';
import { BookingsService } from './bookings/bookings.service.js';
import { SystemClock } from './common/clock.js';
import { DbService } from './db/db.service.js';
import { EventsService } from './events/events.service.js';
import { SettingsService } from './settings/settings.service.js';

/**
 * Seed data: 1 organizer, 10 attendees, two events (120 and 60 seats)
 * and 30 confirmed sample bookings. Destructive: resets all tables.
 */
async function main() {
  const db = new DbService();
  await db.applySchema();
  await db.query(
    'TRUNCATE booking_seats, bookings, seats, events, users, settings RESTART IDENTITY CASCADE',
  );
  await db.applySchema();

  const clock = new SystemClock();
  const settings = new SettingsService(db);
  const auth = new AuthService(db);
  const events = new EventsService(db, clock);
  const bookings = new BookingsService(db, clock, settings);

  const organizer = await auth.createUser('organizer@example.com', 'Olivia Organizer', 'password123', 'organizer');
  const attendees = [];
  for (let i = 1; i <= 10; i++) {
    attendees.push(
      await auth.createUser(`attendee${i}@example.com`, `Attendee ${i}`, 'password123', 'attendee'),
    );
  }

  const day = 24 * 3600 * 1000;
  const big = await events.create(organizer.id, {
    name: 'Summer Rock Festival',
    description: 'An open-air night of live rock with three headline bands.',
    date: new Date(Date.now() + 30 * day).toISOString(),
    venue: 'Riverside Arena',
    rows: 10,
    seatsPerRow: 12,
  });
  const small = await events.create(organizer.id, {
    name: 'Jazz Evening',
    description: 'An intimate evening of live jazz.',
    date: new Date(Date.now() + 14 * day).toISOString(),
    venue: 'Blue Note Hall',
    rows: 6,
    seatsPerRow: 10,
  });

  // 30 sample bookings of 1-2 seats, spread across both events and all attendees.
  const seatsOf = async (eventId: number) =>
    (await db.query<{ id: number }>('SELECT id FROM seats WHERE event_id = $1 ORDER BY row_label, seat_number', [eventId])).rows.map((r) => r.id);
  const pools = [
    { eventId: big.id, seats: await seatsOf(big.id) },
    { eventId: small.id, seats: await seatsOf(small.id) },
  ];
  const cursor = [0, 0];
  for (let i = 0; i < 30; i++) {
    const p = i % 2;
    const n = 1 + (i % 2);
    const ids = pools[p].seats.slice(cursor[p], cursor[p] + n);
    cursor[p] += n + 1; // leave a gap so the map looks realistic
    const user = attendees[i % attendees.length];
    const h = await bookings.hold(user.id, pools[p].eventId, ids);
    await bookings.confirm(user.id, h.bookingId);
  }

  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM bookings WHERE status='confirmed') AS bookings`,
  );
  console.log(`Seeded ${rows[0].events} events and ${rows[0].bookings} bookings.`);
  console.log('Organizer: organizer@example.com / password123');
  console.log('Attendees: attendee1@example.com ... attendee10@example.com / password123');
  await db.onModuleDestroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
