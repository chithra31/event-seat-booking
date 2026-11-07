/**
 * Database schema. Applied idempotently on startup (and by the test helpers).
 *
 * DOUBLE-BOOKING GUARANTEE lives here:
 *   booking_seats.active marks a seat as currently claimed (held or booked).
 *   The PARTIAL UNIQUE INDEX `one_active_claim_per_seat` allows at most one
 *   active row per seat, so PostgreSQL itself rejects a second claim with
 *   error 23505 - regardless of what the API or UI does.
 *   Releasing a seat (cancel / expiry) flips active to false.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('attendee','organizer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  event_date     TIMESTAMPTZ NOT NULL,
  venue          TEXT NOT NULL,
  row_count      INT NOT NULL CHECK (row_count > 0),
  seats_per_row  INT NOT NULL CHECK (seats_per_row > 0),
  created_by     INT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seats (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  row_label   TEXT NOT NULL,
  seat_number INT NOT NULL,
  UNIQUE (event_id, row_label, seat_number)
);

CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  event_id        INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         INT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired')),
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id);

CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id    INT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (booking_id, seat_id)
);
-- The storage-level double-booking guard: one active claim per seat.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_claim_per_seat
  ON booking_seats(seat_id) WHERE active;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings(key, value) VALUES
  ('hold_duration_seconds', '300'),
  ('max_seats_per_booking', '4')
ON CONFLICT (key) DO NOTHING;
`;
