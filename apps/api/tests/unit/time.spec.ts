import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  daysBetween,
  eachDate,
  instantToLocalDate,
  instantToLocalTime,
  minutesSinceMidnight,
  minutesToLocalTime,
  parseLocalTime,
  timeZoneOffsetMs,
  zonedToInstant,
} from '../../src/domain/shared/time.js';

const IST = 'Asia/Kolkata';

describe('timeZoneOffsetMs', () => {
  it('is +5:30 for India, which has no DST', () => {
    const jan = timeZoneOffsetMs(new Date('2026-01-15T00:00:00Z'), IST);
    const jul = timeZoneOffsetMs(new Date('2026-07-15T00:00:00Z'), IST);

    expect(jan).toBe(5.5 * 3600 * 1000);
    expect(jul).toBe(jan);
  });

  it('tracks DST for a zone that has it', () => {
    // London: GMT in winter, BST in summer. If this ever breaks, the slot
    // generator would silently shift every appointment by an hour.
    expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(timeZoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(3600 * 1000);
  });
});

describe('zonedToInstant', () => {
  it('converts an Indian wall-clock time to the right instant', () => {
    expect(zonedToInstant('2026-09-20', '11:00', IST).toISOString()).toBe('2026-09-20T05:30:00.000Z');
  });

  it('handles midnight', () => {
    expect(zonedToInstant('2026-09-20', '00:00', IST).toISOString()).toBe('2026-09-19T18:30:00.000Z');
  });

  it('handles the last minute of the day', () => {
    expect(zonedToInstant('2026-09-20', '23:59', IST).toISOString()).toBe('2026-09-20T18:29:00.000Z');
  });

  it('crosses a year boundary correctly', () => {
    expect(zonedToInstant('2027-01-01', '02:00', IST).toISOString()).toBe('2026-12-31T20:30:00.000Z');
  });

  it('resolves a wall-clock time on the far side of a DST spring-forward', () => {
    // London clocks go forward at 01:00 UTC on 29 Mar 2026. 10:00 local that
    // morning is 09:00 UTC, not 10:00. The two-pass offset correction is what
    // gets this right.
    expect(zonedToInstant('2026-03-29', '10:00', 'Europe/London').toISOString()).toBe(
      '2026-03-29T09:00:00.000Z',
    );
  });

  it('round-trips through the local-time formatters', () => {
    const instant = zonedToInstant('2026-09-20', '14:45', IST);
    expect(instantToLocalDate(instant, IST)).toBe('2026-09-20');
    expect(instantToLocalTime(instant, IST)).toBe('14:45');
  });

  it('renders midnight as 00:00 rather than 24:00', () => {
    const instant = zonedToInstant('2026-09-20', '00:00', IST);
    expect(instantToLocalTime(instant, IST)).toBe('00:00');
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => zonedToInstant('20-09-2026', '11:00', IST)).toThrow(/Invalid local date/);
    expect(() => zonedToInstant('2026-09-20', '25:00', IST)).toThrow(/Invalid local time/);
    expect(() => parseLocalTime('11:60')).toThrow(/Invalid local time/);
  });
});

describe('calendar helpers', () => {
  it('knows the day of week', () => {
    expect(dayOfWeek('2026-09-20')).toBe(0); // Sunday
    expect(dayOfWeek('2026-09-21')).toBe(1);
    expect(dayOfWeek('2026-09-26')).toBe(6);
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds days across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-16', '2026-09-20')).toBe(4);
    expect(daysBetween('2026-09-20', '2026-09-16')).toBe(-4);
    expect(daysBetween('2026-09-16', '2026-09-16')).toBe(0);
  });

  it('enumerates an inclusive range', () => {
    expect(eachDate('2026-09-16', '2026-09-18')).toEqual([
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
  });

  it('returns nothing when the range runs backwards', () => {
    expect(eachDate('2026-09-18', '2026-09-16')).toEqual([]);
  });

  it('converts between minutes and time-of-day', () => {
    expect(minutesSinceMidnight('10:30')).toBe(630);
    expect(minutesToLocalTime(630)).toBe('10:30');
    expect(minutesToLocalTime(0)).toBe('00:00');
  });
});
