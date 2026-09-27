import type { CaProfile } from '../../domain/ca-profile/ca-profile.js';

export type UpsertCaProfileInput = Omit<CaProfile, 'updatedAt'>;

export interface CaProfileRepository {
  /** Null before the admin has filled it in for the first time. */
  find(): Promise<CaProfile | null>;
  upsert(input: UpsertCaProfileInput): Promise<CaProfile>;
}
