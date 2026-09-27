import { describe, expect, it } from 'vitest';
import { aConsultation, aTestContext, IST } from '../helpers/test-context.js';
import { zonedToInstant } from '../../src/domain/shared/time.js';

const MONDAY = '2026-09-21'; // a Monday
const at = (time: string, date = MONDAY) => zonedToInstant(date, time, IST);

function ctx(build: (b: ReturnType<typeof aTestContext>) => ReturnType<typeof aTestContext> = (b) => b) {
  const service = aConsultation();
  return build(
    aTestContext()
      .withClock('2026-09-16T09:00:00+05:30')
      .withCaProfile({ defaultMeetingUrl: 'https://meet.example/ca-room' })
      .withService('consult', service)
      .withRule({ dayOfWeek: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 30 }),
  ).build();
}

describe('BookAppointment — the happy path', () => {
  it('confirms immediately, with no pending state', async () => {
    const c = ctx();

    const result = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: 'Question about capital gains',
      idempotencyKey: null,
    });

    expect(result).toBeOk();
    if (!result.ok) return;
    expect(result.value.status).toBe('CONFIRMED');
    expect(result.value.reference).toMatch(/^APT-2026-\d{6}$/);
  });

  it('snapshots the meeting link from the CA profile', async () => {
    // Auto-confirm means the confirmation email leaves within seconds, so the
    // link has to be resolved now rather than by an admin later.
    const c = ctx();

    const result = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value.meetingUrl).toBe('https://meet.example/ca-room');
  });

  it('snapshots the price and name, so later edits do not rewrite history', async () => {
    const c = ctx();

    const result = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(result).toBeOk();
    if (result.ok) {
      expect(result.value.amountPaise).toBe(149900);
      expect(result.value.serviceName).toBe('Tax Planning Consultation');
    }
  });

  it('writes the status history entry', async () => {
    const c = ctx();

    await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(c.stores.appointments.history).toHaveLength(1);
    expect(c.stores.appointments.history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'CONFIRMED',
      actorRole: 'USER',
    });
  });

  it('enqueues confirmation, reminder and admin notice — email only', async () => {
    const c = ctx();

    await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(c.outbox.templateKeys()).toEqual([
      'appointment.confirmed',
      'appointment.reminder',
      'admin.appointment.booked',
    ]);
    // v1 ships email-only; SMS stays dark until DLT templates clear.
    expect(c.outbox.entries.filter((e) => e.channel === 'SMS')).toHaveLength(0);
  });

  it('future-dates the reminder to 24 hours before the appointment', async () => {
    const c = ctx();

    await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    const reminder = c.outbox.byTemplate('appointment.reminder')[0]!;
    expect(reminder.scheduledFor?.toISOString()).toBe('2026-09-20T05:30:00.000Z');
  });
});

describe('BookAppointment — guards', () => {
  it('refuses a user who has not finished onboarding', async () => {
    const c = ctx((b) => b.withUser('fresh', { profileCompletedAt: null }));

    const result = await c.bookAppointment.execute({
      userId: c.users.fresh!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(result).toBeErr('PROFILE_INCOMPLETE');
    expect(c.outbox.entries).toHaveLength(0);
  });

  it('refuses a suspended account', async () => {
    const c = ctx((b) => b.withUser('banned', { status: 'BLOCKED' }));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.banned!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('ACCOUNT_BLOCKED');
  });

  it('refuses a user locked out after three no-shows', async () => {
    const c = ctx((b) => b.withUser('flaky', { noShowCount: 3 }));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.flaky!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('FORBIDDEN');
  });

  it('refuses an unknown or withdrawn service', async () => {
    const c = ctx();

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: '00000000-0000-4000-a000-000000000999',
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('NOT_FOUND');
  });

  it('refuses when the practice has no meeting room set up', async () => {
    // Without a room there is nothing to put in the confirmation email, so
    // booking must not proceed.
    const c = ctx((b) => b.withCaProfile({ defaultMeetingUrl: null, isPublished: false }));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('VALIDATION_FAILED');
  });
});

describe('BookAppointment — slot validity', () => {
  it('refuses a time that is open but off the grid', async () => {
    // 10:07 sits inside the window. The grid is part of the contract, so a
    // hand-crafted POST must fail even though the date picker would never
    // offer it.
    const c = ctx();

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('10:07'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('refuses a time outside the published hours', async () => {
    const c = ctx();

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('19:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('refuses a slot on a blocked date', async () => {
    const c = ctx((b) => b.withException({ onDate: MONDAY, reason: 'Holiday' }));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('refuses a slot in the past', async () => {
    const c = ctx();

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00', '2026-09-14'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('refuses a slot inside the two-hour lead time', async () => {
    const c = ctx((b) => b.withClock('2026-09-21T10:00:00+05:30'));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('refuses a slot already taken by someone else', async () => {
    const c = ctx((b) => b.withUser('other'));

    await c.bookAppointment.execute({
      userId: c.users.other!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('SLOT_UNAVAILABLE');
  });

  it('leaves the adjacent slot bookable', async () => {
    const c = ctx((b) => b.withUser('other'));

    await c.bookAppointment.execute({
      userId: c.users.other!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:30'),
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeOk();
  });
});

describe('BookAppointment — abuse brakes', () => {
  it('refuses a fourth upcoming appointment', async () => {
    const c = ctx((b) =>
      b.withRule({ dayOfWeek: 2, startTime: '10:00', endTime: '13:00', slotMinutes: 30 })
       .withRule({ dayOfWeek: 3, startTime: '10:00', endTime: '13:00', slotMinutes: 30 })
       .withPolicy({ maxPerUserPerDay: 99 }),
    );

    const book = (time: string, date: string) =>
      c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: zonedToInstant(date, time, IST),
        notes: null,
        idempotencyKey: null,
      });

    expect(await book('10:00', MONDAY)).toBeOk();
    expect(await book('10:00', '2026-09-22')).toBeOk();
    expect(await book('10:00', '2026-09-23')).toBeOk();
    expect(await book('10:30', MONDAY)).toBeErr('BOOKING_LIMIT_REACHED');
  });

  it('refuses a third booking made on the same day', async () => {
    const c = ctx((b) => b.withPolicy({ maxPerUserPerDay: 2, maxUpcomingPerUser: 99 }));

    const book = (time: string) =>
      c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at(time),
        notes: null,
        idempotencyKey: null,
      });

    expect(await book('10:00')).toBeOk();
    expect(await book('10:30')).toBeOk();
    expect(await book('11:00')).toBeErr('BOOKING_LIMIT_REACHED');
  });
});

describe('BookAppointment — idempotency', () => {
  it('returns the original booking when the same key is replayed', async () => {
    const c = ctx();

    const first = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: 'key-1',
    });

    const second = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: at('11:00'),
      notes: null,
      idempotencyKey: 'key-1',
    });

    expect(first).toBeOk();
    expect(second).toBeOk();
    if (first.ok && second.ok) expect(second.value.id).toBe(first.value.id);

    expect(c.stores.appointments.appointments.size).toBe(1);
    // And crucially, exactly one confirmation email.
    expect(c.outbox.byTemplate('appointment.confirmed')).toHaveLength(1);
  });

  it('lets a different user reuse the same key', async () => {
    const c = ctx((b) => b.withUser('other'));

    expect(
      await c.bookAppointment.execute({
        userId: c.users.client!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:00'),
        notes: null,
        idempotencyKey: 'key-1',
      }),
    ).toBeOk();

    expect(
      await c.bookAppointment.execute({
        userId: c.users.other!.id,
        serviceId: c.services.consult!.id,
        startsAt: at('11:30'),
        notes: null,
        idempotencyKey: 'key-1',
      }),
    ).toBeOk();
  });
});
