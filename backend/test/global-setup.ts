import pg from 'pg';
import { TEST_DATABASE_URL } from './test-env.js';

/** Creates the test database if it does not exist yet. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }
}
