/**
 * In-memory implementations of every port.
 *
 * These are real implementations backed by `Map`s, not mocking-library stubs.
 * The difference matters most in `InMemoryAppointmentRepository.create`, which
 * enforces the same non-overlap rule the database's exclusion constraint does
 * — so a use-case test and a production insert fail for the same reason rather
 * than by coincidence.
 */

import { randomUUID } from 'node:crypto';
import type { Appointment, AppointmentStatus } from '../../src/domain/appointment/appointment.js';
import type { ItrEngagement, ItrStatus } from '../../src/domain/itr/itr-engagement.js';
import type { Address, UserProfile, UserRole, UserStatus } from '../../src/domain/user/user-profile.js';
import type { Service, ServiceKind } from '../../src/domain/service/service.js';
import type { CaProfile } from '../../src/domain/ca-profile/ca-profile.js';
import type { AvailabilityRule } from '../../src/domain/scheduling/availability-rule.js';
import type { ScheduleException } from '../../src/domain/scheduling/schedule-exception.js';
import type { TimeRange } from '../../src/domain/scheduling/time-range.js';
import { overlaps } from '../../src/domain/scheduling/time-range.js';
import type { ThreadStatus } from '../../src/domain/messaging/messaging-policy.js';

import type {
  AdminAppointmentQuery,
  AppointmentRepository,
  AppointmentStatusHistoryRow,
  AppointmentWithUser,
  CreateAppointmentInput,
  StatusChange,
} from '../../src/application/ports/appointment-repository.js';
import {
  DuplicateIdempotencyKeyError,
  SlotTakenError,
} from '../../src/application/ports/appointment-repository.js';
import type {
  AdminItrQuery,
  CreateItrEngagementInput,
  ItrEngagementRepository,
  ItrEngagementWithUser,
  ItrStatusChange,
  ItrStatusHistoryRow,
} from '../../src/application/ports/itr-engagement-repository.js';
import { DuplicateEngagementError } from '../../src/application/ports/itr-engagement-repository.js';
import type {
  CompleteProfileInput,
  ProvisionUserInput,
  UserListQuery,
  UserListRow,
  UserRepository,
} from '../../src/application/ports/user-repository.js';
import type { ServiceRepository, UpsertServiceInput } from '../../src/application/ports/service-repository.js';
import type {
  AvailabilityRepository,
  CreateScheduleExceptionInput,
  UpsertAvailabilityRuleInput,
} from '../../src/application/ports/availability-repository.js';
import type { CaProfileRepository, UpsertCaProfileInput } from '../../src/application/ports/ca-profile-repository.js';
import type {
  AdminThreadQuery,
  CreateThreadInput,
  MessageRepository,
  Thread,
  ThreadMessage,
  ThreadWithUser,
} from '../../src/application/ports/message-repository.js';
import type {
  ContactEnquiry,
  ContactEnquiryRepository,
  CreateContactEnquiryInput,
  EnquiryStatus,
} from '../../src/application/ports/contact-enquiry-repository.js';
import type { EnqueueInput, NotificationOutbox, OutboxEntry } from '../../src/application/ports/notification-outbox.js';
import type { AuditEntry, AuditLog } from '../../src/application/ports/audit-log.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/unit-of-work.js';

/** The real repositories keep these in columns; the fakes carry them alongside. */
type StoredAppointment = Appointment & { idempotencyKeyInternal?: string | null };
type StoredEngagement = ItrEngagement & { idempotencyKeyInternal?: string | null };

let counter = 0;
const nextRef = (prefix: string) => `${prefix}-2026-${String(++counter).padStart(6, '0')}`;

// ─── users ────────────────────────────────────────────────────────────────────

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, UserProfile>();

  seed(user: UserProfile): UserProfile {
    this.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<UserProfile | null> {
    return this.users.get(id) ?? null;
  }

  async findOrProvision(input: ProvisionUserInput): Promise<UserProfile> {
    const existing = this.users.get(input.id);
    if (existing) return existing;

    const created: UserProfile = {
      id: input.id,
      email: input.email,
      fullName: input.fullName,
      phone: null,
      address: null,
      avatarUrl: input.avatarUrl,
      role: 'USER',
      status: 'ACTIVE',
      noShowCount: 0,
      profileCompletedAt: null,
      createdAt: new Date(),
    };
    this.users.set(created.id, created);
    return created;
  }

  async completeProfile(input: CompleteProfileInput): Promise<UserProfile> {
    const existing = this.users.get(input.userId)!;
    const updated: UserProfile = {
      ...existing,
      fullName: input.fullName,
      phone: input.phone,
      address: input.address,
      profileCompletedAt: input.completedAt,
    };
    this.users.set(updated.id, updated);
    return updated;
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    const u = this.users.get(userId)!;
    this.users.set(userId, { ...u, status });
  }

  async setRole(userId: string, role: UserRole): Promise<void> {
    const u = this.users.get(userId)!;
    this.users.set(userId, { ...u, role });
  }

  async incrementNoShowCount(userId: string): Promise<void> {
    const u = this.users.get(userId)!;
    this.users.set(userId, { ...u, noShowCount: u.noShowCount + 1 });
  }

  async resetNoShowCount(userId: string): Promise<void> {
    const u = this.users.get(userId)!;
    this.users.set(userId, { ...u, noShowCount: 0 });
  }

  async list(query: UserListQuery): Promise<{ rows: UserListRow[]; total: number }> {
    let rows = [...this.users.values()];
    if (query.status) rows = rows.filter((u) => u.status === query.status);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.fullName ?? '').toLowerCase().includes(q) ||
          (u.phone ?? '').includes(q),
      );
    }
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      rows: rows.slice(start, start + query.pageSize).map((u) => ({
        ...u,
        appointmentCount: 0,
        engagementCount: 0,
        lastActivityAt: null,
      })),
      total,
    };
  }

  async countCreatedSince(since: Date): Promise<number> {
    return [...this.users.values()].filter((u) => u.createdAt.getTime() >= since.getTime()).length;
  }

  async findAdminEmails(): Promise<string[]> {
    return [...this.users.values()].filter((u) => u.role === 'ADMIN').map((u) => u.email);
  }
}

// ─── appointments ─────────────────────────────────────────────────────────────

export class InMemoryAppointmentRepository implements AppointmentRepository {
  readonly appointments = new Map<string, StoredAppointment>();
  readonly history: StatusChange[] = [];
  private users: InMemoryUserRepository | null = null;

  attachUsers(users: InMemoryUserRepository): void {
    this.users = users;
  }

  seed(appointment: Appointment): Appointment {
    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  async create(input: CreateAppointmentInput): Promise<Appointment> {
    if (input.idempotencyKey) {
      const clash = [...this.appointments.values()].find(
        (a) => a.userId === input.userId && a.idempotencyKeyInternal === input.idempotencyKey,
      );
      if (clash) throw new DuplicateIdempotencyKeyError(clash.id);
    }

    // The same rule the exclusion constraint enforces. Without this, a
    // use-case test would happily double-book where production would not.
    const candidate: TimeRange = { start: input.startsAt, end: input.endsAt };
    const clash = [...this.appointments.values()].some(
      (a) => a.status === 'CONFIRMED' && overlaps({ start: a.startsAt, end: a.endsAt }, candidate),
    );
    if (clash) throw new SlotTakenError(input.startsAt);

    const appointment: StoredAppointment = {
      id: randomUUID(),
      reference: nextRef('APT'),
      userId: input.userId,
      serviceId: input.serviceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'CONFIRMED',
      meetingUrl: input.meetingUrl,
      serviceName: input.serviceName,
      amountPaise: input.amountPaise,
      userNotes: input.userNotes,
      adminNotes: null,
      cancellationReason: null,
      cancelledAt: null,
      completedAt: null,
      supersededBy: null,
      createdAt: new Date(),
      idempotencyKeyInternal: input.idempotencyKey,
    };

    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  async findById(id: string): Promise<Appointment | null> {
    return this.appointments.get(id) ?? null;
  }

  async findByIdWithUser(id: string): Promise<AppointmentWithUser | null> {
    const appointment = this.appointments.get(id);
    if (!appointment) return null;
    const user = this.users?.users.get(appointment.userId);
    return {
      ...appointment,
      userName: user?.fullName ?? null,
      userEmail: user?.email ?? 'unknown@example.com',
      userPhone: user?.phone ?? null,
    };
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Appointment | null> {
    return (
      [...this.appointments.values()].find(
        (a) => a.userId === userId && a.idempotencyKeyInternal === key,
      ) ?? null
    );
  }

  async findBusyRanges(from: Date, to: Date): Promise<TimeRange[]> {
    return [...this.appointments.values()]
      .filter((a) => a.status === 'CONFIRMED')
      .filter((a) => a.endsAt.getTime() > from.getTime() && a.startsAt.getTime() < to.getTime())
      .map((a) => ({ start: a.startsAt, end: a.endsAt }));
  }

  async findConfirmedInRange(from: Date, to: Date): Promise<AppointmentWithUser[]> {
    const rows = [...this.appointments.values()]
      .filter((a) => a.status === 'CONFIRMED')
      .filter((a) => a.startsAt.getTime() >= from.getTime() && a.startsAt.getTime() < to.getTime());
    return Promise.all(rows.map((a) => this.findByIdWithUser(a.id) as Promise<AppointmentWithUser>));
  }

  async listForUser(userId: string): Promise<Appointment[]> {
    return [...this.appointments.values()]
      .filter((a) => a.userId === userId)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async countUpcomingForUser(userId: string, now: Date): Promise<number> {
    return [...this.appointments.values()].filter(
      (a) => a.userId === userId && a.status === 'CONFIRMED' && a.startsAt.getTime() > now.getTime(),
    ).length;
  }

  async countCreatedForUserOnDay(userId: string, dayStart: Date, dayEnd: Date): Promise<number> {
    return [...this.appointments.values()].filter(
      (a) =>
        a.userId === userId &&
        a.createdAt.getTime() >= dayStart.getTime() &&
        a.createdAt.getTime() < dayEnd.getTime(),
    ).length;
  }

  async updateStatus(input: {
    id: string;
    status: AppointmentStatus;
    cancellationReason?: string | null;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
    supersededBy?: string | null;
  }): Promise<Appointment> {
    const existing = this.appointments.get(input.id)!;
    const updated: StoredAppointment = {
      ...existing,
      status: input.status,
      cancellationReason: input.cancellationReason ?? existing.cancellationReason,
      cancelledAt: input.cancelledAt ?? existing.cancelledAt,
      completedAt: input.completedAt ?? existing.completedAt,
      supersededBy: input.supersededBy ?? existing.supersededBy,
    };
    this.appointments.set(updated.id, updated);
    return updated;
  }

  async updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    meetingUrl?: string | null;
  }): Promise<Appointment> {
    const existing = this.appointments.get(input.id)!;
    const updated: StoredAppointment = {
      ...existing,
      adminNotes: input.adminNotes !== undefined ? input.adminNotes : existing.adminNotes,
      meetingUrl: input.meetingUrl ?? existing.meetingUrl,
    };
    this.appointments.set(updated.id, updated);
    return updated;
  }

  async recordStatusChange(change: StatusChange): Promise<void> {
    this.history.push(change);
  }

  async historyFor(appointmentId: string): Promise<AppointmentStatusHistoryRow[]> {
    return this.history
      .filter((h) => h.appointmentId === appointmentId)
      .map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorRole: h.actorRole,
        note: h.note,
        createdAt: new Date(),
      }));
  }

  async listForAdmin(
    query: AdminAppointmentQuery,
  ): Promise<{ rows: AppointmentWithUser[]; total: number }> {
    let rows = [...this.appointments.values()];
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const page = rows.slice(start, start + query.pageSize);
    return {
      rows: await Promise.all(page.map((a) => this.findByIdWithUser(a.id) as Promise<AppointmentWithUser>)),
      total,
    };
  }

  async countUpcomingBetween(from: Date, to: Date): Promise<number> {
    return [...this.appointments.values()].filter(
      (a) =>
        a.status === 'CONFIRMED' &&
        a.startsAt.getTime() >= from.getTime() &&
        a.startsAt.getTime() <= to.getTime(),
    ).length;
  }

  async findNeedingReminder(from: Date, to: Date): Promise<AppointmentWithUser[]> {
    return this.findConfirmedInRange(from, to);
  }
}

// ─── ITR engagements ──────────────────────────────────────────────────────────

export class InMemoryItrEngagementRepository implements ItrEngagementRepository {
  readonly engagements = new Map<string, StoredEngagement>();
  readonly history: ItrStatusChange[] = [];
  private users: InMemoryUserRepository | null = null;

  attachUsers(users: InMemoryUserRepository): void {
    this.users = users;
  }

  seed(engagement: ItrEngagement): ItrEngagement {
    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  async create(input: CreateItrEngagementInput): Promise<ItrEngagement> {
    // Mirrors the partial unique index: cancelled engagements do not block.
    const live = await this.findLiveFor(input.userId, input.assessmentYear, input.itrFormType);
    if (live) throw new DuplicateEngagementError(input.assessmentYear, input.itrFormType);

    const engagement: StoredEngagement = {
      id: randomUUID(),
      reference: nextRef('ITR'),
      userId: input.userId,
      serviceId: input.serviceId,
      status: 'SUBMITTED',
      assessmentYear: input.assessmentYear,
      itrFormType: input.itrFormType,
      serviceName: input.serviceName,
      amountPaise: input.amountPaise,
      panNumber: null,
      hasBusinessIncome: input.hasBusinessIncome,
      userNotes: input.userNotes,
      adminNotes: null,
      infoRequested: null,
      acknowledgementNumber: null,
      filedAt: null,
      cancellationReason: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      idempotencyKeyInternal: input.idempotencyKey,
    };

    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  async findById(id: string): Promise<ItrEngagement | null> {
    return this.engagements.get(id) ?? null;
  }

  async findByIdWithUser(id: string): Promise<ItrEngagementWithUser | null> {
    const engagement = this.engagements.get(id);
    if (!engagement) return null;
    const user = this.users?.users.get(engagement.userId);
    return {
      ...engagement,
      userName: user?.fullName ?? null,
      userEmail: user?.email ?? 'unknown@example.com',
      userPhone: user?.phone ?? null,
    };
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<ItrEngagement | null> {
    return (
      [...this.engagements.values()].find(
        (e) => e.userId === userId && e.idempotencyKeyInternal === key,
      ) ?? null
    );
  }

  async findLiveFor(
    userId: string,
    assessmentYear: string,
    formType: string,
  ): Promise<ItrEngagement | null> {
    return (
      [...this.engagements.values()].find(
        (e) =>
          e.userId === userId &&
          e.assessmentYear === assessmentYear &&
          e.itrFormType === formType &&
          !e.status.startsWith('CANCELLED'),
      ) ?? null
    );
  }

  async listForUser(userId: string): Promise<ItrEngagement[]> {
    return [...this.engagements.values()]
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
    const existing = this.engagements.get(input.id)!;
    const updated = {
      ...existing,
      status: input.status,
      infoRequested: input.infoRequested !== undefined ? input.infoRequested : existing.infoRequested,
      acknowledgementNumber:
        input.acknowledgementNumber !== undefined
          ? input.acknowledgementNumber
          : existing.acknowledgementNumber,
      filedAt: input.filedAt ?? existing.filedAt,
      completedAt: input.completedAt ?? existing.completedAt,
      cancellationReason: input.cancellationReason ?? existing.cancellationReason,
      cancelledAt: input.cancelledAt ?? existing.cancelledAt,
      updatedAt: new Date(),
    };
    this.engagements.set(updated.id, updated);
    return updated;
  }

  async updateAdminFields(input: {
    id: string;
    adminNotes?: string | null;
    panNumber?: string | null;
  }): Promise<ItrEngagement> {
    const existing = this.engagements.get(input.id)!;
    const updated = {
      ...existing,
      adminNotes: input.adminNotes !== undefined ? input.adminNotes : existing.adminNotes,
      panNumber: input.panNumber !== undefined ? input.panNumber : existing.panNumber,
      updatedAt: new Date(),
    };
    this.engagements.set(updated.id, updated);
    return updated;
  }

  async recordStatusChange(change: ItrStatusChange): Promise<void> {
    this.history.push(change);
  }

  async historyFor(engagementId: string): Promise<ItrStatusHistoryRow[]> {
    return this.history
      .filter((h) => h.engagementId === engagementId)
      .map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorRole: h.actorRole,
        note: h.note,
        createdAt: new Date(),
      }));
  }

  async listForAdmin(query: AdminItrQuery): Promise<{ rows: ItrEngagementWithUser[]; total: number }> {
    let rows = [...this.engagements.values()];
    if (query.status) rows = rows.filter((e) => e.status === query.status);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const page = rows.slice(start, start + query.pageSize);
    return {
      rows: await Promise.all(
        page.map((e) => this.findByIdWithUser(e.id) as Promise<ItrEngagementWithUser>),
      ),
      total,
    };
  }

  async pipelineCounts(): Promise<Array<{ status: ItrStatus; count: number }>> {
    const counts = new Map<ItrStatus, number>();
    for (const e of this.engagements.values()) {
      counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }
}

// ─── catalogue and schedule ───────────────────────────────────────────────────

export class InMemoryServiceRepository implements ServiceRepository {
  readonly services = new Map<string, Service>();

  seed(service: Service): Service {
    this.services.set(service.id, service);
    return service;
  }

  async findById(id: string): Promise<Service | null> {
    return this.services.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Service | null> {
    return [...this.services.values()].find((s) => s.slug === slug) ?? null;
  }

  async listActive(kind?: ServiceKind): Promise<Service[]> {
    return [...this.services.values()]
      .filter((s) => s.isActive && (!kind || s.kind === kind))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listAll(kind?: ServiceKind): Promise<Service[]> {
    return [...this.services.values()].filter((s) => !kind || s.kind === kind);
  }

  async create(input: UpsertServiceInput): Promise<Service> {
    const service: Service = { id: randomUUID(), currency: 'INR', ...input };
    this.services.set(service.id, service);
    return service;
  }

  async update(id: string, input: UpsertServiceInput): Promise<Service> {
    const updated: Service = { ...this.services.get(id)!, ...input };
    this.services.set(id, updated);
    return updated;
  }

  async deactivate(id: string): Promise<void> {
    const s = this.services.get(id)!;
    this.services.set(id, { ...s, isActive: false });
  }

  async isReferenced(): Promise<boolean> {
    return false;
  }

  async hardDelete(id: string): Promise<void> {
    this.services.delete(id);
  }
}

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  readonly rules = new Map<string, AvailabilityRule>();
  readonly exceptions = new Map<string, ScheduleException>();

  seedRule(rule: AvailabilityRule): AvailabilityRule {
    this.rules.set(rule.id, rule);
    return rule;
  }

  seedException(exception: ScheduleException): ScheduleException {
    this.exceptions.set(exception.id, exception);
    return exception;
  }

  async listRules(): Promise<AvailabilityRule[]> {
    return [...this.rules.values()];
  }

  async findRule(id: string): Promise<AvailabilityRule | null> {
    return this.rules.get(id) ?? null;
  }

  async createRule(input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule> {
    const rule: AvailabilityRule = { id: randomUUID(), ...input };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async updateRule(id: string, input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule> {
    const updated: AvailabilityRule = { ...this.rules.get(id)!, ...input };
    this.rules.set(id, updated);
    return updated;
  }

  async deleteRule(id: string): Promise<void> {
    this.rules.delete(id);
  }

  async listExceptions(from: string, to: string): Promise<ScheduleException[]> {
    return [...this.exceptions.values()].filter((e) => e.onDate >= from && e.onDate <= to);
  }

  async listUpcomingExceptions(from: string): Promise<ScheduleException[]> {
    return [...this.exceptions.values()].filter((e) => e.onDate >= from);
  }

  async createException(input: CreateScheduleExceptionInput): Promise<ScheduleException> {
    const exception: ScheduleException = { id: randomUUID(), ...input };
    this.exceptions.set(exception.id, exception);
    return exception;
  }

  async deleteException(id: string): Promise<void> {
    this.exceptions.delete(id);
  }
}

export class InMemoryCaProfileRepository implements CaProfileRepository {
  profile: CaProfile | null = null;

  seed(profile: CaProfile): CaProfile {
    this.profile = profile;
    return profile;
  }

  async find(): Promise<CaProfile | null> {
    return this.profile;
  }

  async upsert(input: UpsertCaProfileInput): Promise<CaProfile> {
    this.profile = { ...input, updatedAt: new Date() };
    return this.profile;
  }
}

// ─── messaging and enquiries ──────────────────────────────────────────────────

export class InMemoryMessageRepository implements MessageRepository {
  readonly threads = new Map<string, Thread>();
  readonly messages: ThreadMessage[] = [];
  private users: InMemoryUserRepository | null = null;

  attachUsers(users: InMemoryUserRepository): void {
    this.users = users;
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const thread: Thread = {
      id: randomUUID(),
      userId: input.userId,
      appointmentId: input.appointmentId,
      engagementId: input.engagementId,
      subject: input.subject,
      status: 'AWAITING_ADMIN',
      lastMessageAt: new Date(),
      unreadForAdmin: 0,
      unreadForUser: 0,
      createdAt: new Date(),
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async findThread(id: string): Promise<Thread | null> {
    return this.threads.get(id) ?? null;
  }

  async findThreadWithUser(id: string): Promise<ThreadWithUser | null> {
    const thread = this.threads.get(id);
    if (!thread) return null;
    const user = this.users?.users.get(thread.userId);
    const last = this.messages.filter((m) => m.threadId === id).at(-1);
    return {
      ...thread,
      userName: user?.fullName ?? null,
      userEmail: user?.email ?? 'unknown@example.com',
      lastMessagePreview: last?.body.slice(0, 120) ?? null,
    };
  }

  async listThreadsForUser(userId: string): Promise<ThreadWithUser[]> {
    const rows = [...this.threads.values()].filter((t) => t.userId === userId);
    return Promise.all(rows.map((t) => this.findThreadWithUser(t.id) as Promise<ThreadWithUser>));
  }

  async listThreadsForAdmin(query: AdminThreadQuery): Promise<{ rows: ThreadWithUser[]; total: number }> {
    let rows = [...this.threads.values()];
    if (query.status) rows = rows.filter((t) => t.status === query.status);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const page = rows.slice(start, start + query.pageSize);
    return {
      rows: await Promise.all(page.map((t) => this.findThreadWithUser(t.id) as Promise<ThreadWithUser>)),
      total,
    };
  }

  async addMessage(input: {
    threadId: string;
    senderId: string;
    senderRole: 'USER' | 'ADMIN';
    body: string;
  }): Promise<ThreadMessage> {
    const message: ThreadMessage = {
      id: randomUUID(),
      threadId: input.threadId,
      senderId: input.senderId,
      senderRole: input.senderRole,
      body: input.body,
      readAt: null,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return message;
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return this.messages.filter((m) => m.threadId === threadId);
  }

  async touchThread(input: {
    threadId: string;
    status: ThreadStatus;
    incrementUnreadFor: 'USER' | 'ADMIN';
    at: Date;
  }): Promise<void> {
    const thread = this.threads.get(input.threadId)!;
    this.threads.set(thread.id, {
      ...thread,
      status: input.status,
      lastMessageAt: input.at,
      unreadForAdmin:
        input.incrementUnreadFor === 'ADMIN' ? thread.unreadForAdmin + 1 : thread.unreadForAdmin,
      unreadForUser:
        input.incrementUnreadFor === 'USER' ? thread.unreadForUser + 1 : thread.unreadForUser,
    });
  }

  async markRead(threadId: string, reader: 'USER' | 'ADMIN'): Promise<void> {
    const thread = this.threads.get(threadId)!;
    this.threads.set(threadId, {
      ...thread,
      unreadForAdmin: reader === 'ADMIN' ? 0 : thread.unreadForAdmin,
      unreadForUser: reader === 'USER' ? 0 : thread.unreadForUser,
    });
  }

  async setThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
    const thread = this.threads.get(threadId)!;
    this.threads.set(threadId, { ...thread, status });
  }

  async countUnreadForUser(userId: string): Promise<number> {
    return [...this.threads.values()]
      .filter((t) => t.userId === userId)
      .reduce((sum, t) => sum + t.unreadForUser, 0);
  }

  async countThreadsAwaitingAdmin(): Promise<number> {
    return [...this.threads.values()].filter((t) => t.status === 'AWAITING_ADMIN').length;
  }

  async findStaleUnread(): Promise<
    Array<{ threadId: string; subject: string; recipientEmail: string; recipientRole: 'USER' | 'ADMIN' }>
  > {
    return [];
  }
}

export class InMemoryContactEnquiryRepository implements ContactEnquiryRepository {
  readonly enquiries = new Map<string, ContactEnquiry>();

  async create(input: CreateContactEnquiryInput): Promise<ContactEnquiry> {
    const enquiry: ContactEnquiry = {
      id: randomUUID(),
      ...input,
      status: 'NEW',
      adminNote: null,
      repliedAt: null,
      createdAt: new Date(),
    };
    this.enquiries.set(enquiry.id, enquiry);
    return enquiry;
  }

  async findById(id: string): Promise<ContactEnquiry | null> {
    return this.enquiries.get(id) ?? null;
  }

  async list(query: { status?: EnquiryStatus | undefined; page: number; pageSize: number }) {
    let rows = [...this.enquiries.values()];
    if (query.status) rows = rows.filter((e) => e.status === query.status);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return { rows: rows.slice(start, start + query.pageSize), total };
  }

  async update(
    id: string,
    input: { status?: EnquiryStatus; adminNote?: string | null; repliedAt?: Date | null },
  ): Promise<ContactEnquiry> {
    const updated = { ...this.enquiries.get(id)!, ...input };
    this.enquiries.set(id, updated);
    return updated;
  }

  async countNew(): Promise<number> {
    return [...this.enquiries.values()].filter((e) => e.status === 'NEW').length;
  }

  async countFromIpSince(ip: string, since: Date): Promise<number> {
    return [...this.enquiries.values()].filter(
      (e) => e.sourceIp === ip && e.createdAt.getTime() >= since.getTime(),
    ).length;
  }
}

// ─── outbox and audit ─────────────────────────────────────────────────────────

export class InMemoryOutbox implements NotificationOutbox {
  readonly entries: OutboxEntry[] = [];

  private has(dedupeKey: string | null | undefined): boolean {
    return !!dedupeKey && this.entries.some((e) => e.dedupeKey === dedupeKey);
  }

  async enqueue(input: EnqueueInput): Promise<void> {
    if (this.has(input.dedupeKey)) return;
    this.entries.push({
      id: randomUUID(),
      channel: input.channel,
      recipient: input.recipient,
      templateKey: input.templateKey,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      status: 'PENDING',
      attempts: 0,
      scheduledFor: input.scheduledFor ?? null,
      lastError: null,
      createdAt: new Date(),
    });
  }

  async enqueueMany(inputs: readonly EnqueueInput[]): Promise<void> {
    for (const input of inputs) await this.enqueue(input);
  }

  async claimBatch(limit: number, now: Date): Promise<OutboxEntry[]> {
    return this.entries
      .filter((e) => e.status === 'PENDING')
      .filter((e) => !e.scheduledFor || e.scheduledFor.getTime() <= now.getTime())
      .slice(0, limit);
  }

  async markSent(id: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) this.entries[index] = { ...this.entries[index]!, status: 'SENT' };
  }

  async markFailed(id: string, error: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      const entry = this.entries[index]!;
      this.entries[index] = { ...entry, attempts: entry.attempts + 1, lastError: error };
    }
  }

  async markDead(id: string, error: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) this.entries[index] = { ...this.entries[index]!, status: 'DEAD', lastError: error };
  }

  async counts(): Promise<{ pending: number; failed: number; dead: number }> {
    return {
      pending: this.entries.filter((e) => e.status === 'PENDING').length,
      failed: this.entries.filter((e) => e.status === 'FAILED').length,
      dead: this.entries.filter((e) => e.status === 'DEAD').length,
    };
  }

  /** Test helper: every template key enqueued, in order. */
  templateKeys(): string[] {
    return this.entries.map((e) => e.templateKey);
  }

  byTemplate(key: string): OutboxEntry[] {
    return this.entries.filter((e) => e.templateKey === key);
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

// ─── unit of work ─────────────────────────────────────────────────────────────

/**
 * Transactions are simulated by snapshotting every store before `work` runs
 * and restoring on failure. Crude, but it means a use-case test can assert
 * "nothing was written when this failed" — which is the property the real
 * transaction provides and the one most worth testing.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(public readonly repos: Repositories) {}

  async transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await work(this.repos);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot() {
    const r = this.repos as unknown as {
      appointments: InMemoryAppointmentRepository;
      itrEngagements: InMemoryItrEngagementRepository;
      users: InMemoryUserRepository;
      messages: InMemoryMessageRepository;
      outbox: InMemoryOutbox;
    };
    return {
      appointments: new Map(r.appointments.appointments),
      engagements: new Map(r.itrEngagements.engagements),
      users: new Map(r.users.users),
      threads: new Map(r.messages.threads),
      messages: [...r.messages.messages],
      outbox: [...r.outbox.entries],
      history: [...r.appointments.history],
    };
  }

  private restore(snapshot: ReturnType<InMemoryUnitOfWork['snapshot']>): void {
    const r = this.repos as unknown as {
      appointments: InMemoryAppointmentRepository;
      itrEngagements: InMemoryItrEngagementRepository;
      users: InMemoryUserRepository;
      messages: InMemoryMessageRepository;
      outbox: InMemoryOutbox;
    };
    r.appointments.appointments.clear();
    for (const [k, v] of snapshot.appointments) r.appointments.appointments.set(k, v);
    r.itrEngagements.engagements.clear();
    for (const [k, v] of snapshot.engagements) r.itrEngagements.engagements.set(k, v);
    r.users.users.clear();
    for (const [k, v] of snapshot.users) r.users.users.set(k, v);
    r.messages.threads.clear();
    for (const [k, v] of snapshot.threads) r.messages.threads.set(k, v);
    r.messages.messages.length = 0;
    r.messages.messages.push(...snapshot.messages);
    r.outbox.entries.length = 0;
    r.outbox.entries.push(...snapshot.outbox);
    r.appointments.history.length = 0;
    r.appointments.history.push(...snapshot.history);
  }
}
