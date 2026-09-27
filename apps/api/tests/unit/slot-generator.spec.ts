import { describe, expect, it } from 'vitest';
import { generateSlots, isBookableSlot, MAX_QUERY_DAYS } from '../../src/domain/scheduling/slot-generator.js';
import type { SlotContext } from '../../src/domain/scheduling/slot-generator.js';
import type { AvailabilityRule } from '../../src/domain/scheduling/availability-rule.js';
import type { ScheduleException } from '../../src/domain/scheduling/schedule-exception.js';
import { zonedToInstant } from '../../src/domain/shared/time.js';

const IST = 'Asia/Kolkata';

// 2026-09-21 is a Monday, 2026-09-26 a Saturday, 2026-09-20 a Sunday.
const MONDAY = '2026-09-21';
const TUESDAY = '2026-09-22';
const SATURDAY = '2026-09-26';
const SUNDAY = '2026-09-20';

/** Far enough back that lead time never interferes unless a test wants it to. */
const NOW = new Date('2026-09-16T09:00:00+05:30');

function rule(over: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: over.id ?? 'r1',
    dayOfWeek: 1,
    startTime: '10:00',
    endTime: '13:00',
    slotMinutes: 30,
    bufferMinutes: 0,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    isActive: true,
    ...over,
  };
}

function exception(over: Partial<ScheduleException> & { onDate: string }): ScheduleException {
  return {
    id: over.id ?? 'e1',
    kind: 'BLOCKED',
    startTime: null,
    endTime: null,
    reason: null,
    ...over,
  };
}

function ctx(over: Partial<SlotContext> = {}): SlotContext {
  return {
    rules: [],
    exceptions: [],
    busy: [],
    policy: { minLeadMinutes: 0, maxAdvanceDays: 3650 },
    ...over,
  };
}

function at(date: string, time: string): Date {
  return zonedToInstant(date, time, IST);
}

/** Slot start times as local HH:MM, which is how the tests read best. */
function starts(days: ReturnType<typeof generateSlots>, index = 0): string[] {
  return (days[index]?.slots ?? []).map((s) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour12: false, hour: '2-digit', minute: '2-digit' })
      .format(s.start),
  );
}

function query(date: string, durationMinutes = 30, now: Date = NOW) {
  return { from: date, to: date, durationMinutes, timeZone: IST, now };
}

describe('generateSlots — basic grid', () => {
  it('walks a window on the rule grid', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule()] }));

    expect(starts(days)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  });

  it('returns nothing on a day with no matching rule', () => {
    const days = generateSlots(query(SUNDAY), ctx({ rules: [rule({ dayOfWeek: 1 })] }));

    expect(days).toHaveLength(1);
    expect(days[0]!.slots).toEqual([]);
  });

  it('returns nothing when there are no rules at all', () => {
    expect(generateSlots(query(MONDAY), ctx())[0]!.slots).toEqual([]);
  });

  it('gives each slot the service duration, not the grid size', () => {
    // A 15-minute service on a 30-minute grid: slots start every 30 minutes
    // but each one is only 15 minutes long.
    const days = generateSlots(query(MONDAY, 15), ctx({ rules: [rule()] }));
    const first = days[0]!.slots[0]!;

    expect((first.end.getTime() - first.start.getTime()) / 60000).toBe(15);
    expect(starts(days)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  });

  it('offers nothing when the service is longer than the whole window', () => {
    const days = generateSlots(query(MONDAY, 240), ctx({ rules: [rule()] }));
    expect(days[0]!.slots).toEqual([]);
  });

  it('offers exactly one slot when the service fills the window', () => {
    const days = generateSlots(query(MONDAY, 180), ctx({ rules: [rule()] }));
    expect(starts(days)).toEqual(['10:00']);
  });

  it('handles two windows in one day with different grids', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [
          rule({ id: 'am', startTime: '10:00', endTime: '11:00', slotMinutes: 30 }),
          rule({ id: 'pm', startTime: '15:00', endTime: '16:00', slotMinutes: 60 }),
        ],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '10:30', '15:00']);
  });

  it('deduplicates slots produced by two overlapping rules', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [
          rule({ id: 'a', startTime: '10:00', endTime: '12:00' }),
          rule({ id: 'b', startTime: '11:00', endTime: '13:00' }),
        ],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  });
});

describe('generateSlots — buffers', () => {
  it('drops the last slot when the buffer no longer fits', () => {
    // 10:00-13:00, 30-minute slots, 30-minute service, 15-minute buffer.
    // 12:30 would run to 13:00 with no room for the gap, so it goes.
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule({ bufferMinutes: 15 })] }));

    expect(starts(days)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });

  it('still returns slots of the service length, not duration plus buffer', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule({ bufferMinutes: 15 })] }));
    const first = days[0]!.slots[0]!;

    expect((first.end.getTime() - first.start.getTime()) / 60000).toBe(30);
  });

  it('keeps a slot that ends exactly at the window close when there is no buffer', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule({ bufferMinutes: 0 })] }));
    expect(starts(days)).toContain('12:30');
  });
});

describe('generateSlots — exceptions', () => {
  it('empties the day for a whole-day block', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({ rules: [rule()], exceptions: [exception({ onDate: MONDAY, reason: 'Holiday' })] }),
    );

    expect(days[0]!.slots).toEqual([]);
  });

  it('a whole-day block beats an EXTRA opening on the same date', () => {
    const days = generateSlots(
      query(SUNDAY),
      ctx({
        rules: [],
        exceptions: [
          exception({ id: 'x', kind: 'EXTRA', onDate: SUNDAY, startTime: '10:00', endTime: '12:00' }),
          exception({ id: 'b', onDate: SUNDAY }),
        ],
      }),
    );

    // If the CA has marked the day off, the day is off.
    expect(days[0]!.slots).toEqual([]);
  });

  it('carves a hole out of a window for a partial block', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [rule()],
        exceptions: [
          exception({ onDate: MONDAY, startTime: '11:00', endTime: '12:00', reason: 'Court' }),
        ],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '10:30', '12:00', '12:30']);
  });

  it('ignores a block on a different date', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({ rules: [rule()], exceptions: [exception({ onDate: TUESDAY })] }),
    );

    expect(starts(days)).toHaveLength(6);
  });

  it('opens a day that has no weekly rule via EXTRA', () => {
    const days = generateSlots(
      query(SATURDAY),
      ctx({
        rules: [rule({ dayOfWeek: 1 })],
        exceptions: [
          exception({ kind: 'EXTRA', onDate: SATURDAY, startTime: '10:00', endTime: '11:30' }),
        ],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '10:30', '11:00']);
  });

  it('a partial block splits a window into two pieces', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [rule({ startTime: '09:00', endTime: '17:00' })],
        exceptions: [exception({ onDate: MONDAY, startTime: '12:00', endTime: '15:00' })],
      }),
    );

    const times = starts(days);
    expect(times).toContain('11:30');
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('14:30');
    expect(times).toContain('15:00');
  });
});

describe('generateSlots — effective dates', () => {
  it('ignores a rule that has not started yet', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({ rules: [rule({ effectiveFrom: '2026-10-01' })] }),
    );
    expect(days[0]!.slots).toEqual([]);
  });

  it('ignores a rule that has expired', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({ rules: [rule({ effectiveTo: '2026-09-01' })] }),
    );
    expect(days[0]!.slots).toEqual([]);
  });

  it('includes a rule on its final effective day', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule({ effectiveTo: MONDAY })] }));
    expect(starts(days)).toHaveLength(6);
  });

  it('ignores an inactive rule', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule({ isActive: false })] }));
    expect(days[0]!.slots).toEqual([]);
  });
});

describe('generateSlots — existing bookings', () => {
  it('removes exactly the booked slot and no others', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [rule()],
        busy: [{ start: at(MONDAY, '11:00'), end: at(MONDAY, '11:30') }],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '10:30', '11:30', '12:00', '12:30']);
  });

  it('removes every slot a long appointment covers', () => {
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [rule()],
        busy: [{ start: at(MONDAY, '10:45'), end: at(MONDAY, '12:15') }],
      }),
    );

    expect(starts(days)).toEqual(['10:00', '12:30']);
  });

  it('keeps a slot that merely touches a booking — half-open ranges', () => {
    // 11:00-11:30 booked; 11:30-12:00 is still free. This is the same rule the
    // database enforces with '[)' bounds.
    const days = generateSlots(
      query(MONDAY),
      ctx({
        rules: [rule()],
        busy: [{ start: at(MONDAY, '11:00'), end: at(MONDAY, '11:30') }],
      }),
    );

    expect(starts(days)).toContain('11:30');
  });
});

describe('generateSlots — policy windows', () => {
  it('drops slots inside the minimum lead time', () => {
    const now = new Date(at(MONDAY, '09:00'));
    const days = generateSlots(
      query(MONDAY, 30, now),
      ctx({ rules: [rule()], policy: { minLeadMinutes: 120, maxAdvanceDays: 3650 } }),
    );

    // now + 2h is 11:00, so 10:00 and 10:30 are gone.
    expect(starts(days)).toEqual(['11:00', '11:30', '12:00', '12:30']);
  });

  it('includes the slot sitting exactly on the lead-time boundary', () => {
    const now = new Date(at(MONDAY, '09:00'));
    const days = generateSlots(
      query(MONDAY, 30, now),
      ctx({ rules: [rule()], policy: { minLeadMinutes: 120, maxAdvanceDays: 3650 } }),
    );

    expect(starts(days)[0]).toBe('11:00');
  });

  it('drops slots beyond the maximum advance window', () => {
    const now = new Date('2026-09-16T09:00:00+05:30');
    const days = generateSlots(
      { from: MONDAY, to: MONDAY, durationMinutes: 30, timeZone: IST, now },
      ctx({ rules: [rule()], policy: { minLeadMinutes: 0, maxAdvanceDays: 2 } }),
    );

    // Monday the 21st is five days out; the ceiling is the 18th.
    expect(days[0]!.slots).toEqual([]);
  });

  it('caps a very wide query rather than generating unbounded work', () => {
    const days = generateSlots(
      { from: '2026-09-01', to: '2027-09-01', durationMinutes: 30, timeZone: IST, now: NOW },
      ctx({ rules: [rule()] }),
    );

    expect(days).toHaveLength(MAX_QUERY_DAYS);
  });
});

describe('generateSlots — multi-day', () => {
  it('returns one entry per date, including empty days', () => {
    const days = generateSlots(
      { from: SUNDAY, to: TUESDAY, durationMinutes: 30, timeZone: IST, now: NOW },
      ctx({ rules: [rule({ dayOfWeek: 1 })] }),
    );

    expect(days.map((d) => d.date)).toEqual([SUNDAY, MONDAY, TUESDAY]);
    expect(days[0]!.slots).toEqual([]); // Sunday
    expect(days[1]!.slots).toHaveLength(6); // Monday
    expect(days[2]!.slots).toEqual([]); // Tuesday
  });

  it('produces instants that are correct in UTC', () => {
    const days = generateSlots(query(MONDAY), ctx({ rules: [rule()] }));

    expect(days[0]!.slots[0]!.start.toISOString()).toBe('2026-09-21T04:30:00.000Z');
  });
});

describe('isBookableSlot', () => {
  const context = ctx({ rules: [rule()] });
  const base = { durationMinutes: 30, timeZone: IST, now: NOW, date: MONDAY };

  it('accepts a slot on the grid', () => {
    expect(isBookableSlot(at(MONDAY, '11:00'), base, context)).toBe(true);
  });

  it('rejects a time inside the window but off the grid', () => {
    // 10:07 is open time, but it is not a slot. The grid is part of the
    // contract, not a UI convenience — a hand-crafted POST must fail too.
    expect(isBookableSlot(at(MONDAY, '10:07'), base, context)).toBe(false);
  });

  it('rejects a time outside the window', () => {
    expect(isBookableSlot(at(MONDAY, '09:00'), base, context)).toBe(false);
    expect(isBookableSlot(at(MONDAY, '13:00'), base, context)).toBe(false);
  });

  it('rejects a slot that is already booked', () => {
    const busy = ctx({
      rules: [rule()],
      busy: [{ start: at(MONDAY, '11:00'), end: at(MONDAY, '11:30') }],
    });

    expect(isBookableSlot(at(MONDAY, '11:00'), base, busy)).toBe(false);
  });

  it('rejects a slot on a blocked day', () => {
    const blocked = ctx({ rules: [rule()], exceptions: [exception({ onDate: MONDAY })] });

    expect(isBookableSlot(at(MONDAY, '11:00'), base, blocked)).toBe(false);
  });
});
