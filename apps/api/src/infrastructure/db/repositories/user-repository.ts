import type { Querier } from '../querier.js';
import { SqlBuilder } from '../querier.js';
import type { UserProfile, UserRole, UserStatus } from '../../../domain/user/user-profile.js';
import type {
  CompleteProfileInput,
  ProvisionUserInput,
  UserListQuery,
  UserListRow,
  UserRepository,
} from '../../../application/ports/user-repository.js';

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  no_show_count: number;
  profile_completed_at: Date | null;
  created_at: Date;
}

export function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    address: row.address_line1
      ? {
          line1: row.address_line1,
          line2: row.address_line2,
          city: row.city ?? '',
          state: row.state ?? '',
          pincode: row.pincode ?? '',
        }
      : null,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    noShowCount: row.no_show_count,
    profileCompletedAt: row.profile_completed_at,
    createdAt: row.created_at,
  };
}

const COLUMNS = `id, email, full_name, phone, address_line1, address_line2, city, state,
                 pincode, avatar_url, role, status, no_show_count, profile_completed_at, created_at`;

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Querier) {}

  async findById(id: string): Promise<UserProfile | null> {
    const { rows } = await this.db.query<UserRow>(
      `select ${COLUMNS} from user_profiles where id = $1`,
      [id],
    );
    return rows[0] ? toUserProfile(rows[0]) : null;
  }

  /**
   * Provision-on-read. The first time a Google identity presents a valid
   * token we create the row; after that it is a primary-key lookup.
   *
   * `on conflict do update` rather than `do nothing` so the avatar and display
   * name track what Google currently says — but note it never touches
   * `full_name` once the user has completed onboarding, because the name they
   * typed is the one the practice should use on correspondence.
   */
  async findOrProvision(input: ProvisionUserInput): Promise<UserProfile> {
    const { rows } = await this.db.query<UserRow>(
      `insert into user_profiles (id, email, full_name, avatar_url)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set email      = excluded.email,
             avatar_url = coalesce(excluded.avatar_url, user_profiles.avatar_url),
             full_name  = case
                            when user_profiles.profile_completed_at is null
                            then coalesce(excluded.full_name, user_profiles.full_name)
                            else user_profiles.full_name
                          end
       returning ${COLUMNS}`,
      [input.id, input.email, input.fullName, input.avatarUrl],
    );
    return toUserProfile(rows[0]!);
  }

  async completeProfile(input: CompleteProfileInput): Promise<UserProfile> {
    const { rows } = await this.db.query<UserRow>(
      `update user_profiles
          set full_name = $2, phone = $3, address_line1 = $4, address_line2 = $5,
              city = $6, state = $7, pincode = $8,
              profile_completed_at = coalesce(profile_completed_at, $9)
        where id = $1
        returning ${COLUMNS}`,
      [
        input.userId,
        input.fullName,
        input.phone,
        input.address.line1,
        input.address.line2,
        input.address.city,
        input.address.state,
        input.address.pincode,
        input.completedAt,
      ],
    );
    return toUserProfile(rows[0]!);
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.db.query('update user_profiles set status = $2 where id = $1', [userId, status]);
  }

  async setRole(userId: string, role: UserRole): Promise<void> {
    await this.db.query('update user_profiles set role = $2 where id = $1', [userId, role]);
  }

  async incrementNoShowCount(userId: string): Promise<void> {
    await this.db.query(
      'update user_profiles set no_show_count = no_show_count + 1 where id = $1',
      [userId],
    );
  }

  async resetNoShowCount(userId: string): Promise<void> {
    await this.db.query('update user_profiles set no_show_count = 0 where id = $1', [userId]);
  }

  async list(query: UserListQuery): Promise<{ rows: UserListRow[]; total: number }> {
    const builder = new SqlBuilder();
    builder.whereIf(query.status, 'u.status = ?', query.status);
    if (query.q) {
      const term = `%${query.q.toLowerCase()}%`;
      builder.where(
        '(lower(u.email) like ? or lower(coalesce(u.full_name, \'\')) like ? or coalesce(u.phone, \'\') like ?)',
        term,
        term,
        term,
      );
    }

    const where = builder.build();
    const limit = builder.param(query.pageSize);
    const offset = builder.param((query.page - 1) * query.pageSize);

    // One query for the page and its counts. The lateral joins keep the
    // per-user aggregates from turning into a cartesian product.
    const { rows } = await this.db.query<UserRow & {
      appointment_count: number;
      engagement_count: number;
      last_activity_at: Date | null;
      total: number;
    }>(
      `select u.id, u.email, u.full_name, u.phone, u.address_line1, u.address_line2, u.city,
              u.state, u.pincode, u.avatar_url, u.role, u.status, u.no_show_count,
              u.profile_completed_at, u.created_at,
              coalesce(a.count, 0)::int as appointment_count,
              coalesce(e.count, 0)::int as engagement_count,
              greatest(a.last_at, e.last_at) as last_activity_at,
              count(*) over ()::int as total
         from user_profiles u
         left join lateral (
           select count(*)::int as count, max(created_at) as last_at
             from appointments where user_id = u.id
         ) a on true
         left join lateral (
           select count(*)::int as count, max(created_at) as last_at
             from itr_engagements where user_id = u.id
         ) e on true
         ${where.replace(/\bu\./g, 'u.')}
        order by u.created_at desc
        limit ${limit} offset ${offset}`,
      builder.params,
    );

    return {
      rows: rows.map((row) => ({
        ...toUserProfile(row),
        appointmentCount: row.appointment_count,
        engagementCount: row.engagement_count,
        lastActivityAt: row.last_activity_at,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  async countCreatedSince(since: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      'select count(*)::int as count from user_profiles where created_at >= $1',
      [since],
    );
    return rows[0]?.count ?? 0;
  }

  async findAdminEmails(): Promise<string[]> {
    const { rows } = await this.db.query<{ email: string }>(
      "select email from user_profiles where role = 'ADMIN' and status = 'ACTIVE'",
    );
    return rows.map((row) => row.email);
  }
}
