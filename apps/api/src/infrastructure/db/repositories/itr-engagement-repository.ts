import type { Querier } from '../querier.js';
import { PG_ERROR, SqlBuilder, isPgError } from '../querier.js';
import type { ItrEngagement, ItrStatus } from '../../../domain/itr/itr-engagement.js';
import type { ActorRole } from '../../../domain/appointment/appointment.js';
import type {
  AdminItrQuery,
  CreateItrEngagementInput,
  ItrEngagementRepository,
  ItrEngagementWithUser,
  ItrStatusChange,
  ItrStatusHistoryRow,
} from '../../../application/ports/itr-engagement-repository.js';
import { DuplicateEngagementError } from '../../../application/ports/itr-engagement-repository.js';

interface ItrRow {
  id: string;
  reference: string;
  user_id: string;
  service_id: string;
  status: ItrStatus;
  assessment_year: string;
  itr_form_type: string;
  service_name_snapshot: string;
  amount_paise_snapshot: number;
  pan_number: string | null;
  has_business_income: boolean;
  user_notes: string | null;
  admin_notes: string | null;
  info_requested: string | null;
  acknowledgement_number: string | null;
  filed_at: Date | null;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

type ItrUserRow = ItrRow & {
  user_name: string | null;
  user_email: string;
  user_phone: string | null;
};

const COLUMNS = `id, reference, user_id, service_id, status, assessment_year, itr_form_type,
                 service_name_snapshot, amount_paise_snapshot, pan_number, has_business_income,
                 user_notes, admin_notes, info_requested, acknowledgement_number, filed_at,
                 cancellation_reason, cancelled_at, completed_at, created_at, updated_at`;

const WITH_USER = `e.id, e.reference, e.user_id, e.service_id, e.status, e.assessment_year,
                   e.itr_form_type, e.service_name_snapshot, e.amount_paise_snapshot,
                   e.pan_number, e.has_business_income, e.user_notes, e.admin_notes,
                   e.info_requested, e.acknowledgement_number, e.filed_at,
                   e.cancellation_reason, e.cancelled_at, e.completed_at, e.created_at,
                   e.updated_at,
                   u.full_name as user_name, u.email as user_email, u.phone as user_phone`;

function toEngagement(row: ItrRow): ItrEngagement {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.user_id,
    serviceId: row.service_id,
    status: row.status,
    assessmentYear: row.assessment_year,
    itrFormType: row.itr_form_type,
    serviceName: row.service_name_snapshot,
    amountPaise: row.amount_paise_snapshot,
    panNumber: row.pan_number,
    hasBusinessIncome: row.has_business_income,
    userNotes: row.user_notes,
    adminNotes: row.admin_notes,
    infoRequested: row.info_requested,
    acknowledgementNumber: row.acknowledgement_number,
    filedAt: row.filed_at,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEngagementWithUser(row: ItrUserRow): ItrEngagementWithUser {
  return {
    ...toEngagement(row),
    userName: row.user_name,
    userEmail: row.user_email,
    userPhone: row.user_phone,
  };
}

export class PgItrEngagementRepository implements ItrEngagementRepository {
  constructor(private readonly db: Querier) {}

  async create(input: CreateItrEngagementInput): Promise<ItrEngagement> {
    try {
      const { rows } = await this.db.query<ItrRow>(
        `insert into itr_engagements
           (user_id, service_id, assessment_year, itr_form_type, service_name_snapshot,
            amount_paise_snapshot, has_business_income, user_notes, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${COLUMNS}`,
        [
          input.userId, input.serviceId, input.assessmentYear, input.itrFormType,
          input.serviceName, input.amountPaise, input.hasBusinessIncome,
          input.userNotes, input.idempotencyKey,
        ],
      );
      return toEngagement(rows[0]!);
    } catch (error) {
      // The partial unique index catches two requests racing to register the
      // same assessment year, which the pre-check cannot.
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION, 'itr_one_live_per_year')) {
        throw new DuplicateEngagementError(input.assessmentYear, input.itrFormType);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ItrEngagement | null> {
    const { rows } = await this.db.query<ItrRow>(
      `select ${COLUMNS} from itr_engagements where id = $1`,
      [id],
    );
    return rows[0] ? toEngagement(rows[0]) : null;
  }

  async findByIdWithUser(id: string): Promise<ItrEngagementWithUser | null> {
    const { rows } = await this.db.query<ItrUserRow>(
      `select ${WITH_USER} from itr_engagements e
         join user_profiles u on u.id = e.user_id
        where e.id = $1`,
      [id],
    );
    return rows[0] ? toEngagementWithUser(rows[0]) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<ItrEngagement | null> {
    const { rows } = await this.db.query<ItrRow>(
      `select ${COLUMNS} from itr_engagements where user_id = $1 and idempotency_key = $2`,
      [userId, key],
    );
    return rows[0] ? toEngagement(rows[0]) : null;
  }

  async findLiveFor(
    userId: string,
    assessmentYear: string,
    formType: string,
  ): Promise<ItrEngagement | null> {
    const { rows } = await this.db.query<ItrRow>(
      `select ${COLUMNS} from itr_engagements
        where user_id = $1 and assessment_year = $2 and itr_form_type = $3
          and status not in ('CANCELLED_BY_USER', 'CANCELLED_BY_ADMIN')`,
      [userId, assessmentYear, formType],
    );
    return rows[0] ? toEngagement(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<ItrEngagement[]> {
    const { rows } = await this.db.query<ItrRow>(
      `select ${COLUMNS} from itr_engagements where user_id = $1 order by created_at desc`,
      [userId],
    );
    return rows.map(toEngagement);
  }

  async updateStatus(input: {
    id: string;
    status: ItrStatus;
    infoRequested?: string | null;
    acknowledgementNumber?: string | null;
    filedAt?: Date | null;
    completedAt?: Date | null;
    cancellationReason?: string | null;
    cancelledAt?: Date | null;
  }): Promise<ItrEngagement> {
    const { rows } = await this.db.query<ItrRow>(
      `update itr_engagements set
         status                 = $2,
         info_requested         = case when $3::boolean then $4 else info_requested end,
         acknowledgement_number = coalesce($5, acknowledgement_number),
         filed_at               = coalesce($6, filed_at),
         completed_at           = coalesce($7, completed_at),
         cancellation_reason    = coalesce($8, cancellation_reason),
         cancelled_at           = coalesce($9, cancelled_at)
       where id = $1
       returning ${COLUMNS}`,
      [
        input.id,
        input.status,
        input.infoRequested !== undefined,
        input.infoRequested ?? null,
        input.acknowledgementNumber ?? null,
        input.filedAt ?? null,
        input.completedAt ?? null,
        input.cancellationReason ?? null,
        input.cancelledAt ?? null,
      ],
    );
    return toEngagement(rows[0]!);
  }

  async updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    panNumber?: string | null;
  }): Promise<ItrEngagement> {
    const { rows } = await this.db.query<ItrRow>(
      `update itr_engagements set
         admin_notes = case when $2::boolean then $3 else admin_notes end,
         pan_number  = case when $4::boolean then $5 else pan_number  end
       where id = $1
       returning ${COLUMNS}`,
      [
        input.id,
        input.adminNotes !== undefined,
        input.adminNotes ?? null,
        input.panNumber !== undefined,
        input.panNumber ?? null,
      ],
    );
    return toEngagement(rows[0]!);
  }

  async recordStatusChange(change: ItrStatusChange): Promise<void> {
    await this.db.query(
      `insert into itr_status_history
         (engagement_id, from_status, to_status, changed_by, actor_role, note)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        change.engagementId, change.fromStatus, change.toStatus,
        change.changedBy, change.actorRole, change.note,
      ],
    );
  }

  async historyFor(engagementId: string): Promise<ItrStatusHistoryRow[]> {
    const { rows } = await this.db.query<{
      from_status: ItrStatus | null;
      to_status: ItrStatus;
      actor_role: ActorRole;
      note: string | null;
      created_at: Date;
    }>(
      `select from_status, to_status, actor_role, note, created_at
         from itr_status_history where engagement_id = $1 order by created_at`,
      [engagementId],
    );

    return rows.map((row) => ({
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorRole: row.actor_role,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async listForAdmin(query: AdminItrQuery): Promise<{ rows: ItrEngagementWithUser[]; total: number }> {
    const builder = new SqlBuilder();
    builder.whereIf(query.status, 'e.status = ?', query.status);
    builder.whereIf(query.assessmentYear, 'e.assessment_year = ?', query.assessmentYear);

    if (query.q) {
      const term = `%${query.q.toLowerCase()}%`;
      builder.where(
        `(lower(coalesce(u.full_name, '')) like ? or lower(u.email) like ?
          or lower(e.reference) like ?)`,
        term, term, term,
      );
    }

    const where = builder.build();
    const limit = builder.param(query.pageSize);
    const offset = builder.param((query.page - 1) * query.pageSize);

    const { rows } = await this.db.query<ItrUserRow & { total: number }>(
      `select ${WITH_USER}, count(*) over ()::int as total
         from itr_engagements e
         join user_profiles u on u.id = e.user_id
         ${where}
        order by
          -- engagements waiting on the CA float to the top of the queue
          case e.status
            when 'SUBMITTED' then 0
            when 'IN_REVIEW' then 1
            when 'IN_PROGRESS' then 2
            when 'INFO_REQUESTED' then 3
            else 4
          end,
          e.created_at desc
        limit ${limit} offset ${offset}`,
      builder.params,
    );

    return { rows: rows.map(toEngagementWithUser), total: rows[0]?.total ?? 0 };
  }

  async pipelineCounts(): Promise<Array<{ status: ItrStatus; count: number }>> {
    const { rows } = await this.db.query<{ status: ItrStatus; count: number }>(
      `select status, count(*)::int as count from itr_engagements group by status`,
    );
    return rows;
  }
}
