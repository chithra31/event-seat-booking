import { TEST_DATABASE_URL } from './test-env.js';

// Tests must never touch the development database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DISABLE_SWEEPER = 'true';
process.env.JWT_SECRET = 'test-secret';
