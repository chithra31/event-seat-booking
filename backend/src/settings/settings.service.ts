import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';

export interface AppSettings {
  holdDurationSeconds: number;
  maxSeatsPerBooking: number;
}

/**
 * Admin-configurable values. They are read from the database on every use
 * (no caching), so changing them changes behavior with no code change.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async get(): Promise<AppSettings> {
    const { rows } = await this.db.query<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      holdDurationSeconds: Number(map.get('hold_duration_seconds') ?? 300),
      maxSeatsPerBooking: Number(map.get('max_seats_per_booking') ?? 4),
    };
  }

  async update(input: Partial<AppSettings>): Promise<AppSettings> {
    const updates: [string, number][] = [];
    if (input.holdDurationSeconds !== undefined) {
      this.assertInt(input.holdDurationSeconds, 'holdDurationSeconds', 1, 86400);
      updates.push(['hold_duration_seconds', input.holdDurationSeconds]);
    }
    if (input.maxSeatsPerBooking !== undefined) {
      this.assertInt(input.maxSeatsPerBooking, 'maxSeatsPerBooking', 1, 50);
      updates.push(['max_seats_per_booking', input.maxSeatsPerBooking]);
    }
    if (updates.length === 0) {
      throw new BadRequestException('No settings provided');
    }
    for (const [key, value] of updates) {
      await this.db.query(
        `INSERT INTO settings(key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value)],
      );
    }
    return this.get();
  }

  private assertInt(v: unknown, name: string, min: number, max: number) {
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      throw new BadRequestException(
        `${name} must be an integer between ${min} and ${max}`,
      );
    }
  }
}
