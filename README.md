# Event Seat Booking (with double-booking prevention)

Angular + NestJS + PostgreSQL. Attendees hold and book seats; organizers create events and configure the system. Two people can never hold the same seat, even when they click at the same instant.

## Setup (clean machine)

Requirements: Node 20+, PostgreSQL 14+ (or Docker, see below).

```bash
# 1. Database (skip if you use your own Postgres)
docker compose up -d            # starts Postgres on :5432 (postgres/postgres)

# 2. Backend
cd backend
cp .env.example .env            # edit DATABASE_URL / TEST_DATABASE_URL if your credentials differ
npm install --legacy-peer-deps
npm run seed                    # creates schema + 2 events + 30 bookings + demo users
npm run start:dev               # http://localhost:3000

# 3. Frontend (new terminal)
cd frontend
npm install
npm start                       # http://localhost:4200
```

Create the databases `seatbooking` and (for tests) `seatbooking_test` if they don't exist; the test run creates `seatbooking_test` automatically.

Demo accounts (password `password123`): `organizer@example.com`, `attendee1@example.com` … `attendee10@example.com`.

## Running the tests

```bash
cd backend
npm test        # 27 tests against a real PostgreSQL test database
```

Tests use a separate database (`TEST_DATABASE_URL`) and never touch dev data.

## Architecture

- `backend/` NestJS (ESM) with raw SQL via `pg` so locking/constraint behavior is explicit.
  - `auth/` JWT login/registration, `AuthGuard` + `RolesGuard` (`@Roles('organizer')`). The user's role is loaded from the DB on every request.
  - `events/` event CRUD, seat grid generation, seat map.
  - `bookings/` hold → confirm → cancel, history, expiry sweeper.
  - `settings/` admin-editable configuration.
  - `common/clock.ts` injectable `Clock`; tests swap in a `FixedClock`.
- `frontend/` Angular standalone components: login, events, seat map (polls every 3 s), bookings history, organizer event form and settings.

## Data model

| Table | Purpose |
|---|---|
| `users` | email, password hash, role (`attendee` / `organizer`) |
| `events` | name, description, date, venue, rows × seats per row |
| `seats` | one row per physical seat, unique `(event_id, row_label, seat_number)` |
| `bookings` | one per hold/booking: status `held` / `confirmed` / `cancelled` / `expired`, `hold_expires_at` |
| `booking_seats` | seats of a booking; `active` = currently claims the seat |
| `settings` | `hold_duration_seconds` (default 300), `max_seats_per_booking` (default 4) |

## Where double-booking is prevented (and why the UI can't bypass it)

In the database: `schema.ts` defines

```sql
CREATE UNIQUE INDEX one_active_claim_per_seat ON booking_seats(seat_id) WHERE active;
```

A seat can have at most one *active* claim (held or booked). A hold inserts its `booking_seats` rows inside a transaction; if two requests race, PostgreSQL lets one commit and rejects the other with unique violation `23505`, which the API turns into HTTP 409 and rolls back the whole hold (no partial holds). There is no "check then insert" in application code, so there is no race window. Releasing a seat (cancel / expiry) sets `active = false`. The UI only displays state; even a hand-crafted request hits the same constraint. A test inserts directly into the table to prove the database itself refuses a second claim.

## Hold expiry

- A background sweeper (`BookingsService.releaseExpired`, every 5 s) marks lapsed holds `expired` and frees their seats.
- Expiry is also enforced lazily: seat maps report lapsed holds as available, `hold()` releases lapsed holds on the requested seats first (rows locked in id order, no deadlocks), and `confirm()` only succeeds when `hold_expires_at > now`, atomically.
- All time comes from the injected `Clock`, so tests advance a fixed clock to prove release at exactly 300 s.

## Configuration without code changes

Organizers edit hold duration and max seats per booking at **Settings** (`PUT /settings`). They are read from the DB on every hold, so the next booking uses the new values.

## API summary

`POST /auth/register|login`, `GET /auth/me`, `GET /events`, `GET /events/:id/seats`, `POST /events` *(organizer)*, `PATCH /events/:id` *(organizer)*, `POST /events/:id/holds`, `POST /bookings/:id/confirm`, `DELETE /bookings/:id`, `GET /bookings/mine`, `GET|PUT /settings` *(PUT organizer)*.

## Test coverage (27 tests)

Concurrency (2 racers; 10 racers × 20 rounds; all-or-nothing multi-seat; direct-SQL bypass), fixed-clock expiry and lazy release, confirm-after-expiry, config changes (max seats, hold duration), cancellation frees seats, history, event validation (future date, empty grid), seating changes, and HTTP role enforcement (401/403, no self-service organizer role).
