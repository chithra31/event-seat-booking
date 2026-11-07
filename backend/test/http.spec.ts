import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { Clock } from '../src/common/clock.js';
import { DbService } from '../src/db/db.service.js';
import { FixedClock, resetDb } from './helpers.js';

let app: INestApplication;
let clock: FixedClock;
let organizerToken: string;
let attendeeToken: string;
let eventId: number;

const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  clock = new FixedClock();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  app = mod.createNestApplication();
  await app.init();
  await resetDb(app.get(DbService));
  await app.get(AuthService).createUser('boss@test.dev', 'Boss', 'secret1', 'organizer');
  organizerToken = (
    await http().post('/auth/login').send({ email: 'boss@test.dev', password: 'secret1' })
  ).body.token;
  attendeeToken = (
    await http().post('/auth/register').send({ email: 'fan@test.dev', name: 'Fan', password: 'secret1' })
  ).body.token;
});

afterAll(async () => {
  await app?.close();
});

describe('server-side role enforcement', () => {
  const body = () => ({
    name: 'Gig',
    venue: 'Hall',
    date: new Date(clock.now().getTime() + 5 * 86400000).toISOString(),
    rows: 3,
    seatsPerRow: 4,
  });

  it('rejects unauthenticated requests with 401', async () => {
    await http().get('/events').expect(401);
  });

  it('attendee cannot create events (403), organizer can (201)', async () => {
    await http().post('/events').set(auth(attendeeToken)).send(body()).expect(403);
    const res = await http().post('/events').set(auth(organizerToken)).send(body()).expect(201);
    eventId = res.body.id;
  });

  it('attendee cannot change seating or configuration (403)', async () => {
    await http().patch(`/events/${eventId}`).set(auth(attendeeToken)).send({ rows: 2 }).expect(403);
    await http().put('/settings').set(auth(attendeeToken)).send({ maxSeatsPerBooking: 20 }).expect(403);
  });

  it('public registration can never create an organizer', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: 'sneaky@test.dev', name: 'S', password: 'secret1', role: 'organizer' })
      .expect(201);
    expect(res.body.user.role).toBe('attendee');
  });
});

describe('AI description draft', () => {
  it('organizer gets a draft (template fallback without an API key); attendee gets 403', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await http()
      .post('/events/draft-description')
      .set(auth(organizerToken))
      .send({ name: 'Jazz Night', venue: 'Blue Hall' })
      .expect(201);
    expect(res.body.source).toBe('template');
    expect(res.body.description).toContain('Jazz Night');
    await http().post('/events/draft-description').set(auth(attendeeToken)).send({ name: 'x' }).expect(403);
    await http().post('/events/draft-description').set(auth(organizerToken)).send({}).expect(400);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});

describe('booking flow over HTTP', () => {
  it('hold -> confirm -> history -> cancel', async () => {
    const map = await http().get(`/events/${eventId}/seats`).set(auth(attendeeToken)).expect(200);
    expect(map.body.seats).toHaveLength(12);
    const ids = map.body.seats.slice(0, 2).map((s: { id: number }) => s.id);

    const hold = await http()
      .post(`/events/${eventId}/holds`)
      .set(auth(attendeeToken))
      .send({ seatIds: ids })
      .expect(201);
    await http().post(`/bookings/${hold.body.bookingId}/confirm`).set(auth(attendeeToken)).expect(201);

    const mine = await http().get('/bookings/mine').set(auth(attendeeToken)).expect(200);
    expect(mine.body[0].status).toBe('confirmed');

    await http().delete(`/bookings/${hold.body.bookingId}`).set(auth(attendeeToken)).expect(200);
  });

  it('returns 409 when the seat is already held by someone else', async () => {
    const other = (
      await http().post('/auth/register').send({ email: 'x@test.dev', name: 'X', password: 'secret1' })
    ).body.token;
    const map = await http().get(`/events/${eventId}/seats`).set(auth(attendeeToken));
    const id = map.body.seats[5].id;
    await http().post(`/events/${eventId}/holds`).set(auth(attendeeToken)).send({ seatIds: [id] }).expect(201);
    await http().post(`/events/${eventId}/holds`).set(auth(other)).send({ seatIds: [id] }).expect(409);
  });
});
