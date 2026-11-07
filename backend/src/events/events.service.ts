import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { Clock } from '../common/clock.js';
import { DbService } from '../db/db.service.js';

export interface EventInput {
  name: string;
  description?: string;
  date: string;
  venue: string;
  rows: number;
  seatsPerRow: number;
}

export function rowLabel(index: number): string {
  // 0 -> A ... 25 -> Z
  return String.fromCharCode(65 + index);
}

@Injectable()
export class EventsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private validate(input: Partial<EventInput>, requireAll: boolean) {
    const out: Partial<EventInput> & { dateObj?: Date } = {};
    const has = (k: keyof EventInput) => input[k] !== undefined;

    if (requireAll || has('name')) {
      if (typeof input.name !== 'string' || !input.name.trim()) {
        throw new BadRequestException('Event name is required');
      }
      out.name = input.name.trim();
    }
    if (requireAll || has('venue')) {
      if (typeof input.venue !== 'string' || !input.venue.trim()) {
        throw new BadRequestException('Venue is required');
      }
      out.venue = input.venue.trim();
    }
    if (has('description')) out.description = String(input.description ?? '');
    if (requireAll || has('date')) {
      const d = new Date(input.date as string);
      if (!input.date || Number.isNaN(d.getTime())) {
        throw new BadRequestException('A valid event date is required');
      }
      if (d.getTime() <= this.clock.now().getTime()) {
        throw new BadRequestException('Event date must be in the future');
      }
      out.dateObj = d;
    }
    if (requireAll || has('rows')) {
      const rows = input.rows;
      if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 26) {
        throw new BadRequestException('rows must be an integer between 1 and 26 (grid cannot be empty)');
      }
      out.rows = rows;
    }
    if (requireAll || has('seatsPerRow')) {
      const seatsPerRow = input.seatsPerRow;
      if (!Number.isInteger(seatsPerRow) || (seatsPerRow as number) < 1 || (seatsPerRow as number) > 50) {
        throw new BadRequestException('seatsPerRow must be an integer between 1 and 50 (grid cannot be empty)');
      }
      out.seatsPerRow = seatsPerRow;
    }
    return out;
  }

  private async insertSeats(
    client: pg.PoolClient,
    eventId: number,
    rows: number,
    seatsPerRow: number,
  ) {
    const labels: string[] = [];
    const numbers: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let n = 1; n <= seatsPerRow; n++) {
        labels.push(rowLabel(r));
        numbers.push(n);
      }
    }
    await client.query(
      `INSERT INTO seats(event_id, row_label, seat_number)
       SELECT $1, l, n FROM unnest($2::text[], $3::int[]) AS t(l, n)`,
      [eventId, labels, numbers],
    );
  }

  async create(userId: number, input: EventInput) {
    const v = this.validate(input, true);
    return this.db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO events(name, description, event_date, venue, row_count, seats_per_row, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [v.name, v.description ?? '', v.dateObj, v.venue, v.rows, v.seatsPerRow, userId],
      );
      await this.insertSeats(client, rows[0].id, v.rows!, v.seatsPerRow!);
      return { id: rows[0].id as number };
    });
  }

  /** Updates details; changing the grid (seating) regenerates seats and is only allowed with no active bookings. */
  async update(eventId: number, input: Partial<EventInput>) {
    const v = this.validate(input, false);
    await this.db.tx(async (client) => {
      const cur = await client.query(
        'SELECT * FROM events WHERE id = $1 FOR UPDATE',
        [eventId],
      );
      if (!cur.rows[0]) throw new NotFoundException('Event not found');

      const gridChange =
        (v.rows !== undefined && v.rows !== cur.rows[0].row_count) ||
        (v.seatsPerRow !== undefined && v.seatsPerRow !== cur.rows[0].seats_per_row);
      if (gridChange) {
        const { rows: active } = await client.query(
          `SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
           JOIN seats s ON s.id = bs.seat_id
           WHERE s.event_id = $1 AND bs.active LIMIT 1`,
          [eventId],
        );
        if (active.length) {
          throw new ConflictException('Cannot change seating while seats are held or booked');
        }
        await client.query('DELETE FROM seats WHERE event_id = $1', [eventId]);
        await this.insertSeats(
          client,
          eventId,
          v.rows ?? cur.rows[0].row_count,
          v.seatsPerRow ?? cur.rows[0].seats_per_row,
        );
      }
      await client.query(
        `UPDATE events SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           event_date = COALESCE($4, event_date),
           venue = COALESCE($5, venue),
           row_count = COALESCE($6, row_count),
           seats_per_row = COALESCE($7, seats_per_row)
         WHERE id = $1`,
        [eventId, v.name ?? null, v.description ?? null, v.dateObj ?? null, v.venue ?? null, v.rows ?? null, v.seatsPerRow ?? null],
      );
    });
    return this.get(eventId);
  }

  async list() {
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `SELECT e.id, e.name, e.description, e.event_date AS "date", e.venue,
              e.row_count AS rows, e.seats_per_row AS "seatsPerRow",
              (e.row_count * e.seats_per_row) AS "totalSeats",
              COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS "bookedSeats",
              COUNT(*) FILTER (WHERE b.status = 'held' AND b.hold_expires_at > $1)::int AS "heldSeats"
       FROM events e
       LEFT JOIN seats s ON s.event_id = e.id
       LEFT JOIN booking_seats bs ON bs.seat_id = s.id AND bs.active
       LEFT JOIN bookings b ON b.id = bs.booking_id
       GROUP BY e.id ORDER BY e.event_date`,
      [now],
    );
    return rows;
  }

  async get(eventId: number) {
    const { rows } = await this.db.query(
      `SELECT id, name, description, event_date AS "date", venue,
              row_count AS rows, seats_per_row AS "seatsPerRow"
       FROM events WHERE id = $1`,
      [eventId],
    );
    if (!rows[0]) throw new NotFoundException('Event not found');
    return rows[0];
  }

  /**
   * Seat map: available | held | booked. An expired hold is reported as
   * available even before the sweeper has physically released it.
   */
  async seatMap(eventId: number, userId: number) {
    const event = await this.get(eventId);
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `SELECT s.id, s.row_label AS "row", s.seat_number AS "number",
              b.id AS "bookingId", b.status, b.hold_expires_at AS "holdExpiresAt", b.user_id AS "userId"
       FROM seats s
       LEFT JOIN booking_seats bs ON bs.seat_id = s.id AND bs.active
       LEFT JOIN bookings b ON b.id = bs.booking_id
       WHERE s.event_id = $1
       ORDER BY s.row_label, s.seat_number`,
      [eventId],
    );
    const seats = rows.map((r) => {
      let status: 'available' | 'held' | 'booked' = 'available';
      if (r.status === 'confirmed') status = 'booked';
      else if (r.status === 'held' && new Date(r.holdExpiresAt) > now) status = 'held';
      const mine = status !== 'available' && r.userId === userId;
      return {
        id: r.id,
        row: r.row,
        number: r.number,
        status,
        mine,
        bookingId: mine ? r.bookingId : null,
        holdExpiresAt: status === 'held' && mine ? r.holdExpiresAt : null,
      };
    });
    return { event, serverTime: now, seats };
  }
}
