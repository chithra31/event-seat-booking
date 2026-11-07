import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Ctx, DAY, makeCtx, makeEvent, makeUsers, resetDb } from './helpers.js';

let ctx: Ctx;
let organizer: { id: number };
let attendees: { id: number }[];

beforeEach(async () => {
  ctx ??= await makeCtx();
  await resetDb(ctx.db);
  ({ organizer, attendees } = await makeUsers(ctx, 2));
});
afterAll(async () => {
  await ctx?.db.onModuleDestroy();
});

const input = (over: object = {}) => ({
  name: 'Concert',
  date: new Date(ctx.clock.now().getTime() + 10 * DAY).toISOString(),
  venue: 'Arena',
  rows: 10,
  seatsPerRow: 12,
  ...over,
});

describe('event setup validation', () => {
  it('creates an event with a 10x12 grid (120 seats)', async () => {
    const { id } = await ctx.events.create(organizer.id, input());
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM seats WHERE event_id = $1', [id]);
    expect(rows[0].n).toBe(120);
  });

  it('rejects a date that is not in the future', async () => {
    await expect(
      ctx.events.create(
        organizer.id,
        input({ date: new Date(ctx.clock.now().getTime() - DAY).toISOString() }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty seating grid', async () => {
    await expect(ctx.events.create(organizer.id, input({ rows: 0 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(ctx.events.create(organizer.id, input({ seatsPerRow: 0 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects missing name or venue', async () => {
    await expect(ctx.events.create(organizer.id, input({ name: ' ' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(ctx.events.create(organizer.id, input({ venue: '' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('changing seating', () => {
  it('regenerates the grid when nothing is held or booked', async () => {
    const { eventId } = await makeEvent(ctx, organizer.id, 5, 10);
    await ctx.events.update(eventId, { rows: 2, seatsPerRow: 3 });
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM seats WHERE event_id = $1', [
      eventId,
    ]);
    expect(rows[0].n).toBe(6);
  });

  it('refuses to change the grid while seats are held or booked', async () => {
    const { eventId, seatIds } = await makeEvent(ctx, organizer.id);
    await ctx.bookings.hold(attendees[0].id, eventId, [seatIds[0]]);
    await expect(ctx.events.update(eventId, { rows: 2 })).rejects.toBeInstanceOf(ConflictException);
  });
});
