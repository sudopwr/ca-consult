import type { Querier } from '../querier.js';
import { PG_ERROR, SqlBuilder, isPgError } from '../querier.js';
import type { Appointment, AppointmentStatus, ActorRole } from '../../../domain/appointment/appointment.js';
import type { TimeRange } from '../../../domain/scheduling/time-range.js';
import { addDays, instantToLocalDate, zonedToInstant } from '../../../domain/shared/time.js';
import type {
  AdminAppointmentQuery,
  AppointmentRepository,
  AppointmentStatusHistoryRow,
  AppointmentWithUser,
  CreateAppointmentInput,
  StatusChange,
} from '../../../application/ports/appointment-repository.js';
import {
  DuplicateIdempotencyKeyError,
  SlotTakenError,
} from '../../../application/ports/appointment-repository.js';

interface AppointmentRow {
  id: string;
  reference: string;
  user_id: string;
  service_id: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  meeting_url: string;
  service_name_snapshot: string;
  amount_paise_snapshot: number;
  user_notes: string | null;
  admin_notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  superseded_by: string | null;
  created_at: Date;
}

type AppointmentUserRow = AppointmentRow & {
  user_name: string | null;
  user_email: string;
  user_phone: string | null;
};

const COLUMNS = `id, reference, user_id, service_id, starts_at, ends_at, status, meeting_url,
                 service_name_snapshot, amount_paise_snapshot, user_notes, admin_notes,
                 cancellation_reason, cancelled_at, completed_at, superseded_by, created_at`;

const WITH_USER = `a.id, a.reference, a.user_id, a.service_id, a.starts_at, a.ends_at, a.status,
                   a.meeting_url, a.service_name_snapshot, a.amount_paise_snapshot, a.user_notes,
                   a.admin_notes, a.cancellation_reason, a.cancelled_at, a.completed_at,
                   a.superseded_by, a.created_at,
                   u.full_name as user_name, u.email as user_email, u.phone as user_phone`;

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.user_id,
    serviceId: row.service_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    meetingUrl: row.meeting_url,
    serviceName: row.service_name_snapshot,
    amountPaise: row.amount_paise_snapshot,
    userNotes: row.user_notes,
    adminNotes: row.admin_notes,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
  };
}

function toAppointmentWithUser(row: AppointmentUserRow): AppointmentWithUser {
  return {
    ...toAppointment(row),
    userName: row.user_name,
    userEmail: row.user_email,
    userPhone: row.user_phone,
  };
}

export class PgAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: Querier) {}

  /**
   * The insert that the exclusion constraint guards.
   *
   * Two users clicking the same 11:00 slot in the same millisecond both reach
   * here; Postgres lets exactly one commit and raises 23P01 for the other. We
   * translate that into a typed error so the use case never has to know a
   * SQLSTATE, and the UI can turn it into "someone just took that slot".
   */
  async create(input: CreateAppointmentInput): Promise<Appointment> {
    try {
      const { rows } = await this.db.query<AppointmentRow>(
        `insert into appointments
           (user_id, service_id, starts_at, ends_at, meeting_url,
            service_name_snapshot, amount_paise_snapshot, user_notes, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${COLUMNS}`,
        [
          input.userId,
          input.serviceId,
          input.startsAt,
          input.endsAt,
          input.meetingUrl,
          input.serviceName,
          input.amountPaise,
          input.userNotes,
          input.idempotencyKey,
        ],
      );
      return toAppointment(rows[0]!);
    } catch (error) {
      if (isPgError(error, PG_ERROR.EXCLUSION_VIOLATION)) {
        throw new SlotTakenError(input.startsAt);
      }
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION, 'appointments_idempotency_key')) {
        const existing = await this.findByIdempotencyKey(input.userId, input.idempotencyKey!);
        throw new DuplicateIdempotencyKeyError(existing?.id ?? '');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Appointment | null> {
    const { rows } = await this.db.query<AppointmentRow>(
      `select ${COLUMNS} from appointments where id = $1`,
      [id],
    );
    return rows[0] ? toAppointment(rows[0]) : null;
  }

  async findByIdWithUser(id: string): Promise<AppointmentWithUser | null> {
    const { rows } = await this.db.query<AppointmentUserRow>(
      `select ${WITH_USER} from appointments a
         join user_profiles u on u.id = a.user_id
        where a.id = $1`,
      [id],
    );
    return rows[0] ? toAppointmentWithUser(rows[0]) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Appointment | null> {
    const { rows } = await this.db.query<AppointmentRow>(
      `select ${COLUMNS} from appointments where user_id = $1 and idempotency_key = $2`,
      [userId, key],
    );
    return rows[0] ? toAppointment(rows[0]) : null;
  }

  /** What the slot generator subtracts. Only confirmed appointments block a slot. */
  async findBusyRanges(from: Date, to: Date): Promise<TimeRange[]> {
    const { rows } = await this.db.query<{ starts_at: Date; ends_at: Date }>(
      `select starts_at, ends_at from appointments
        where status = 'CONFIRMED' and slot && tstzrange($1, $2, '[)')`,
      [from, to],
    );
    return rows.map((row) => ({ start: row.starts_at, end: row.ends_at }));
  }

  async findConfirmedInRange(from: Date, to: Date): Promise<AppointmentWithUser[]> {
    const { rows } = await this.db.query<AppointmentUserRow>(
      `select ${WITH_USER} from appointments a
         join user_profiles u on u.id = a.user_id
        where a.status = 'CONFIRMED' and a.starts_at >= $1 and a.starts_at < $2
        order by a.starts_at`,
      [from, to],
    );
    return rows.map(toAppointmentWithUser);
  }

  async listForUser(userId: string): Promise<Appointment[]> {
    const { rows } = await this.db.query<AppointmentRow>(
      `select ${COLUMNS} from appointments where user_id = $1 order by starts_at desc`,
      [userId],
    );
    return rows.map(toAppointment);
  }

  async countUpcomingForUser(userId: string, now: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from appointments
        where user_id = $1 and status = 'CONFIRMED' and starts_at > $2`,
      [userId, now],
    );
    return rows[0]?.count ?? 0;
  }

  async countCreatedForUserOnDay(userId: string, dayStart: Date, dayEnd: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from appointments
        where user_id = $1 and created_at >= $2 and created_at < $3`,
      [userId, dayStart, dayEnd],
    );
    return rows[0]?.count ?? 0;
  }

  async updateStatus(input: {
    id: string;
    status: AppointmentStatus;
    cancellationReason?: string | null;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
    supersededBy?: string | null;
  }): Promise<Appointment> {
    const { rows } = await this.db.query<AppointmentRow>(
      `update appointments
          set status              = $2,
              cancellation_reason = coalesce($3, cancellation_reason),
              cancelled_at        = coalesce($4, cancelled_at),
              completed_at        = coalesce($5, completed_at),
              superseded_by       = coalesce($6, superseded_by)
        where id = $1
        returning ${COLUMNS}`,
      [
        input.id,
        input.status,
        input.cancellationReason ?? null,
        input.cancelledAt ?? null,
        input.completedAt ?? null,
        input.supersededBy ?? null,
      ],
    );
    return toAppointment(rows[0]!);
  }

  async updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    meetingUrl?: string | null;
  }): Promise<Appointment> {
    const { rows } = await this.db.query<AppointmentRow>(
      `update appointments
          set admin_notes = case when $2::boolean then $3 else admin_notes end,
              meeting_url = coalesce($4, meeting_url)
        where id = $1
        returning ${COLUMNS}`,
      [
        input.id,
        input.adminNotes !== undefined,
        input.adminNotes ?? null,
        input.meetingUrl ?? null,
      ],
    );
    return toAppointment(rows[0]!);
  }

  async recordStatusChange(change: StatusChange): Promise<void> {
    await this.db.query(
      `insert into appointment_status_history
         (appointment_id, from_status, to_status, changed_by, actor_role, note)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        change.appointmentId,
        change.fromStatus,
        change.toStatus,
        change.changedBy,
        change.actorRole,
        change.note,
      ],
    );
  }

  async historyFor(appointmentId: string): Promise<AppointmentStatusHistoryRow[]> {
    const { rows } = await this.db.query<{
      from_status: AppointmentStatus | null;
      to_status: AppointmentStatus;
      actor_role: ActorRole;
      note: string | null;
      created_at: Date;
    }>(
      `select from_status, to_status, actor_role, note, created_at
         from appointment_status_history
        where appointment_id = $1
        order by created_at`,
      [appointmentId],
    );

    return rows.map((row) => ({
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorRole: row.actor_role,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async listForAdmin(
    query: AdminAppointmentQuery,
  ): Promise<{ rows: AppointmentWithUser[]; total: number }> {
    const builder = new SqlBuilder();

    builder.whereIf(query.status, 'a.status = ?', query.status);
    builder.whereIf(query.serviceId, 'a.service_id = ?', query.serviceId);

    if (query.scope === 'today') {
      const today = instantToLocalDate(query.now, query.timeZone);
      builder.where(
        'a.starts_at >= ? and a.starts_at < ?',
        zonedToInstant(today, '00:00', query.timeZone),
        zonedToInstant(addDays(today, 1), '00:00', query.timeZone),
      );
    } else if (query.scope === 'upcoming') {
      builder.where('a.starts_at >= ?', query.now);
    } else if (query.scope === 'past') {
      builder.where('a.starts_at < ?', query.now);
    }

    builder.whereIf(query.from, 'a.starts_at >= ?', query.from);
    builder.whereIf(query.to, 'a.starts_at <= ?', query.to);

    if (query.q) {
      const term = `%${query.q.toLowerCase()}%`;
      builder.where(
        `(lower(coalesce(u.full_name, '')) like ? or lower(u.email) like ?
          or lower(a.reference) like ? or coalesce(u.phone, '') like ?)`,
        term,
        term,
        term,
        term,
      );
    }

    const where = builder.build();
    const limit = builder.param(query.pageSize);
    const offset = builder.param((query.page - 1) * query.pageSize);
    const order = query.scope === 'past' ? 'desc' : 'asc';

    const { rows } = await this.db.query<AppointmentUserRow & { total: number }>(
      `select ${WITH_USER}, count(*) over ()::int as total
         from appointments a
         join user_profiles u on u.id = a.user_id
         ${where}
        order by a.starts_at ${order}
        limit ${limit} offset ${offset}`,
      builder.params,
    );

    return { rows: rows.map(toAppointmentWithUser), total: rows[0]?.total ?? 0 };
  }

  async countUpcomingBetween(from: Date, to: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from appointments
        where status = 'CONFIRMED' and starts_at >= $1 and starts_at <= $2`,
      [from, to],
    );
    return rows[0]?.count ?? 0;
  }

  async findNeedingReminder(from: Date, to: Date): Promise<AppointmentWithUser[]> {
    return this.findConfirmedInRange(from, to);
  }
}
