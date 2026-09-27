import type { Appointment, AppointmentStatus, ActorRole } from '../../domain/appointment/appointment.js';
import type { TimeRange } from '../../domain/scheduling/time-range.js';

export interface CreateAppointmentInput {
  readonly userId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly meetingUrl: string;
  readonly serviceName: string;
  readonly amountPaise: number;
  readonly userNotes: string | null;
  readonly idempotencyKey: string | null;
}

export interface AppointmentWithUser extends Appointment {
  readonly userName: string | null;
  readonly userEmail: string;
  readonly userPhone: string | null;
}

export interface StatusChange {
  readonly appointmentId: string;
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus;
  readonly changedBy: string | null;
  readonly actorRole: ActorRole;
  readonly note: string | null;
}

export interface AppointmentStatusHistoryRow {
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus;
  readonly actorRole: ActorRole;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface AdminAppointmentQuery {
  readonly status?: AppointmentStatus | undefined;
  readonly scope: 'today' | 'upcoming' | 'past' | 'all';
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly serviceId?: string | undefined;
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
  readonly now: Date;
  readonly timeZone: string;
}

/**
 * Thrown by `create` when the database's exclusion constraint rejects the
 * insert (SQLSTATE 23P01). The repository translates the Postgres error so the
 * use case never has to know a SQLSTATE — but the race itself is real and the
 * use case does have to handle it.
 */
export class SlotTakenError extends Error {
  constructor(readonly startsAt: Date) {
    super('slot taken');
    this.name = 'SlotTakenError';
  }
}

/** Thrown when an idempotency key has already been used by this user. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(readonly existingId: string) {
    super('idempotency key already used');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export interface AppointmentRepository {
  create(input: CreateAppointmentInput): Promise<Appointment>;

  findById(id: string): Promise<Appointment | null>;
  findByIdWithUser(id: string): Promise<AppointmentWithUser | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<Appointment | null>;

  /** Confirmed appointments in a window — what the slot generator subtracts. */
  findBusyRanges(from: Date, to: Date): Promise<TimeRange[]>;

  findConfirmedInRange(from: Date, to: Date): Promise<AppointmentWithUser[]>;

  listForUser(userId: string): Promise<Appointment[]>;
  countUpcomingForUser(userId: string, now: Date): Promise<number>;
  countCreatedForUserOnDay(userId: string, dayStart: Date, dayEnd: Date): Promise<number>;

  updateStatus(input: {
    id: string;
    status: AppointmentStatus;
    cancellationReason?: string | null;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
    supersededBy?: string | null;
  }): Promise<Appointment>;

  updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    meetingUrl?: string | null;
  }): Promise<Appointment>;

  recordStatusChange(change: StatusChange): Promise<void>;
  historyFor(appointmentId: string): Promise<AppointmentStatusHistoryRow[]>;

  listForAdmin(query: AdminAppointmentQuery): Promise<{ rows: AppointmentWithUser[]; total: number }>;

  countUpcomingBetween(from: Date, to: Date): Promise<number>;

  /** Confirmed appointments starting in a window — drives the 24h reminder sweep. */
  findNeedingReminder(from: Date, to: Date): Promise<AppointmentWithUser[]>;
}
