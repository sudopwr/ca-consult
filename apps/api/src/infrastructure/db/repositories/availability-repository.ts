import type { Querier } from '../querier.js';
import type { AvailabilityRule } from '../../../domain/scheduling/availability-rule.js';
import type { ExceptionKind, ScheduleException } from '../../../domain/scheduling/schedule-exception.js';
import type { LocalDate } from '../../../domain/shared/time.js';
import type {
  AvailabilityRepository,
  CreateScheduleExceptionInput,
  UpsertAvailabilityRuleInput,
} from '../../../application/ports/availability-repository.js';

interface RuleRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  buffer_minutes: number;
  effective_from: Date | string;
  effective_to: Date | string | null;
  is_active: boolean;
}

interface ExceptionRow {
  id: string;
  kind: ExceptionKind;
  on_date: Date | string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

/**
 * `date` and `time` columns come back as strings or Dates depending on the
 * driver's type parsers. The domain works in plain 'YYYY-MM-DD' and 'HH:MM',
 * so normalise on the way out rather than leaving two shapes in play.
 */
function toLocalDate(value: Date | string): LocalDate {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toLocalTime(value: string): string {
  return value.slice(0, 5);
}

function toRule(row: RuleRow): AvailabilityRule {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    startTime: toLocalTime(row.start_time),
    endTime: toLocalTime(row.end_time),
    slotMinutes: row.slot_minutes,
    bufferMinutes: row.buffer_minutes,
    effectiveFrom: toLocalDate(row.effective_from),
    effectiveTo: row.effective_to ? toLocalDate(row.effective_to) : null,
    isActive: row.is_active,
  };
}

function toException(row: ExceptionRow): ScheduleException {
  return {
    id: row.id,
    kind: row.kind,
    onDate: toLocalDate(row.on_date),
    startTime: row.start_time ? toLocalTime(row.start_time) : null,
    endTime: row.end_time ? toLocalTime(row.end_time) : null,
    reason: row.reason,
  };
}

const RULE_COLUMNS = `id, day_of_week, start_time::text, end_time::text, slot_minutes,
                      buffer_minutes, effective_from::text, effective_to::text, is_active`;
const EXCEPTION_COLUMNS = `id, kind, on_date::text, start_time::text, end_time::text, reason`;

export class PgAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly db: Querier) {}

  async listRules(): Promise<AvailabilityRule[]> {
    const { rows } = await this.db.query<RuleRow>(
      `select ${RULE_COLUMNS} from availability_rules order by day_of_week, start_time`,
    );
    return rows.map(toRule);
  }

  async findRule(id: string): Promise<AvailabilityRule | null> {
    const { rows } = await this.db.query<RuleRow>(
      `select ${RULE_COLUMNS} from availability_rules where id = $1`,
      [id],
    );
    return rows[0] ? toRule(rows[0]) : null;
  }

  async createRule(input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule> {
    const { rows } = await this.db.query<RuleRow>(
      `insert into availability_rules
         (day_of_week, start_time, end_time, slot_minutes, buffer_minutes,
          effective_from, effective_to, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${RULE_COLUMNS}`,
      [
        input.dayOfWeek, input.startTime, input.endTime, input.slotMinutes,
        input.bufferMinutes, input.effectiveFrom, input.effectiveTo, input.isActive,
      ],
    );
    return toRule(rows[0]!);
  }

  async updateRule(id: string, input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule> {
    const { rows } = await this.db.query<RuleRow>(
      `update availability_rules set
         day_of_week = $2, start_time = $3, end_time = $4, slot_minutes = $5,
         buffer_minutes = $6, effective_from = $7, effective_to = $8, is_active = $9
       where id = $1
       returning ${RULE_COLUMNS}`,
      [
        id, input.dayOfWeek, input.startTime, input.endTime, input.slotMinutes,
        input.bufferMinutes, input.effectiveFrom, input.effectiveTo, input.isActive,
      ],
    );
    return toRule(rows[0]!);
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.query('delete from availability_rules where id = $1', [id]);
  }

  async listExceptions(from: LocalDate, to: LocalDate): Promise<ScheduleException[]> {
    const { rows } = await this.db.query<ExceptionRow>(
      `select ${EXCEPTION_COLUMNS} from schedule_exceptions
        where on_date between $1::date and $2::date
        order by on_date, start_time nulls first`,
      [from, to],
    );
    return rows.map(toException);
  }

  async listUpcomingExceptions(from: LocalDate): Promise<ScheduleException[]> {
    const { rows } = await this.db.query<ExceptionRow>(
      `select ${EXCEPTION_COLUMNS} from schedule_exceptions
        where on_date >= $1::date
        order by on_date, start_time nulls first`,
      [from],
    );
    return rows.map(toException);
  }

  async createException(input: CreateScheduleExceptionInput): Promise<ScheduleException> {
    const { rows } = await this.db.query<ExceptionRow>(
      `insert into schedule_exceptions (kind, on_date, start_time, end_time, reason)
       values ($1, $2, $3, $4, $5)
       returning ${EXCEPTION_COLUMNS}`,
      [input.kind, input.onDate, input.startTime, input.endTime, input.reason],
    );
    return toException(rows[0]!);
  }

  async deleteException(id: string): Promise<void> {
    await this.db.query('delete from schedule_exceptions where id = $1', [id]);
  }
}
