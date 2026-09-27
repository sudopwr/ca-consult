import type { Address, UserProfile, UserRole, UserStatus } from '../../domain/user/user-profile.js';

export interface ProvisionUserInput {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
}

export interface CompleteProfileInput {
  readonly userId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly address: Address;
  readonly completedAt: Date;
}

export interface UserListQuery {
  readonly q?: string | undefined;
  readonly status?: UserStatus | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface UserListRow extends UserProfile {
  readonly appointmentCount: number;
  readonly engagementCount: number;
  readonly lastActivityAt: Date | null;
}

export interface UserRepository {
  findById(id: string): Promise<UserProfile | null>;

  /**
   * Called on every authenticated request. The first time a Google identity
   * appears we create the row; after that it is a primary-key read.
   *
   * Provisioning on read rather than on a signup webhook means there is no
   * window in which a valid token has no profile behind it.
   */
  findOrProvision(input: ProvisionUserInput): Promise<UserProfile>;

  completeProfile(input: CompleteProfileInput): Promise<UserProfile>;

  setStatus(userId: string, status: UserStatus): Promise<void>;
  setRole(userId: string, role: UserRole): Promise<void>;

  incrementNoShowCount(userId: string): Promise<void>;
  resetNoShowCount(userId: string): Promise<void>;

  list(query: UserListQuery): Promise<{ rows: UserListRow[]; total: number }>;
  countCreatedSince(since: Date): Promise<number>;

  /** The admin's email, for "a client just booked" notifications. */
  findAdminEmails(): Promise<string[]>;
}
