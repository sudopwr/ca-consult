import type { ItrEngagement, ItrStatus } from '../../domain/itr/itr-engagement.js';
import type { ActorRole } from '../../domain/appointment/appointment.js';

export interface CreateItrEngagementInput {
  readonly userId: string;
  readonly serviceId: string;
  readonly assessmentYear: string;
  readonly itrFormType: string;
  readonly serviceName: string;
  readonly amountPaise: number;
  readonly hasBusinessIncome: boolean;
  readonly userNotes: string | null;
  readonly idempotencyKey: string | null;
}

export interface ItrEngagementWithUser extends ItrEngagement {
  readonly userName: string | null;
  readonly userEmail: string;
  readonly userPhone: string | null;
}

export interface ItrStatusChange {
  readonly engagementId: string;
  readonly fromStatus: ItrStatus | null;
  readonly toStatus: ItrStatus;
  readonly changedBy: string | null;
  readonly actorRole: ActorRole;
  readonly note: string | null;
}

export interface ItrStatusHistoryRow {
  readonly fromStatus: ItrStatus | null;
  readonly toStatus: ItrStatus;
  readonly actorRole: ActorRole;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface AdminItrQuery {
  readonly status?: ItrStatus | undefined;
  readonly assessmentYear?: string | undefined;
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

/** Raised by the partial unique index on (user, assessment year, form type). */
export class DuplicateEngagementError extends Error {
  constructor(
    readonly assessmentYear: string,
    readonly formType: string,
  ) {
    super('duplicate live engagement');
    this.name = 'DuplicateEngagementError';
  }
}

export interface ItrEngagementRepository {
  create(input: CreateItrEngagementInput): Promise<ItrEngagement>;

  findById(id: string): Promise<ItrEngagement | null>;
  findByIdWithUser(id: string): Promise<ItrEngagementWithUser | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<ItrEngagement | null>;

  findLiveFor(userId: string, assessmentYear: string, formType: string): Promise<ItrEngagement | null>;

  listForUser(userId: string): Promise<ItrEngagement[]>;

  updateStatus(input: {
    id: string;
    status: ItrStatus;
    infoRequested?: string | null;
    acknowledgementNumber?: string | null;
    filedAt?: Date | null;
    completedAt?: Date | null;
    cancellationReason?: string | null;
    cancelledAt?: Date | null;
  }): Promise<ItrEngagement>;

  updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    panNumber?: string | null;
  }): Promise<ItrEngagement>;

  recordStatusChange(change: ItrStatusChange): Promise<void>;
  historyFor(engagementId: string): Promise<ItrStatusHistoryRow[]>;

  listForAdmin(query: AdminItrQuery): Promise<{ rows: ItrEngagementWithUser[]; total: number }>;

  /** Counts by status, for the admin dashboard pipeline. */
  pipelineCounts(): Promise<Array<{ status: ItrStatus; count: number }>>;
}
