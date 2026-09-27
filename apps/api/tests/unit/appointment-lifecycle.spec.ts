import { describe, expect, it } from 'vitest';
import { aConsultation, aTestContext, IST } from '../helpers/test-context.js';
import { zonedToInstant } from '../../src/domain/shared/time.js';

const MONDAY = '2026-09-21';
const at = (time: string, date = MONDAY) => zonedToInstant(date, time, IST);

async function bookedContext() {
  const c = aTestContext()
    .withClock('2026-09-16T09:00:00+05:30')
    .withCaProfile()
    .withService('consult', aConsultation())
    .withRule({ dayOfWeek: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 30 })
    .withRule({ dayOfWeek: 2, startTime: '10:00', endTime: '13:00', slotMinutes: 30 })
    .build();

  const booked = await c.bookAppointment.execute({
    userId: c.users.client!.id,
    serviceId: c.services.consult!.id,
    startsAt: at('11:00'),
    notes: null,
    idempotencyKey: null,
  });

  if (!booked.ok) throw new Error('setup failed to book');
  c.outbox.entries.length = 0; // ignore the booking mails in these assertions
  return { c, appointment: booked.value };
}

describe('CancelAppointment — by the client', () => {
  it('cancels well inside the window and emails both sides', async () => {
    const { c, appointment } = await bookedContext();

    const result = await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'Something came up at work',
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value.status).toBe('CANCELLED_BY_USER');

    expect(c.outbox.templateKeys()).toEqual([
      'appointment.cancelled',
      'admin.appointment.cancelled_by_user',
    ]);
  });

  it('refuses inside the 12-hour window', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T00:00:00+05:30'); // 11 hours before

    const result = await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'Too late',
    });

    expect(result).toBeErr('CANCEL_WINDOW_CLOSED');
    expect(c.outbox.entries).toHaveLength(0);
  });

  it('hides someone else’s appointment behind a 404', async () => {
    const { c, appointment } = await bookedContext();
    c.stores.userRepo.seed({ ...c.users.client!, id: 'intruder-id', email: 'x@y.test' } as never);

    const result = await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: 'intruder-id',
      actorRole: 'USER',
      reason: 'nosy',
    });

    // A 403 would confirm the appointment exists.
    expect(result).toBeErr('NOT_FOUND');
  });

  it('frees the slot for someone else', async () => {
    const { c, appointment } = await bookedContext();

    await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'Changed my mind',
    });

    c.stores.userRepo.seed({ ...c.users.client!, id: 'second-client', email: 'b@c.test' } as never);

    expect(
      await c.bookAppointment.execute({
        userId: 'second-client',
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeOk();
  });

  it('refuses to cancel twice', async () => {
    const { c, appointment } = await bookedContext();

    await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'first',
    });

    expect(
      await c.cancelAppointment.execute({
        appointmentId: appointment.id,
        actorId: c.users.client!.id,
        actorRole: 'USER',
        reason: 'second',
      }),
    ).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
  });
});

describe('CancelAppointment — by the CA', () => {
  it('cancels at any notice, and does not email itself', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T10:55:00+05:30'); // five minutes before

    const result = await c.cancelAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      reason: 'Called into a hearing',
    });

    expect(result).toBeOk();
    expect(c.outbox.templateKeys()).toEqual(['appointment.cancelled']);
  });
});

describe('RescheduleAppointment', () => {
  it('creates a successor and marks the original RESCHEDULED', async () => {
    const { c, appointment } = await bookedContext();

    const result = await c.rescheduleAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      startsAt: at('12:00'),
      notifyUser: true,
    });

    expect(result).toBeOk();
    if (!result.ok) return;

    expect(result.value.id).not.toBe(appointment.id);
    expect(result.value.status).toBe('CONFIRMED');

    const original = await c.repos.appointments.findById(appointment.id);
    expect(original?.status).toBe('RESCHEDULED');
    expect(original?.supersededBy).toBe(result.value.id);
  });

  it('preserves the original record rather than moving it', async () => {
    // Someone asking "when was this originally?" after a complaint needs the
    // old time to still exist.
    const { c, appointment } = await bookedContext();

    await c.rescheduleAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      startsAt: at('12:00'),
      notifyUser: true,
    });

    const original = await c.repos.appointments.findById(appointment.id);
    expect(original?.startsAt.toISOString()).toBe(at('11:00').toISOString());
  });

  it('lets an appointment move within its own hour without colliding with itself', async () => {
    const { c, appointment } = await bookedContext();

    expect(
      await c.rescheduleAppointment.execute({
        appointmentId: appointment.id,
        actorId: c.users.client!.id,
        actorRole: 'USER',
        startsAt: at('11:30'),
        notifyUser: true,
      }),
    ).toBeOk();
  });

  it('holds the client to the 12-hour window', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T06:00:00+05:30');

    expect(
      await c.rescheduleAppointment.execute({
        appointmentId: appointment.id,
        actorId: c.users.client!.id,
        actorRole: 'USER',
        startsAt: at('12:30'),
        notifyUser: true,
      }),
    ).toBeErr('CANCEL_WINDOW_CLOSED');
  });

  it('places no such limit on the CA', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T06:00:00+05:30');

    expect(
      await c.rescheduleAppointment.execute({
        appointmentId: appointment.id,
        actorId: c.users.admin!.id,
        actorRole: 'ADMIN',
        startsAt: at('12:30'),
        notifyUser: true,
      }),
    ).toBeOk();
  });

  it('refuses a destination that is already taken', async () => {
    const { c, appointment } = await bookedContext();
    c.stores.userRepo.seed({ ...c.users.client!, id: 'other-client', email: 'o@c.test' } as never);

    await c.bookAppointment.execute({
      userId: 'other-client',
      serviceId: c.services.consult!.id,
      startsAt: at('12:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.rescheduleAppointment.execute({
        appointmentId: appointment.id,
        actorId: c.users.client!.id,
        actorRole: 'USER',
        startsAt: at('12:00'),
        notifyUser: true,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('re-arms the reminder for the new time', async () => {
    const { c, appointment } = await bookedContext();

    await c.rescheduleAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      startsAt: at('12:00'),
      notifyUser: true,
    });

    const reminder = c.outbox.byTemplate('appointment.reminder')[0]!;
    expect(reminder.scheduledFor?.toISOString()).toBe('2026-09-20T06:30:00.000Z');
  });

  it('sends nothing when the CA suppresses the notification', async () => {
    const { c, appointment } = await bookedContext();

    await c.rescheduleAppointment.execute({
      appointmentId: appointment.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      startsAt: at('12:00'),
      notifyUser: false,
    });

    expect(c.outbox.entries).toHaveLength(0);
  });
});

describe('UpdateAppointment — admin outcomes', () => {
  it('marks an appointment complete once it has started', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T11:40:00+05:30');

    const result = await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      status: 'COMPLETED',
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value.status).toBe('COMPLETED');
  });

  it('refuses to complete an appointment that has not started', async () => {
    const { c, appointment } = await bookedContext();

    expect(
      await c.updateAppointment.execute({
        appointmentId: appointment.id,
        adminId: c.users.admin!.id,
        status: 'COMPLETED',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('counts a no-show against the client', async () => {
    const { c, appointment } = await bookedContext();
    c.clock.set('2026-09-21T12:00:00+05:30');

    await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      status: 'NO_SHOW',
    });

    const user = await c.repos.users.findById(c.users.client!.id);
    expect(user?.noShowCount).toBe(1);
  });

  it('locks booking after the third no-show', async () => {
    const { c, appointment } = await bookedContext();
    c.stores.userRepo.seed({ ...c.users.client!, noShowCount: 2 });
    c.clock.set('2026-09-21T12:00:00+05:30');

    await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      status: 'NO_SHOW',
    });

    c.clock.set('2026-09-21T13:00:00+05:30');

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('10:00', '2026-09-22'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('FORBIDDEN');
  });

  it('refuses an admin cancellation with no reason', async () => {
    const { c, appointment } = await bookedContext();

    expect(
      await c.updateAppointment.execute({
        appointmentId: appointment.id,
        adminId: c.users.admin!.id,
        status: 'CANCELLED_BY_ADMIN',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('tells the client when the meeting link changes', async () => {
    const { c, appointment } = await bookedContext();

    await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      meetingUrl: 'https://meet.example/different-room',
    });

    expect(c.outbox.templateKeys()).toContain('appointment.meeting_url_changed');
  });

  it('does not email about private notes', async () => {
    const { c, appointment } = await bookedContext();

    await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      adminNotes: 'Client sounded stressed — go gently on the penalty question',
    });

    expect(c.outbox.entries).toHaveLength(0);
  });

  it('records every admin change in the audit log', async () => {
    const { c, appointment } = await bookedContext();

    await c.updateAppointment.execute({
      appointmentId: appointment.id,
      adminId: c.users.admin!.id,
      adminNotes: 'note',
    });

    expect(c.audit.entries).toHaveLength(1);
    expect(c.audit.entries[0]).toMatchObject({
      action: 'appointment.updated',
      entityType: 'appointment',
    });
  });
});
