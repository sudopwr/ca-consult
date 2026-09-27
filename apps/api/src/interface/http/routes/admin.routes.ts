import type { FastifyInstance } from 'fastify';
import {
  adminAppointmentListQuerySchema,
  adminEnquiryListQuerySchema,
  adminItrListQuerySchema,
  adminThreadListQuerySchema,
  adminUserListQuerySchema,
  createScheduleExceptionRequestSchema,
  postMessageRequestSchema,
  publicServiceListQuerySchema,
  rescheduleAppointmentRequestSchema,
  setUserStatusRequestSchema,
  updateAppointmentRequestSchema,
  updateEnquiryRequestSchema,
  updateItrEngagementRequestSchema,
  updateThreadRequestSchema,
  upsertAvailabilityRuleRequestSchema,
  upsertCaProfileRequestSchema,
  upsertServiceRequestSchema,
} from '@ca/contracts';
import { Errors } from '../../../domain/shared/errors.js';
import { requireAdmin } from '../guards/index.js';
import { unwrapOrThrow } from '../result-helpers.js';
import {
  toAdminAppointment,
  toAdminCaProfile,
  toAdminEngagement,
  toPublicUser,
  toServiceJson,
} from '../serialisers.js';
import { instantToLocalDate } from '../../../domain/shared/time.js';
import type { Appointment } from '../../../domain/appointment/appointment.js';
import type { AppDeps } from '../dependencies.js';

/**
 * Every route here sits behind `requireAdmin`, applied as a prefix-wide
 * preHandler rather than route by route — so a new admin route cannot ship
 * unguarded by someone forgetting to add it.
 */
export async function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.addHook('preHandler', async (request) => {
    requireAdmin(request);
  });

  // ── dashboard ─────────────────────────────────────────────────────────────

  app.get('/admin/dashboard', async () => {
    const dashboard = await deps.getAdminDashboard.execute();
    const now = deps.clock.now();

    return {
      ...dashboard,
      today: {
        ...dashboard.today,
        appointments: dashboard.today.appointments.map((a) => toAdminAppointment(a, now)),
      },
    };
  });

  // ── CA profile ────────────────────────────────────────────────────────────

  app.get('/admin/ca-profile', async () => {
    const profile = await deps.manageCaProfile.find();
    return profile ? toAdminCaProfile(profile) : null;
  });

  app.put('/admin/ca-profile', async (request) => {
    const admin = requireAdmin(request);
    const body = upsertCaProfileRequestSchema.parse(request.body);

    const profile = unwrapOrThrow(
      await deps.manageCaProfile.upsert(
        {
          fullName: body.fullName,
          headline: body.headline ?? null,
          membershipNumber: body.membershipNumber ?? null,
          firmName: body.firmName ?? null,
          bio: body.bio ?? null,
          photoUrl: body.photoUrl ?? null,
          yearsExperience: body.yearsExperience ?? null,
          qualifications: body.qualifications,
          specialisations: body.specialisations,
          languages: body.languages,
          officeAddress: body.officeAddress ?? null,
          googleMapsUrl: body.googleMapsUrl ?? null,
          contactEmail: body.contactEmail ?? null,
          contactPhone: body.contactPhone ?? null,
          whatsappNumber: body.whatsappNumber ?? null,
          linkedinUrl: body.linkedinUrl ?? null,
          defaultMeetingUrl: body.defaultMeetingUrl ?? null,
          timezone: body.timezone,
          isPublished: body.isPublished,
        },
        admin.id,
      ),
    );

    return toAdminCaProfile(profile);
  });

  // ── services ──────────────────────────────────────────────────────────────

  app.get('/admin/services', async (request) => {
    const query = publicServiceListQuerySchema.parse(request.query);
    return (await deps.manageServices.listAll(query.kind)).map(toServiceJson);
  });

  app.post('/admin/services', async (request, reply) => {
    const admin = requireAdmin(request);
    const body = upsertServiceRequestSchema.parse(request.body);

    const service = unwrapOrThrow(
      await deps.manageServices.create(
        {
          kind: body.kind,
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          amountPaise: body.amountPaise,
          durationMinutes: body.durationMinutes ?? null,
          assessmentYear: body.assessmentYear ?? null,
          itrFormType: body.itrFormType ?? null,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
        },
        admin.id,
      ),
    );

    return reply.code(201).send(toServiceJson(service));
  });

  app.put('/admin/services/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = upsertServiceRequestSchema.parse(request.body);

    const service = unwrapOrThrow(
      await deps.manageServices.update(
        id,
        {
          kind: body.kind,
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          amountPaise: body.amountPaise,
          durationMinutes: body.durationMinutes ?? null,
          assessmentYear: body.assessmentYear ?? null,
          itrFormType: body.itrFormType ?? null,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
        },
        admin.id,
      ),
    );

    return toServiceJson(service);
  });

  app.delete('/admin/services/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    // Returns whether it was deactivated rather than removed, so the UI can
    // say "this has bookings, so it has been hidden instead".
    return unwrapOrThrow(await deps.manageServices.remove(id, admin.id));
  });

  // ── schedule ──────────────────────────────────────────────────────────────

  app.get('/admin/availability/rules', async () => deps.manageAvailability.listRules());

  app.post('/admin/availability/rules', async (request, reply) => {
    const body = upsertAvailabilityRuleRequestSchema.parse(request.body);
    const today = instantToLocalDate(deps.clock.now(), deps.timezone);

    const rule = await deps.manageAvailability.createRule({
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
      slotMinutes: body.slotMinutes,
      bufferMinutes: body.bufferMinutes,
      effectiveFrom: body.effectiveFrom ?? today,
      effectiveTo: body.effectiveTo ?? null,
      isActive: body.isActive,
    });

    return reply.code(201).send(rule);
  });

  app.put('/admin/availability/rules/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = upsertAvailabilityRuleRequestSchema.parse(request.body);
    const today = instantToLocalDate(deps.clock.now(), deps.timezone);

    return unwrapOrThrow(
      await deps.manageAvailability.updateRule(id, {
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime,
        slotMinutes: body.slotMinutes,
        bufferMinutes: body.bufferMinutes,
        effectiveFrom: body.effectiveFrom ?? today,
        effectiveTo: body.effectiveTo ?? null,
        isActive: body.isActive,
      }),
    );
  });

  app.delete('/admin/availability/rules/:id', async (request) => {
    const { id } = request.params as { id: string };
    unwrapOrThrow(await deps.manageAvailability.deleteRule(id));
    return { deleted: true };
  });

  app.get('/admin/availability/exceptions', async () => {
    const today = instantToLocalDate(deps.clock.now(), deps.timezone);
    return deps.manageAvailability.listExceptions(today);
  });

  /**
   * Blocking a date that already has bookings is allowed — the CA is often
   * blocking it precisely because something came up — but the response carries
   * the appointments just orphaned, so they can be dealt with deliberately
   * rather than discovered on the day.
   */
  app.post('/admin/availability/exceptions', async (request, reply) => {
    const body = createScheduleExceptionRequestSchema.parse(request.body);

    const result = unwrapOrThrow(
      await deps.manageAvailability.createException({
        kind: body.kind,
        onDate: body.onDate,
        startTime: body.startTime ?? null,
        endTime: body.endTime ?? null,
        reason: body.reason ?? null,
      }),
    );

    return reply.code(201).send({
      exception: result.exception,
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        startsAt: conflict.startsAt.toISOString(),
      })),
    });
  });

  app.delete('/admin/availability/exceptions/:id', async (request) => {
    const { id } = request.params as { id: string };
    unwrapOrThrow(await deps.manageAvailability.deleteException(id));
    return { deleted: true };
  });

  // ── users ─────────────────────────────────────────────────────────────────

  app.get('/admin/users', async (request) => {
    const query = adminUserListQuerySchema.parse(request.query);
    const { rows, total } = await deps.manageUsers.list(query);

    return {
      items: rows.map((row) => ({
        ...toPublicUser(row),
        appointmentCount: row.appointmentCount,
        engagementCount: row.engagementCount,
        lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  app.get('/admin/users/:id', async (request) => {
    const { id } = request.params as { id: string };
    const user = unwrapOrThrow(await deps.manageUsers.find(id));
    const now = deps.clock.now();

    const [appointments, engagements] = await Promise.all([
      deps.uow.repos.appointments.listForUser(id),
      deps.uow.repos.itrEngagements.listForUser(id),
    ]);

    return {
      profile: toPublicUser(user),
      appointments: appointments.map((a) => toClientAppointmentForAdmin(a)),
      engagements: engagements.map((e) => ({ ...e, filedAt: e.filedAt?.toISOString() ?? null })),
    };
  });

  app.patch('/admin/users/:id/status', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = setUserStatusRequestSchema.parse(request.body);

    unwrapOrThrow(
      await deps.manageUsers.setStatus({
        userId: id,
        adminId: admin.id,
        status: body.status,
        reason: body.reason,
      }),
    );

    return { status: body.status };
  });

  app.post('/admin/users/:id/reset-no-shows', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    unwrapOrThrow(await deps.manageUsers.resetNoShows({ userId: id, adminId: admin.id }));
    return { reset: true };
  });

  // ── appointments ──────────────────────────────────────────────────────────

  app.get('/admin/appointments', async (request) => {
    const query = adminAppointmentListQuerySchema.parse(request.query);
    const now = deps.clock.now();

    const { rows, total } = await deps.uow.repos.appointments.listForAdmin({
      status: query.status,
      scope: query.scope,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
      serviceId: query.serviceId,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
      now,
      timeZone: deps.timezone,
    });

    return {
      items: rows.map((row) => toAdminAppointment(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  app.get('/admin/appointments/:id', async (request) => {
    const { id } = request.params as { id: string };
    const appointment = await deps.uow.repos.appointments.findByIdWithUser(id);
    if (!appointment) throw Errors.notFound('Appointment');

    const history = await deps.uow.repos.appointments.historyFor(id);

    return {
      ...toAdminAppointment(appointment, deps.clock.now()),
      history: history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    };
  });

  app.patch('/admin/appointments/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = updateAppointmentRequestSchema.parse(request.body);

    const appointment = unwrapOrThrow(
      await deps.updateAppointment.execute({
        appointmentId: id,
        adminId: admin.id,
        status: body.status,
        adminNotes: body.adminNotes,
        meetingUrl: body.meetingUrl,
        cancellationReason: body.cancellationReason,
      }),
    );

    return toClientAppointmentForAdmin(appointment);
  });

  app.post('/admin/appointments/:id/reschedule', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = rescheduleAppointmentRequestSchema.parse(request.body);

    const appointment = unwrapOrThrow(
      await deps.rescheduleAppointment.execute({
        appointmentId: id,
        actorId: admin.id,
        actorRole: 'ADMIN',
        startsAt: new Date(body.startsAt),
        notifyUser: body.notifyUser,
      }),
    );

    return toClientAppointmentForAdmin(appointment);
  });

  // ── ITR engagements ───────────────────────────────────────────────────────

  app.get('/admin/itr-engagements', async (request) => {
    const query = adminItrListQuerySchema.parse(request.query);
    const { rows, total } = await deps.uow.repos.itrEngagements.listForAdmin(query);

    return {
      items: rows.map(toAdminEngagement),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  app.get('/admin/itr-engagements/:id', async (request) => {
    const { id } = request.params as { id: string };
    const engagement = await deps.uow.repos.itrEngagements.findByIdWithUser(id);
    if (!engagement) throw Errors.notFound('Engagement');

    const history = await deps.uow.repos.itrEngagements.historyFor(id);

    return {
      ...toAdminEngagement(engagement),
      history: history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    };
  });

  /** The only route in the system that can write a PAN. */
  app.patch('/admin/itr-engagements/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = updateItrEngagementRequestSchema.parse(request.body);

    const engagement = unwrapOrThrow(
      await deps.advanceItrEngagement.execute({
        engagementId: id,
        actorId: admin.id,
        actorRole: 'ADMIN',
        status: body.status,
        infoRequested: body.infoRequested,
        acknowledgementNumber: body.acknowledgementNumber,
        panNumber: body.panNumber,
        adminNotes: body.adminNotes,
        cancellationReason: body.cancellationReason,
      }),
    );

    const withUser = await deps.uow.repos.itrEngagements.findByIdWithUser(engagement.id);
    return withUser ? toAdminEngagement(withUser) : engagement;
  });

  // ── inbox ─────────────────────────────────────────────────────────────────

  app.get('/admin/threads', async (request) => {
    const query = adminThreadListQuerySchema.parse(request.query);
    const { rows, total } = await deps.uow.repos.messages.listThreadsForAdmin(query);

    return {
      items: rows.map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        appointmentId: thread.appointmentId,
        engagementId: thread.engagementId,
        contextLabel: null,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        lastMessagePreview: thread.lastMessagePreview,
        unread: thread.unreadForAdmin,
        createdAt: thread.createdAt.toISOString(),
        userId: thread.userId,
        userName: thread.userName,
        userEmail: thread.userEmail,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  app.get('/admin/threads/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const thread = await deps.uow.repos.messages.findThreadWithUser(id);
    if (!thread) throw Errors.notFound('Conversation');

    const messages = await deps.uow.repos.messages.listMessages(id);
    await deps.markThreadRead.execute({ threadId: id, readerId: admin.id, reader: 'ADMIN' });

    return {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      appointmentId: thread.appointmentId,
      engagementId: thread.engagementId,
      contextLabel: null,
      lastMessageAt: thread.lastMessageAt.toISOString(),
      lastMessagePreview: thread.lastMessagePreview,
      unread: 0,
      createdAt: thread.createdAt.toISOString(),
      userId: thread.userId,
      userName: thread.userName,
      userEmail: thread.userEmail,
      messages: messages.map((message) => ({
        id: message.id,
        senderRole: message.senderRole,
        body: message.body,
        readAt: message.readAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  });

  app.post('/admin/threads/:id/messages', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = postMessageRequestSchema.parse(request.body);

    const message = unwrapOrThrow(
      await deps.postMessage.execute({
        threadId: id,
        senderId: admin.id,
        senderRole: 'ADMIN',
        body: body.body,
      }),
    );

    return reply.code(201).send({
      id: message.id,
      senderRole: message.senderRole,
      body: message.body,
      readAt: null,
      createdAt: message.createdAt.toISOString(),
    });
  });

  app.patch('/admin/threads/:id', async (request) => {
    const { id } = request.params as { id: string };
    updateThreadRequestSchema.parse(request.body);

    unwrapOrThrow(await deps.closeThread.execute(id));
    return { status: 'CLOSED' };
  });

  // ── visitor enquiries ─────────────────────────────────────────────────────

  app.get('/admin/contact-enquiries', async (request) => {
    const query = adminEnquiryListQuerySchema.parse(request.query);
    const { rows, total } = await deps.uow.repos.contactEnquiries.list(query);

    return {
      items: rows.map((enquiry) => ({ ...enquiry, createdAt: enquiry.createdAt.toISOString(), repliedAt: enquiry.repliedAt?.toISOString() ?? null })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  app.patch('/admin/contact-enquiries/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateEnquiryRequestSchema.parse(request.body);

    const existing = await deps.uow.repos.contactEnquiries.findById(id);
    if (!existing) throw Errors.notFound('Enquiry');

    const updated = await deps.uow.repos.contactEnquiries.update(id, {
      status: body.status,
      adminNote: body.adminNote,
      repliedAt: body.status === 'REPLIED' ? deps.clock.now() : null,
    });

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      repliedAt: updated.repliedAt?.toISOString() ?? null,
    };
  });
}

/**
 * An appointment the admin already has context for, without the joined user
 * row. Unlike the client serialiser it keeps `adminNotes` and always shows the
 * meeting link, including after the appointment — the CA needs to see which
 * room a client was sent to.
 */
function toClientAppointmentForAdmin(appointment: Appointment) {
  return {
    id: appointment.id,
    reference: appointment.reference,
    serviceId: appointment.serviceId,
    serviceName: appointment.serviceName,
    amountPaise: appointment.amountPaise,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    meetingUrl: appointment.meetingUrl,
    userNotes: appointment.userNotes,
    adminNotes: appointment.adminNotes,
    cancellationReason: appointment.cancellationReason,
    supersededBy: appointment.supersededBy,
    createdAt: appointment.createdAt.toISOString(),
  };
}
