import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DbService } from '../db/db.service.js';

export type Role = 'attendee' | 'organizer';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-only-secret-change-me';

@Injectable()
export class AuthService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Public registration always creates an attendee. Organizers are created by seed/admin only. */
  async register(email: string, name: string, password: string) {
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new BadRequestException('Name is required');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const user = await this.createUser(email, name.trim(), password, 'attendee');
    return this.session(user);
  }

  async createUser(
    email: string,
    name: string,
    password: string,
    role: Role,
  ): Promise<AuthUser> {
    const hash = await bcrypt.hash(password, 8);
    try {
      const { rows } = await this.db.query<AuthUser>(
        `INSERT INTO users(email, name, password_hash, role)
         VALUES (lower($1), $2, $3, $4) RETURNING id, email, name, role`,
        [email, name, hash, role],
      );
      return rows[0];
    } catch (err: any) {
      if (err.code === '23505') throw new ConflictException('Email already registered');
      throw err;
    }
  }

  async login(email: string, password: string) {
    const { rows } = await this.db.query(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = lower($1)',
      [String(email ?? '')],
    );
    const row = rows[0];
    if (!row || !(await bcrypt.compare(String(password ?? ''), row.password_hash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const { password_hash, ...user } = row;
    return this.session(user as AuthUser);
  }

  /** Verifies a bearer token and loads the CURRENT user (role comes from the DB, not the token). */
  async userFromToken(token: string): Promise<AuthUser> {
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET());
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const { rows } = await this.db.query<AuthUser>(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!rows[0]) throw new UnauthorizedException('Unknown user');
    return rows[0];
  }

  private session(user: AuthUser) {
    const token = jwt.sign({ sub: user.id }, JWT_SECRET(), { expiresIn: '12h' });
    return { token, user };
  }
}
