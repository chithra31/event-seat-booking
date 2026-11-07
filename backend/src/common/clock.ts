/**
 * All "what time is it" decisions in the booking logic go through this
 * abstraction so tests can control time (see test/helpers.ts FixedClock).
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
