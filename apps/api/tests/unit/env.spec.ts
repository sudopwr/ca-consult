import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

describe('parseEnv', () => {
  it('applies the agreed booking-policy defaults', () => {
    const env = parseEnv({});

    expect(env.BOOKING_CANCEL_WINDOW_HOURS).toBe(12);
    expect(env.BOOKING_MIN_LEAD_MINUTES).toBe(120);
    expect(env.BOOKING_MAX_UPCOMING_PER_USER).toBe(3);
  });

  it('ships with SMS off — DLT templates have not cleared', () => {
    expect(parseEnv({}).NOTIFY_SMS_ENABLED).toBe(false);
    expect(parseEnv({ NOTIFY_SMS_ENABLED: 'true' }).NOTIFY_SMS_ENABLED).toBe(true);
  });

  it('coerces numeric strings, because every env var arrives as a string', () => {
    expect(parseEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('throws on a malformed value rather than silently falling back', () => {
    expect(() => parseEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => parseEnv({ WEB_ORIGIN: 'definitely-not-a-url' })).toThrow(/WEB_ORIGIN/);
  });

  it('names every offending key at once, not just the first', () => {
    expect(() => parseEnv({ PORT: 'x', NODE_ENV: 'staging' })).toThrow(/PORT[\s\S]*NODE_ENV/);
  });
});
