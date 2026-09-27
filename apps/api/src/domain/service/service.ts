export type ServiceKind = 'CONSULTANCY' | 'ITR_FILING';

export interface Service {
  readonly id: string;
  readonly kind: ServiceKind;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly amountPaise: number;
  readonly currency: string;
  readonly durationMinutes: number | null;
  readonly assessmentYear: string | null;
  readonly itrFormType: string | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export function isBookable(service: Service): boolean {
  return service.kind === 'CONSULTANCY' && service.isActive && service.durationMinutes !== null;
}

export function isRegistrable(service: Service): boolean {
  return (
    service.kind === 'ITR_FILING' &&
    service.isActive &&
    service.assessmentYear !== null &&
    service.itrFormType !== null
  );
}

/** Duration for slot generation. Non-consultancy services have none. */
export function bookingDuration(service: Service): number | null {
  return service.kind === 'CONSULTANCY' ? service.durationMinutes : null;
}
