import type { LocalDate } from '../shared/time.js';
import { eachDate, zonedToInstant, minutesSinceMidnight, minutesToLocalTime } from '../shared/time.js';
import type { AvailabilityRule } from './availability-rule.js';
import { rulesFor } from './availability-rule.js';
import type { ScheduleException } from './schedule-exception.js';
import { exceptionsOn, isWholeDayBlock } from './schedule-exception.js';
import type { TimeRange } from './time-range.js';
import { mergeRanges, overlapsAny, subtract } from './time-range.js';

/**
 * The heart of the booking system.
 *
 * Pure: no I/O, no database, and `now` arrives as a parameter rather than from
 * a clock. That is what makes every DST boundary, every off-by-one at the edge
 * of a window and every lead-time cutoff a table-driven test that runs in
 * microseconds instead of an integration test that has to wait.
 *
 * Slots are never stored. Pre-generating rows would mean every schedule edit
 * has to reconcile thousands of future records; deriving them means a schedule
 * edit is one UPDATE and this function does the rest.
 */

export interface SlotQuery {
  /** Inclusive. */
  readonly from: LocalDate;
  /** Inclusive. */
  readonly to: LocalDate;
  readonly durationMinutes: number;
  readonly timeZone: string;
  readonly now: Date;
}

export interface SlotPolicy {
  readonly minLeadMinutes: number;
  readonly maxAdvanceDays: number;
}

export interface SlotContext {
  readonly rules: readonly AvailabilityRule[];
  readonly exceptions: readonly ScheduleException[];
  /** Confirmed appointments in the window — the only ones that block a slot. */
  readonly busy: readonly TimeRange[];
  readonly policy: SlotPolicy;
}

export interface DaySlots {
  readonly date: LocalDate;
  readonly slots: TimeRange[];
}

/** Hard ceiling on a single query, so nobody can ask for five years of slots. */
export const MAX_QUERY_DAYS = 62;

export function generateSlots(query: SlotQuery, context: SlotContext): DaySlots[] {
  const { from, to, durationMinutes, timeZone, now } = query;
  const { rules, exceptions, busy, policy } = context;

  if (durationMinutes <= 0) return [];

  const earliest = new Date(now.getTime() + policy.minLeadMinutes * 60_000);
  const latest = new Date(now.getTime() + policy.maxAdvanceDays * 86_400_000);

  return eachDate(from, to)
    .slice(0, MAX_QUERY_DAYS)
    .map((date) => ({
      date,
      slots: slotsForDate({
        date,
        durationMinutes,
        timeZone,
        rules,
        exceptions,
        busy,
        earliest,
        latest,
      }),
    }));
}

interface DayInput {
  date: LocalDate;
  durationMinutes: number;
  timeZone: string;
  rules: readonly AvailabilityRule[];
  exceptions: readonly ScheduleException[];
  busy: readonly TimeRange[];
  earliest: Date;
  latest: Date;
}

function slotsForDate(input: DayInput): TimeRange[] {
  const { date, timeZone, rules, exceptions } = input;

  const todaysExceptions = exceptionsOn(exceptions, date);

  // A whole-day block short-circuits everything, including EXTRA openings on
  // the same date. If the CA has marked the day off, the day is off.
  if (todaysExceptions.some(isWholeDayBlock)) return [];

  const applicableRules = rulesFor(rules, date);

  // Each rule keeps its own slot grid and buffer, so two windows on one day can
  // have different granularity (30-minute mornings, 45-minute afternoons).
  // That means we walk rules separately rather than merging them first.
  const windows: Array<{ range: TimeRange; slotMinutes: number; bufferMinutes: number }> = [];

  for (const rule of applicableRules) {
    windows.push({
      range: {
        start: zonedToInstant(date, rule.startTime, timeZone),
        end: zonedToInstant(date, rule.endTime, timeZone),
      },
      slotMinutes: rule.slotMinutes,
      bufferMinutes: rule.bufferMinutes,
    });
  }

  // EXTRA openings inherit the finest grid in use that day, so the admin does
  // not have to think about slot size when opening a one-off Saturday.
  const extras = todaysExceptions.filter((e) => e.kind === 'EXTRA' && e.startTime && e.endTime);
  if (extras.length > 0) {
    const grid = applicableRules.length > 0
      ? Math.min(...applicableRules.map((r) => r.slotMinutes))
      : input.durationMinutes;
    const buffer = applicableRules.length > 0
      ? Math.min(...applicableRules.map((r) => r.bufferMinutes))
      : 0;

    for (const extra of extras) {
      windows.push({
        range: {
          start: zonedToInstant(date, extra.startTime!, timeZone),
          end: zonedToInstant(date, extra.endTime!, timeZone),
        },
        slotMinutes: grid,
        bufferMinutes: buffer,
      });
    }
  }

  if (windows.length === 0) return [];

  // Partial BLOCKED exceptions carve holes out of every window.
  const cuts: TimeRange[] = todaysExceptions
    .filter((e) => e.kind === 'BLOCKED' && e.startTime && e.endTime)
    .map((e) => ({
      start: zonedToInstant(date, e.startTime!, timeZone),
      end: zonedToInstant(date, e.endTime!, timeZone),
    }));

  const candidates: TimeRange[] = [];

  for (const window of windows) {
    const openPieces = cuts.length > 0 ? subtract(window.range, cuts) : [window.range];

    for (const piece of openPieces) {
      candidates.push(
        ...walkWindow(piece, window.slotMinutes, window.bufferMinutes, input.durationMinutes),
      );
    }
  }

  // Overlapping rules can produce the same slot twice; dedupe by start instant.
  const unique = new Map<number, TimeRange>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.start.getTime())) unique.set(candidate.start.getTime(), candidate);
  }

  const busyMerged = mergeRanges(input.busy);

  return [...unique.values()]
    .filter((slot) => slot.start.getTime() >= input.earliest.getTime())
    .filter((slot) => slot.start.getTime() <= input.latest.getTime())
    .filter((slot) => !overlapsAny(slot, busyMerged))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Step through one open window on the rule's grid.
 *
 * The slot itself is `durationMinutes` long, but it must leave room for the
 * buffer as well — otherwise the last consultation of the morning runs into
 * the gap the CA needs before lunch. So the fit test is `duration + buffer`
 * while the returned range is just `duration`.
 */
function walkWindow(
  window: TimeRange,
  slotMinutes: number,
  bufferMinutes: number,
  durationMinutes: number,
): TimeRange[] {
  const slots: TimeRange[] = [];
  const stepMs = slotMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;
  const footprintMs = (durationMinutes + bufferMinutes) * 60_000;

  if (stepMs <= 0) return slots;

  for (
    let start = window.start.getTime();
    start + footprintMs <= window.end.getTime();
    start += stepMs
  ) {
    slots.push({ start: new Date(start), end: new Date(start + durationMs) });
  }

  return slots;
}

/**
 * Is this exact instant one of the slots the generator would offer?
 *
 * Booking calls this rather than scanning the generated list, because a client
 * posting `startsAt` of 10:07 must be rejected even though it sits inside the
 * open window. The grid is part of the contract, not a UI convenience.
 */
export function isBookableSlot(
  startsAt: Date,
  query: Omit<SlotQuery, 'from' | 'to'> & { date: LocalDate },
  context: SlotContext,
): boolean {
  const day = generateSlots(
    { ...query, from: query.date, to: query.date },
    context,
  )[0];

  return !!day?.slots.some((slot) => slot.start.getTime() === startsAt.getTime());
}

/** Local time-of-day helpers re-exported for callers building admin previews. */
export { minutesSinceMidnight, minutesToLocalTime };
