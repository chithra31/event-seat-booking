import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Ctx, makeCtx, makeEvent, makeUsers, resetDb } from './helpers.js';

let ctx: Ctx;
let organizer: { id: number };
let attendees: { id: number }[];
let eventId: number;
let seatIds: number[];

beforeEach(async () => {
  ctx ??= await makeCtx();
  await resetDb(ctx.db);
  ({ organizer, attendees } = await makeUsers(ctx, 12));
  ({ eventId, seatIds } = await makeEvent(ctx, organizer.id));
});

afterAll(async () => {
  await ctx?.db.onModuleDestroy();
});

const seatStatus = async (id: number) =>
  (await ctx.events.seatMap(eventId, attendees[0].id)).seats.find((s) => s.id === id)!.status;

describe('double-booking prevention', () => {
  it('two simultaneous holds on the same seat: exactly one succeeds', async () => {
    const results = await Promise.allSettled([
      ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]),
      ctx.bookings.hold(attendees[1].id, eventId, [seatIds[0]]),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ConflictException);
  });

  it('is reliable: 10 attendees race for a seat, 20 rounds, never a double booking', async () => {
    for (let round = 0; round < 20; round++) {
      const seat = seatIds[round];
      const results = await Promise.allSettled(
        attendees.slice(0, 10).map((a) => ctx.bookings.hold(a.id, eventId, [seat])),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
    const { rows } = await ctx.db.query(
      'SELECT seat_id FROM booking_seats WHERE active GROUP BY seat_id HAVING count(*) > 1',
    );
    expect(rows).toHaveLength(0);
  });

  it('a conflicting multi-seat hold is all-or-nothing (no partial hold)', async () => {
    await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[1]]);
    await expect(
      ctx.bookings.hold(attendees[1].id, eventId, [seatIds[0], seatIds[1], seatIds[2]]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await seatStatus(seatIds[0])).toBe('available');
    expect(await seatStatus(seatIds[2])).toBe('available');
  });

  it('the database itself rejects a second active claim (bypassing the API)', async () => {
    await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    const other = await ctx.db.query(
      `INSERT INTO bookings(event_id,user_id,status,hold_expires_at,created_at)
       VALUES ($1,$2,'held',now() + interval '5 minutes',now()) RETURNING id`,
      [eventId, attendees[1].id],
    );
    await expect(
      ctx.db.query('INSERT INTO booking_seats(booking_id, seat_id) VALUES ($1,$2)', [
        other.rows[0].id,
        seatIds[0],
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('holds, expiry and confirmation (fixed clock)', () => {
  it('holds seats for the default 300s and shows them as held', async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0], seatIds[1]]);
    expect(new Date(h.holdExpiresAt).getTime() - ctx.clock.now().getTime()).toBe(300_000);
    expect(await seatStatus(seatIds[0])).toBe('held');
  });

  it('releases an expired hold exactly on time', async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);

    ctx.clock.advance(299_999);
    expect(await ctx.bookings.releaseExpired()).toBe(0);
    expect(await seatStatus(seatIds[0])).toBe('held');

    ctx.clock.advance(1); // exactly 300s
    expect(await ctx.bookings.releaseExpired()).toBe(1);
    expect(await seatStatus(seatIds[0])).toBe('available');
    const { rows } = await ctx.db.query('SELECT status FROM bookings WHERE id = $1', [h.bookingId]);
    expect(rows[0].status).toBe('expired');
  });

  it('another attendee can take a seat whose hold lapsed, even before the sweeper runs', async () => {
    await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    ctx.clock.advance(301_000);
    const h2 = await ctx.bookings.hold(attendees[1].id, eventId, [seatIds[0]]);
    expect(h2.status).toBe('held');
  });

  it('confirming an expired hold fails', async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    ctx.clock.advance(301_000);
    await expect(ctx.bookings.confirm(attendees[0].id, h.bookingId)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('confirming a live hold books the seats permanently', async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    ctx.clock.advance(60_000);
    await ctx.bookings.confirm(attendees[0].id, h.bookingId);
    ctx.clock.advance(10 * 60_000); // booked seats never expire
    await ctx.bookings.releaseExpired();
    expect(await seatStatus(seatIds[0])).toBe('booked');
  });

  it("cannot confirm someone else's hold", async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    await expect(ctx.bookings.confirm(attendees[1].id, h.bookingId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('configurable values change behavior without code changes', () => {
  it('max seats per booking is read from settings', async () => {
    await expect(
      ctx.bookings.hold(attendees[0].id, eventId, seatIds.slice(0, 5)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await ctx.settings.update({ maxSeatsPerBooking: 6 });
    const h = await ctx.bookings.hold(attendees[0].id, eventId, seatIds.slice(0, 5));
    expect(h.seatIds).toHaveLength(5);
    await ctx.settings.update({ maxSeatsPerBooking: 1 });
    await expect(
      ctx.bookings.hold(attendees[1].id, eventId, seatIds.slice(10, 12)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hold duration is read from settings', async () => {
    await ctx.settings.update({ holdDurationSeconds: 30 });
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    expect(new Date(h.holdExpiresAt).getTime() - ctx.clock.now().getTime()).toBe(30_000);
    ctx.clock.advance(30_000);
    expect(await ctx.bookings.releaseExpired()).toBe(1);
  });
});

describe('history and cancellation', () => {
  it('cancelling frees the seats so they can be booked again', async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0], seatIds[1]]);
    await ctx.bookings.confirm(attendees[0].id, h.bookingId);
    await ctx.bookings.cancel({ id: attendees[0].id, role: 'attendee' }, h.bookingId);
    expect(await seatStatus(seatIds[0])).toBe('available');
    const again = await ctx.bookings.hold(attendees[1].id, eventId, [seatIds[0]]);
    expect(again.status).toBe('held');
  });

  it("an attendee cannot cancel another attendee's booking", async () => {
    const h = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    await expect(
      ctx.bookings.cancel({ id: attendees[1].id, role: 'attendee' }, h.bookingId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('history lists only my bookings with seat labels and statuses', async () => {
    const h1 = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0], seatIds[1]]);
    await ctx.bookings.confirm(attendees[0].id, h1.bookingId);
    const h2 = await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[5]]);
    await ctx.bookings.cancel({ id: attendees[0].id, role: 'attendee' }, h2.bookingId);
    await ctx.bookings.hold(attendees[1].id, eventId, [seatIds[9]]);

    const hist = await ctx.bookings.history(attendees[0].id);
    expect(hist).toHaveLength(2);
    expect(hist.map((b) => b.status).sort()).toEqual(['cancelled', 'confirmed']);
    expect(hist.find((b) => b.status === 'confirmed')!.seats).toEqual(['A1', 'A2']);
  });
});
