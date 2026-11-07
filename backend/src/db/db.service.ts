import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

export const DEFAULT_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/seatbooking';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      max: 10,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.applySchema();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async applySchema(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async query<T extends pg.QueryResultRow = any>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /** Runs fn inside a transaction; commits on success, rolls back on throw. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
