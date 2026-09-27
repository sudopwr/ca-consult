import type { Service, ServiceKind } from '../../domain/service/service.js';

export interface UpsertServiceInput {
  readonly kind: ServiceKind;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly amountPaise: number;
  readonly durationMinutes: number | null;
  readonly assessmentYear: string | null;
  readonly itrFormType: string | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface ServiceRepository {
  findById(id: string): Promise<Service | null>;
  findBySlug(slug: string): Promise<Service | null>;
  listActive(kind?: ServiceKind): Promise<Service[]>;
  listAll(kind?: ServiceKind): Promise<Service[]>;
  create(input: UpsertServiceInput): Promise<Service>;
  update(id: string, input: UpsertServiceInput): Promise<Service>;
  /** Soft delete — a service referenced by history is deactivated, not removed. */
  deactivate(id: string): Promise<void>;
  isReferenced(id: string): Promise<boolean>;
  hardDelete(id: string): Promise<void>;
}
