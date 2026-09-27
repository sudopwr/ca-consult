import type { AvailabilityRule } from '../../domain/scheduling/availability-rule.js';
import type { ScheduleException, ExceptionKind } from '../../domain/scheduling/schedule-exception.js';
import type { LocalDate } from '../../domain/shared/time.js';

export interface UpsertAvailabilityRuleInput {
  readonly dayOfWeek: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly slotMinutes: number;
  readonly bufferMinutes: number;
  readonly effectiveFrom: LocalDate;
  readonly effectiveTo: LocalDate | null;
  readonly isActive: boolean;
}

export interface CreateScheduleExceptionInput {
  readonly kind: ExceptionKind;
  readonly onDate: LocalDate;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly reason: string | null;
}

export interface AvailabilityRepository {
  listRules(): Promise<AvailabilityRule[]>;
  findRule(id: string): Promise<AvailabilityRule | null>;
  createRule(input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule>;
  updateRule(id: string, input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule>;
  deleteRule(id: string): Promise<void>;

  listExceptions(from: LocalDate, to: LocalDate): Promise<ScheduleException[]>;
  listUpcomingExceptions(from: LocalDate): Promise<ScheduleException[]>;
  createException(input: CreateScheduleExceptionInput): Promise<ScheduleException>;
  deleteException(id: string): Promise<void>;
}
