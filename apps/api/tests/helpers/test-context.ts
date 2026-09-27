/**
 * A fluent builder for a fully-wired application, in memory.
 *
 * Every use-case test starts here. Because it wires the real use cases against
 * real (in-memory) port implementations and a fake clock, the tests exercise
 * the actual control flow — not a mock's idea of it — while still running in
 * microseconds.
 */

import { randomUUID } from 'node:crypto';
import type { UserProfile } from '../../src/domain/user/user-profile.js';
import type { Service } from '../../src/domain/service/service.js';
import type { CaProfile } from '../../src/domain/ca-profile/ca-profile.js';
import type { AvailabilityRule } from '../../src/domain/scheduling/availability-rule.js';
import type { ScheduleException } from '../../src/domain/scheduling/schedule-exception.js';
import { DEFAULT_BOOKING_POLICY } from '../../src/domain/appointment/booking-policy.js';
import type { BookingPolicy } from '../../src/domain/appointment/booking-policy.js';
import type { Repositories } from '../../src/application/ports/unit-of-work.js';

import { FakeClock } from '../fakes/fake-clock.js';
import { AlwaysPassCaptcha, AlwaysFailCaptcha } from '../fakes/fake-captcha.js';
import {
  InMemoryAppointmentRepository,
  InMemoryAuditLog,
  InMemoryAvailabilityRepository,
  InMemoryCaProfileRepository,
  InMemoryContactEnquiryRepository,
  InMemoryItrEngagementRepository,
  InMemoryMessageRepository,
  InMemoryOutbox,
  InMemoryServiceRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from '../fakes/in-memory-repositories.js';

import { BookAppointment } from '../../src/application/use-cases/book-appointment.js';
import { CancelAppointment } from '../../src/application/use-cases/cancel-appointment.js';
import { RescheduleAppointment } from '../../src/application/use-cases/reschedule-appointment.js';
import { UpdateAppointment } from '../../src/application/use-cases/update-appointment.js';
import { ListAvailableSlots } from '../../src/application/use-cases/list-available-slots.js';
import { CompleteUserProfile } from '../../src/application/use-cases/complete-user-profile.js';
import { RegisterItrEngagement } from '../../src/application/use-cases/register-itr-engagement.js';
import { AdvanceItrEngagement } from '../../src/application/use-cases/advance-itr-engagement.js';
import { StartThread, PostMessage } from '../../src/application/use-cases/messaging.js';
import { SubmitContactEnquiry } from '../../src/application/use-cases/submit-contact-enquiry.js';
import { GetMyEngagements } from '../../src/application/use-cases/get-my-engagements.js';

export const IST = 'Asia/Kolkata';
export const DEFAULT_NOW = '2026-09-16T09:00:00+05:30';

export function aUser(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: over.id ?? randomUUID(),
    email: 'client@example.test',
    fullName: 'Ananya Rao',
    phone: '+919876543210',
    address: {
      line1: '12 Sunder Nagar',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    },
    avatarUrl: null,
    role: 'USER',
    status: 'ACTIVE',
    noShowCount: 0,
    profileCompletedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

export function aConsultation(over: Partial<Service> = {}): Service {
  return {
    id: over.id ?? randomUUID(),
    kind: 'CONSULTANCY',
    name: 'Tax Planning Consultation',
    slug: 'tax-planning',
    description: null,
    amountPaise: 149900,
    currency: 'INR',
    durationMinutes: 30,
    assessmentYear: null,
    itrFormType: null,
    isActive: true,
    sortOrder: 1,
    ...over,
  };
}

export function anItrService(over: Partial<Service> = {}): Service {
  return {
    id: over.id ?? randomUUID(),
    kind: 'ITR_FILING',
    name: 'ITR-1 · Salaried',
    slug: 'itr-1-salaried',
    description: null,
    amountPaise: 99900,
    currency: 'INR',
    durationMinutes: null,
    assessmentYear: 'AY 2026-27',
    itrFormType: 'ITR-1',
    isActive: true,
    sortOrder: 10,
    ...over,
  };
}

export function aCaProfile(over: Partial<CaProfile> = {}): CaProfile {
  return {
    fullName: 'S. Mehta',
    headline: 'Chartered Accountant',
    membershipNumber: '123456',
    firmName: 'Mehta & Associates',
    bio: null,
    photoUrl: null,
    yearsExperience: 14,
    qualifications: ['CA'],
    specialisations: ['ITR Filing'],
    languages: ['English'],
    officeAddress: null,
    googleMapsUrl: null,
    contactEmail: 'contact@example.test',
    contactPhone: null,
    whatsappNumber: null,
    linkedinUrl: null,
    defaultMeetingUrl: 'https://meet.example/ca-room',
    timezone: IST,
    isPublished: true,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

export class TestContextBuilder {
  private readonly users = new InMemoryUserRepository();
  private readonly caProfileRepo = new InMemoryCaProfileRepository();
  private readonly services = new InMemoryServiceRepository();
  private readonly availability = new InMemoryAvailabilityRepository();
  private readonly appointments = new InMemoryAppointmentRepository();
  private readonly itrEngagements = new InMemoryItrEngagementRepository();
  private readonly messages = new InMemoryMessageRepository();
  private readonly contactEnquiries = new InMemoryContactEnquiryRepository();
  private readonly outbox = new InMemoryOutbox();
  private readonly audit = new InMemoryAuditLog();

  private clock = new FakeClock(DEFAULT_NOW);
  private policy: BookingPolicy = DEFAULT_BOOKING_POLICY;
  private captchaPasses = true;

  private seededUsers: Record<string, UserProfile> = {};
  private seededServices: Record<string, Service> = {};

  withClock(iso: string): this {
    this.clock = new FakeClock(iso);
    return this;
  }

  withPolicy(policy: Partial<BookingPolicy>): this {
    this.policy = { ...this.policy, ...policy };
    return this;
  }

  withCaProfile(over: Partial<CaProfile> = {}): this {
    this.caProfileRepo.seed(aCaProfile(over));
    return this;
  }

  withUser(name: string, over: Partial<UserProfile> = {}): this {
    const user = this.users.seed(aUser(over));
    this.seededUsers[name] = user;
    return this;
  }

  withService(name: string, service: Service): this {
    this.services.seed(service);
    this.seededServices[name] = service;
    return this;
  }

  withRule(over: Partial<AvailabilityRule> = {}): this {
    this.availability.seedRule({
      id: over.id ?? randomUUID(),
      dayOfWeek: 1,
      startTime: '10:00',
      endTime: '13:00',
      slotMinutes: 30,
      bufferMinutes: 0,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      isActive: true,
      ...over,
    });
    return this;
  }

  withException(over: Partial<ScheduleException> & { onDate: string }): this {
    this.availability.seedException({
      id: over.id ?? randomUUID(),
      kind: 'BLOCKED',
      startTime: null,
      endTime: null,
      reason: null,
      ...over,
    });
    return this;
  }

  withFailingCaptcha(): this {
    this.captchaPasses = false;
    return this;
  }

  build() {
    this.appointments.attachUsers(this.users);
    this.itrEngagements.attachUsers(this.users);
    this.messages.attachUsers(this.users);

    // Sensible defaults so a test only states what it cares about.
    if (!this.caProfileRepo.profile) this.caProfileRepo.seed(aCaProfile());
    if (!this.seededUsers.admin) {
      this.withUser('admin', { email: 'admin@example.test', role: 'ADMIN', fullName: 'S. Mehta' });
    }
    if (!this.seededUsers.client) this.withUser('client');

    const repos: Repositories = {
      users: this.users,
      caProfile: this.caProfileRepo,
      services: this.services,
      availability: this.availability,
      appointments: this.appointments,
      itrEngagements: this.itrEngagements,
      messages: this.messages,
      contactEnquiries: this.contactEnquiries,
      outbox: this.outbox,
      audit: this.audit,
    };

    const uow = new InMemoryUnitOfWork(repos);
    const clock = this.clock;
    const policy = this.policy;
    const captcha = this.captchaPasses ? new AlwaysPassCaptcha() : new AlwaysFailCaptcha();

    return {
      clock,
      policy,
      uow,
      repos,
      outbox: this.outbox,
      audit: this.audit,
      users: this.seededUsers,
      services: this.seededServices,
      stores: {
        appointments: this.appointments,
        engagements: this.itrEngagements,
        messages: this.messages,
        enquiries: this.contactEnquiries,
        userRepo: this.users,
      },

      bookAppointment: new BookAppointment({ uow, clock, policy }),
      cancelAppointment: new CancelAppointment({ uow, clock, policy }),
      rescheduleAppointment: new RescheduleAppointment({ uow, clock, policy }),
      updateAppointment: new UpdateAppointment({ uow, clock, policy }),
      listAvailableSlots: new ListAvailableSlots({ uow, clock, policy }),
      completeUserProfile: new CompleteUserProfile({ uow, clock }),
      registerItrEngagement: new RegisterItrEngagement({ uow }),
      advanceItrEngagement: new AdvanceItrEngagement({ uow, clock }),
      startThread: new StartThread({ uow, clock }),
      postMessage: new PostMessage({ uow, clock }),
      submitContactEnquiry: new SubmitContactEnquiry({ uow, clock, captcha }),
      getMyEngagements: new GetMyEngagements({ uow, clock }),
    };
  }
}

export function aTestContext(): TestContextBuilder {
  return new TestContextBuilder();
}

export type TestContext = ReturnType<TestContextBuilder['build']>;
