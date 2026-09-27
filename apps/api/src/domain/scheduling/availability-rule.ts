import type { LocalDate, LocalTime } from '../shared/time.js';
import { compareLocalDate, dayOfWeek } from '../shared/time.js';

/**
 * A recurring weekly opening: "Tuesdays, 10:00 to 13:00, in 30-minute slots
 * with a 5-minute gap after each".
 *
 * `effectiveFrom`/`effectiveTo` let the practice change its hours without
 * destroying the record of what the hours used to be — which matters when you
 * are looking at why an appointment six weeks ago was allowed.
 */
export interface AvailabilityRule {
  readonly id: string;
  readonly dayOfWeek: number; // 0 = Sunday
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
  readonly slotMinutes: number;
  readonly bufferMinutes: number;
  readonly effectiveFrom: LocalDate;
  readonly effectiveTo: LocalDate | null;
  readonly isActive: boolean;
}

export function ruleAppliesOn(rule: AvailabilityRule, date: LocalDate): boolean {
  if (!rule.isActive) return false;
  if (rule.dayOfWeek !== dayOfWeek(date)) return false;
  if (compareLocalDate(date, rule.effectiveFrom) < 0) return false;
  if (rule.effectiveTo && compareLocalDate(date, rule.effectiveTo) > 0) return false;
  return true;
}

export function rulesFor(rules: readonly AvailabilityRule[], date: LocalDate): AvailabilityRule[] {
  return rules.filter((rule) => ruleAppliesOn(rule, date));
}
