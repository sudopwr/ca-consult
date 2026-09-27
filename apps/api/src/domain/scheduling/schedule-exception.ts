import type { LocalDate, LocalTime } from '../shared/time.js';

/**
 * A one-off override on a specific date.
 *
 * BLOCKED with no times means the whole day is off — a holiday, a court date.
 * BLOCKED with times carves a hole out of the normal windows. EXTRA opens time
 * that the weekly rules do not cover, such as a Saturday before the filing
 * deadline.
 */
export type ExceptionKind = 'BLOCKED' | 'EXTRA';

export interface ScheduleException {
  readonly id: string;
  readonly kind: ExceptionKind;
  readonly onDate: LocalDate;
  readonly startTime: LocalTime | null;
  readonly endTime: LocalTime | null;
  readonly reason: string | null;
}

export function isWholeDayBlock(exception: ScheduleException): boolean {
  return exception.kind === 'BLOCKED' && exception.startTime === null;
}

export function exceptionsOn(
  exceptions: readonly ScheduleException[],
  date: LocalDate,
): ScheduleException[] {
  return exceptions.filter((e) => e.onDate === date);
}
