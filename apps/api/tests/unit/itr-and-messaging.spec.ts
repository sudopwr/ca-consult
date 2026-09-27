import { describe, expect, it } from 'vitest';
import { aConsultation, anItrService, aTestContext, IST } from '../helpers/test-context.js';
import { zonedToInstant } from '../../src/domain/shared/time.js';

const MONDAY = '2026-09-21';

function itrContext() {
  return aTestContext()
    .withClock('2026-09-16T09:00:00+05:30')
    .withCaProfile()
    .withService('itr1', anItrService())
    .withService('itr2', anItrService({ slug: 'itr-2', name: 'ITR-2', itrFormType: 'ITR-2' }))
    .build();
}

describe('RegisterItrEngagement', () => {
  it('registers as SUBMITTED, not confirmed', async () => {
    // Unlike booking, an ITR engagement is work the CA has to accept.
    const c = itrContext();

    const result = await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: 'First time filing',
      idempotencyKey: null,
    });

    expect(result).toBeOk();
    if (result.ok) {
      expect(result.value.status).toBe('SUBMITTED');
      expect(result.value.reference).toMatch(/^ITR-2026-\d{6}$/);
      expect(result.value.assessmentYear).toBe('AY 2026-27');
    }
  });

  it('never stores a PAN at registration', async () => {
    // A government identifier does not belong in a public form. The CA asks
    // for it through INFO_REQUESTED once the filing needs it.
    const c = itrContext();

    const result = await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value.panNumber).toBeNull();
  });

  it('emails the client and the CA', async () => {
    const c = itrContext();

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    expect(c.outbox.templateKeys()).toEqual(['itr.registered', 'admin.itr.registered']);
  });

  it('refuses a second live engagement for the same year and form', async () => {
    const c = itrContext();

    const register = () =>
      c.registerItrEngagement.execute({
        userId: c.users.client!.id,
        serviceId: c.services.itr1!.id,
        hasBusinessIncome: false,
        notes: null,
        idempotencyKey: null,
      });

    expect(await register()).toBeOk();
    expect(await register()).toBeErr('DUPLICATE_ENGAGEMENT');
  });

  it('allows a different form type for the same year', async () => {
    const c = itrContext();

    expect(
      await c.registerItrEngagement.execute({
        userId: c.users.client!.id,
        serviceId: c.services.itr1!.id,
        hasBusinessIncome: false,
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeOk();

    expect(
      await c.registerItrEngagement.execute({
        userId: c.users.client!.id,
        serviceId: c.services.itr2!.id,
        hasBusinessIncome: false,
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeOk();
  });

  it('allows re-registering after a cancellation', async () => {
    const c = itrContext();

    const first = await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });
    if (!first.ok) throw new Error('setup failed');

    await c.advanceItrEngagement.execute({
      engagementId: first.value.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      status: 'CANCELLED_BY_USER',
    });

    expect(
      await c.registerItrEngagement.execute({
        userId: c.users.client!.id,
        serviceId: c.services.itr1!.id,
        hasBusinessIncome: false,
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeOk();
  });

  it('refuses a user who has not finished onboarding', async () => {
    const c = aTestContext()
      .withCaProfile()
      .withService('itr1', anItrService())
      .withUser('fresh', { profileCompletedAt: null })
      .build();

    expect(
      await c.registerItrEngagement.execute({
        userId: c.users.fresh!.id,
        serviceId: c.services.itr1!.id,
        hasBusinessIncome: false,
        notes: null,
        idempotencyKey: null,
      }),
    ).toBeErr('PROFILE_INCOMPLETE');
  });
});

describe('AdvanceItrEngagement', () => {
  async function registered() {
    const c = itrContext();
    const result = await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });
    if (!result.ok) throw new Error('setup failed');
    c.outbox.entries.length = 0;
    return { c, engagement: result.value };
  }

  it('walks the happy path to COMPLETED', async () => {
    const { c, engagement } = await registered();
    const admin = c.users.admin!.id;

    const step = (status: string, extra: Record<string, unknown> = {}) =>
      c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: admin,
        actorRole: 'ADMIN',
        status: status as never,
        ...extra,
      });

    expect(await step('IN_REVIEW')).toBeOk();
    expect(await step('IN_PROGRESS')).toBeOk();
    expect(await step('FILED', { acknowledgementNumber: '123456789012345' })).toBeOk();

    const final = await step('COMPLETED');
    expect(final).toBeOk();
    if (final.ok) expect(final.value.status).toBe('COMPLETED');
  });

  it('refuses FILED without an acknowledgement number', async () => {
    const { c, engagement } = await registered();

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      status: 'IN_PROGRESS',
    });

    expect(
      await c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: c.users.admin!.id,
        actorRole: 'ADMIN',
        status: 'FILED',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('refuses INFO_REQUESTED with no text for the client to read', async () => {
    const { c, engagement } = await registered();

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      status: 'IN_REVIEW',
    });

    expect(
      await c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: c.users.admin!.id,
        actorRole: 'ADMIN',
        status: 'INFO_REQUESTED',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('emails the client what is needed when information is requested', async () => {
    const { c, engagement } = await registered();

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      status: 'IN_REVIEW',
    });
    c.outbox.entries.length = 0;

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      status: 'INFO_REQUESTED',
      infoRequested: 'Please send your Form 16 and bank interest certificate.',
    });

    const mail = c.outbox.byTemplate('itr.info_requested')[0];
    expect(mail).toBeDefined();
    expect(mail!.payload.infoRequested).toMatch(/Form 16/);
  });

  it('lets only an admin record a PAN', async () => {
    const { c, engagement } = await registered();

    expect(
      await c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: c.users.client!.id,
        actorRole: 'USER',
        panNumber: 'ABCDE1234F',
      }),
    ).toBeErr('FORBIDDEN');
  });

  it('records a valid PAN and rejects a malformed one', async () => {
    const { c, engagement } = await registered();

    expect(
      await c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: c.users.admin!.id,
        actorRole: 'ADMIN',
        panNumber: 'ABCDE1234',
      }),
    ).toBeErr('VALIDATION_FAILED');

    const good = await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      panNumber: 'abcde1234f',
    });

    expect(good).toBeOk();
    if (good.ok) expect(good.value.panNumber).toBe('ABCDE1234F');
  });

  it('never writes an unmasked PAN to the audit log', async () => {
    const { c, engagement } = await registered();

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.admin!.id,
      actorRole: 'ADMIN',
      panNumber: 'ABCDE1234F',
    });

    const entry = c.audit.entries.at(-1)!;
    expect(entry.diff?.pan).toBe('ABCDE****F');
    expect(JSON.stringify(entry)).not.toContain('ABCDE1234F');
  });

  it('sends no email when the client cancels their own engagement', async () => {
    const { c, engagement } = await registered();

    await c.advanceItrEngagement.execute({
      engagementId: engagement.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      status: 'CANCELLED_BY_USER',
    });

    expect(c.outbox.entries).toHaveLength(0);
  });

  it('hides another user’s engagement behind a 404', async () => {
    const { c, engagement } = await registered();
    c.stores.userRepo.seed({ ...c.users.client!, id: 'intruder', email: 'i@x.test' } as never);

    expect(
      await c.advanceItrEngagement.execute({
        engagementId: engagement.id,
        actorId: 'intruder',
        actorRole: 'USER',
        status: 'CANCELLED_BY_USER',
      }),
    ).toBeErr('NOT_FOUND');
  });
});

describe('the messaging gate', () => {
  function messagingContext() {
    return aTestContext()
      .withClock('2026-09-16T09:00:00+05:30')
      .withCaProfile()
      .withService('consult', aConsultation())
      .withService('itr1', anItrService())
      .withRule({ dayOfWeek: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 30 })
      .build();
  }

  it('refuses a user with no engagements', async () => {
    const c = messagingContext();

    const result = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'A question',
      body: 'Can you help with my taxes?',
      appointmentId: null,
      engagementId: null,
    });

    expect(result).toBeErr('NO_ENGAGEMENT');
  });

  it('points a refused user at the contact form', async () => {
    const c = messagingContext();

    const result = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'A question',
      body: 'Can you help?',
      appointmentId: null,
      engagementId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toMatch(/contact form/i);
  });

  it('allows a user who has booked a consultation', async () => {
    const c = messagingContext();

    await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: zonedToInstant(MONDAY, '11:00', IST),
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.startThread.execute({
        userId: c.users.client!.id,
        subject: 'Before our call',
        body: 'Should I bring last year’s return?',
        appointmentId: null,
        engagementId: null,
      }),
    ).toBeOk();
  });

  it('allows a user with only an ITR engagement', async () => {
    const c = messagingContext();

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.startThread.execute({
        userId: c.users.client!.id,
        subject: 'Documents',
        body: 'Which documents do you need?',
        appointmentId: null,
        engagementId: null,
      }),
    ).toBeOk();
  });

  it('refuses when the only engagement has been cancelled', async () => {
    const c = messagingContext();

    const booked = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: zonedToInstant(MONDAY, '11:00', IST),
      notes: null,
      idempotencyKey: null,
    });
    if (!booked.ok) throw new Error('setup failed');

    await c.cancelAppointment.execute({
      appointmentId: booked.value.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'Changed my mind',
    });

    expect(
      await c.startThread.execute({
        userId: c.users.client!.id,
        subject: 'Hello',
        body: 'Still want to ask something',
        appointmentId: null,
        engagementId: null,
      }),
    ).toBeErr('NO_ENGAGEMENT');
  });

  it('still lets them reply to an existing thread after cancelling', async () => {
    // Killing a half-finished conversation because the appointment was
    // cancelled is tidy in a spec and infuriating in practice — the
    // cancellation is often exactly what they are discussing.
    const c = messagingContext();

    const booked = await c.bookAppointment.execute({
      userId: c.users.client!.id,
      serviceId: c.services.consult!.id,
      startsAt: zonedToInstant(MONDAY, '11:00', IST),
      notes: null,
      idempotencyKey: null,
    });
    if (!booked.ok) throw new Error('setup failed');

    const thread = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'About my booking',
      body: 'I may need to move this',
      appointmentId: null,
      engagementId: null,
    });
    if (!thread.ok) throw new Error('setup failed');

    await c.cancelAppointment.execute({
      appointmentId: booked.value.id,
      actorId: c.users.client!.id,
      actorRole: 'USER',
      reason: 'Conflict',
    });

    expect(
      await c.postMessage.execute({
        threadId: thread.value.id,
        senderId: c.users.client!.id,
        senderRole: 'USER',
        body: 'I have cancelled — can we find another time?',
      }),
    ).toBeOk();
  });

  it('refuses to attach a thread to someone else’s appointment', async () => {
    const c = messagingContext();
    c.stores.userRepo.seed({ ...c.users.client!, id: 'other', email: 'o@x.test' } as never);

    const booked = await c.bookAppointment.execute({
      userId: 'other',
      serviceId: c.services.consult!.id,
      startsAt: zonedToInstant(MONDAY, '11:00', IST),
      notes: null,
      idempotencyKey: null,
    });
    if (!booked.ok) throw new Error('setup failed');

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    expect(
      await c.startThread.execute({
        userId: c.users.client!.id,
        subject: 'Nosy',
        body: 'Tell me about this appointment',
        appointmentId: booked.value.id,
        engagementId: null,
      }),
    ).toBeErr('NOT_FOUND');
  });

  it('moves the thread to the other side on each message', async () => {
    const c = messagingContext();

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    const thread = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'Documents',
      body: 'Which ones?',
      appointmentId: null,
      engagementId: null,
    });
    if (!thread.ok) throw new Error('setup failed');

    expect((await c.repos.messages.findThread(thread.value.id))?.status).toBe('AWAITING_ADMIN');

    await c.postMessage.execute({
      threadId: thread.value.id,
      senderId: c.users.admin!.id,
      senderRole: 'ADMIN',
      body: 'Form 16 and your bank statements, please.',
    });

    const after = await c.repos.messages.findThread(thread.value.id);
    expect(after?.status).toBe('AWAITING_USER');
    expect(after?.unreadForUser).toBe(1);
  });

  it('reopens a closed thread when someone posts to it', async () => {
    const c = messagingContext();

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    const thread = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'Done?',
      body: 'Anything else?',
      appointmentId: null,
      engagementId: null,
    });
    if (!thread.ok) throw new Error('setup failed');

    await c.repos.messages.setThreadStatus(thread.value.id, 'CLOSED');

    await c.postMessage.execute({
      threadId: thread.value.id,
      senderId: c.users.client!.id,
      senderRole: 'USER',
      body: 'One more thing',
    });

    expect((await c.repos.messages.findThread(thread.value.id))?.status).toBe('AWAITING_ADMIN');
  });

  it('hides another user’s thread behind a 404', async () => {
    const c = messagingContext();
    c.stores.userRepo.seed({ ...c.users.client!, id: 'intruder', email: 'i@x.test' } as never);

    await c.registerItrEngagement.execute({
      userId: c.users.client!.id,
      serviceId: c.services.itr1!.id,
      hasBusinessIncome: false,
      notes: null,
      idempotencyKey: null,
    });

    const thread = await c.startThread.execute({
      userId: c.users.client!.id,
      subject: 'Private',
      body: 'Something personal',
      appointmentId: null,
      engagementId: null,
    });
    if (!thread.ok) throw new Error('setup failed');

    expect(
      await c.postMessage.execute({
        threadId: thread.value.id,
        senderId: 'intruder',
        senderRole: 'USER',
        body: 'Who are you?',
      }),
    ).toBeErr('NOT_FOUND');
  });
});

describe('SubmitContactEnquiry', () => {
  const base = {
    name: 'Visitor',
    email: 'visitor@example.test',
    phone: null,
    subject: 'Do you handle capital gains?',
    body: 'I sold a flat this year and need help with the return.',
    captchaToken: 'token',
    honeypot: '',
    renderedAt: null,
    sourceIp: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
  };

  it('stores a genuine enquiry and emails both sides', async () => {
    const c = aTestContext().withCaProfile().build();

    const result = await c.submitContactEnquiry.execute(base);

    expect(result).toBeOk();
    if (result.ok) expect(result.value).toBe('STORED');
    expect(c.stores.enquiries.enquiries.size).toBe(1);
    expect(c.outbox.templateKeys()).toEqual(['contact.acknowledged', 'admin.contact.received']);
  });

  it('drops a honeypot submission without storing anything', async () => {
    const c = aTestContext().withCaProfile().build();

    const result = await c.submitContactEnquiry.execute({ ...base, honeypot: 'http://spam.example' });

    // Still a success from the caller's point of view — a bot that can tell a
    // rejection from an acceptance can tune itself until it gets through.
    expect(result).toBeOk();
    if (result.ok) expect(result.value).toBe('DROPPED_HONEYPOT');
    expect(c.stores.enquiries.enquiries.size).toBe(0);
    expect(c.outbox.entries).toHaveLength(0);
  });

  it('drops a submission that arrives too fast to have been typed', async () => {
    const c = aTestContext().withClock('2026-09-16T09:00:00+05:30').withCaProfile().build();

    const result = await c.submitContactEnquiry.execute({
      ...base,
      renderedAt: new Date('2026-09-16T09:00:00+05:30').getTime() - 800,
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value).toBe('DROPPED_TOO_FAST');
    expect(c.stores.enquiries.enquiries.size).toBe(0);
  });

  it('accepts a submission after a realistic dwell time', async () => {
    const c = aTestContext().withClock('2026-09-16T09:00:00+05:30').withCaProfile().build();

    const result = await c.submitContactEnquiry.execute({
      ...base,
      renderedAt: new Date('2026-09-16T09:00:00+05:30').getTime() - 45_000,
    });

    expect(result).toBeOk();
    if (result.ok) expect(result.value).toBe('STORED');
  });

  it('drops a submission that fails the captcha, silently', async () => {
    const c = aTestContext().withCaProfile().withFailingCaptcha().build();

    const result = await c.submitContactEnquiry.execute(base);

    expect(result).toBeOk();
    if (result.ok) expect(result.value).toBe('DROPPED_CAPTCHA');
    expect(c.stores.enquiries.enquiries.size).toBe(0);
    expect(c.outbox.entries).toHaveLength(0);
  });

  it('normalises the email before storing it', async () => {
    const c = aTestContext().withCaProfile().build();

    await c.submitContactEnquiry.execute({ ...base, email: '  Visitor@Example.TEST  ' });

    const stored = [...c.stores.enquiries.enquiries.values()][0]!;
    expect(stored.email).toBe('visitor@example.test');
  });
});
