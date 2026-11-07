import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type pg from 'pg';
import { Clock } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Bookings');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Background sweeper: releases expired holds automatically. */
  onModuleInit() {
    if (process.env.DISABLE_SWEEPER === 'true') return;
    this.timer = setInterval(() => {
      this.releaseExpired().catch((e) => this.log.error(`sweep failed: ${e.message}`));
    }, Number(process.env.SWEEP_INTERVAL_MS ?? 5000));
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Marks expired holds as 'expired' and frees their seats (active=false).
   * If seatIds is given, only holds touching those seats are processed
   * (used lazily inside hold()). Rows are locked in id order so concurrent
   * callers cannot deadlock.
   * Returns the number of holds released.
   */
  async releaseExpired(
    client?: pg.PoolClient,
    seatIds?: number[],
  ): Promise<number> {
    const run = async (c: pg.PoolClient) => {
      const now = this.clock.now();
      const { rows } = await c.query<{ id: number }>(
        `SELECT b.id FROM bookings b
         WHERE b.status = 'held' AND b.hold_expires_at <= $1
           AND ($2::int[] IS NULL OR EXISTS (
                 SELECT 1 FROM booking_seats bs
                 WHERE bs.booking_id = b.id AND bs.seat_id = ANY($2::int[])))
         ORDER BY b.id FOR UPDATE`,
        [now, seatIds ?? null],
      );
      if (rows.length === 0) return 0;
      const ids = rows.map((r) => r.id);
      await c.query(
        `UPDATE bookings SET status = 'expired' WHERE id = ANY($1::int[])`,
        [ids],
      );
      await c.query(
        `UPDATE booking_seats SET active = FALSE WHERE booking_id = ANY($1::int[])`,
        [ids],
      );
      return ids.length;
    };
    if (client) return run(client);
    return this.db.tx(run);
  }

  /** Step 1 of booking: hold seats for the configured duration. */
  async hold(userId: number, eventId: number, seatIds: number[]) {
    const cfg = await this.settings.get();
    if (
      !Array.isArray(seatIds) ||
      seatIds.length === 0 ||
      !seatIds.every((n) => Number.isInteger(n))
    ) {
      throw new BadRequestException('seatIds must be a non-empty array of seat ids');
    }
    const unique = [...new Set(seatIds)].sort((a, b) => a - b);
    if (unique.length > cfg.maxSeatsPerBooking) {
      throw new BadRequestException(
        `You can book at most ${cfg.maxSeatsPerBooking} seats at a time`,
      );
    }
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + cfg.holdDurationSeconds * 1000);

    return this.db.tx(async (client) => {
      const ev = await client.query('SELECT event_date FROM events WHERE id = $1', [eventId]);
      if (!ev.rows[0]) throw new NotFoundException('Event not found');
      if (new Date(ev.rows[0].event_date) <= now) {
        throw new BadRequestException('This event has already taken place');
      }
      const found = await client.query(
        'SELECT id FROM seats WHERE event_id = $1 AND id = ANY($2::int[])',
        [eventId, unique],
      );
      if (found.rowCount !== unique.length) {
        throw new BadRequestException('One or more seats do not belong to this event');
      }

      // Free any lapsed holds on these seats so they can be claimed again.
      await this.releaseExpired(client, unique);

      const b = await client.query(
        `INSERT INTO bookings(event_id, user_id, status, hold_expires_at, created_at)
         VALUES ($1, $2, 'held', $3, $4) RETURNING id`,
        [eventId, userId, expiresAt, now],
      );
      const bookingId: number = b.rows[0].id;
      try {
        // THE GUARD: the partial unique index one_active_claim_per_seat makes
        // PostgreSQL reject this insert if any seat already has an active claim.
        await client.query(
          `INSERT INTO booking_seats(booking_id, seat_id)
           SELECT $1, unnest($2::int[])`,
          [bookingId, unique],
        );
      } catch (err: any) {
        if (err.code === '23505') {
          throw new ConflictException('One or more seats were just taken by someone else');
        }
        throw err;
      }
      return { bookingId, status: 'held', seatIds: unique, holdExpiresAt: expiresAt };
    });
  }

  /** Step 2: confirm a live hold. Atomic: succeeds only if still held and unexpired. */
  async confirm(userId: number, bookingId: number) {
    const now = this.clock.now();
    return this.db.tx(async (client) => {
      const upd = await client.query(
        `UPDATE bookings SET status = 'confirmed', confirmed_at = $3
         WHERE id = $1 AND user_id = $2 AND status = 'held' AND hold_expires_at > $3
         RETURNING id`,
        [bookingId, userId, now],
      );
      if (upd.rowCount === 1) return { bookingId, status: 'confirmed' };

      const cur = await client.query('SELECT user_id, status FROM bookings WHERE id = $1', [bookingId]);
      if (!cur.rows[0]) throw new NotFoundException('Booking not found');
      if (cur.rows[0].user_id !== userId) throw new ForbiddenException('Not your booking');
      if (cur.rows[0].status === 'held') {
        await this.releaseExpired(client);
        throw new GoneException('Your hold has expired. Please select seats again.');
      }
      throw new ConflictException(`Booking is already ${cur.rows[0].status}`);
    });
  }

  /** Cancel a held or confirmed booking; its seats become available again. */
  async cancel(user: { id: number; role: string }, bookingId: number) {
    const now = this.clock.now();
    return this.db.tx(async (client) => {
      const cur = await client.query(
        'SELECT user_id, status FROM bookings WHERE id = $1 FOR UPDATE',
        [bookingId],
      );
      if (!cur.rows[0]) throw new NotFoundException('Booking not found');
      if (cur.rows[0].user_id !== user.id && user.role !== 'organizer') {
        throw new ForbiddenException('Not your booking');
      }
      if (!['held', 'confirmed'].includes(cur.rows[0].status)) {
        throw new ConflictException(`Booking is already ${cur.rows[0].status}`);
      }
      await client.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`,
        [bookingId, now],
      );
      await client.query('UPDATE booking_seats SET active = FALSE WHERE booking_id = $1', [bookingId]);
      return { bookingId, status: 'cancelled' };
    });
  }

  /** Booking history for one attendee (newest first). */
  async history(userId: number) {
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `SELECT b.id, b.event_id AS "eventId", e.name AS "eventName", e.event_date AS "eventDate",
              e.venue, b.status, b.hold_expires_at AS "holdExpiresAt",
              b.created_at AS "createdAt", b.confirmed_at AS "confirmedAt", b.cancelled_at AS "cancelledAt",
              array_agg(s.row_label || s.seat_number ORDER BY s.row_label, s.seat_number) AS seats
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN booking_seats bs ON bs.booking_id = b.id
       JOIN seats s ON s.id = bs.seat_id
       WHERE b.user_id = $1
       GROUP BY b.id, e.id
       ORDER BY b.created_at DESC, b.id DESC`,
      [userId],
    );
    return rows.map((r) => ({
      ...r,
      // Report lapsed-but-unswept holds as expired.
      status: r.status === 'held' && new Date(r.holdExpiresAt) <= now ? 'expired' : r.status,
    }));
  }
}
