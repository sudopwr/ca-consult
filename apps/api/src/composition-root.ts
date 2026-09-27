import type { FastifyInstance } from 'fastify';
import { parseEnv } from './config/env.js';
import type { Env } from './config/env.js';

import { createPool } from './infrastructure/db/pool.js';
import type { Pool } from './infrastructure/db/pool.js';
import { PgUnitOfWork } from './infrastructure/db/pg-unit-of-work.js';
import { SystemClock } from './infrastructure/system-clock.js';
import { ProcessProbe } from './infrastructure/health/process-probe.js';
import { DatabaseProbe, OutboxProbe } from './infrastructure/health/database-probe.js';
import {
  SharedSecretJwtVerifier,
  SupabaseJwtVerifier,
} from './infrastructure/auth/jwks-verifier.js';
import type { JwtVerifier } from './infrastructure/auth/jwks-verifier.js';
import {
  DisabledCaptchaVerifier,
  TurnstileVerifier,
} from './infrastructure/captcha/turnstile-verifier.js';
import {
  ConsoleEmailSender,
  Msg91SmsSender,
  NoopSmsSender,
  ResendEmailSender,
} from './infrastructure/notifications/senders.js';
import type { EmailSender, SmsSender } from './infrastructure/notifications/senders.js';

import { GetHealth } from './application/use-cases/get-health.js';
import { BookAppointment } from './application/use-cases/book-appointment.js';
import { CancelAppointment } from './application/use-cases/cancel-appointment.js';
import { RescheduleAppointment } from './application/use-cases/reschedule-appointment.js';
import { UpdateAppointment } from './application/use-cases/update-appointment.js';
import { ListAvailableSlots } from './application/use-cases/list-available-slots.js';
import { CompleteUserProfile } from './application/use-cases/complete-user-profile.js';
import { RegisterItrEngagement } from './application/use-cases/register-itr-engagement.js';
import { AdvanceItrEngagement } from './application/use-cases/advance-itr-engagement.js';
import {
  CloseThread,
  MarkThreadRead,
  PostMessage,
  StartThread,
} from './application/use-cases/messaging.js';
import { SubmitContactEnquiry } from './application/use-cases/submit-contact-enquiry.js';
import { GetMyEngagements } from './application/use-cases/get-my-engagements.js';
import { GetAdminDashboard } from './application/use-cases/get-admin-dashboard.js';
import { ManageCaProfile, ManageServices } from './application/use-cases/manage-catalogue.js';
import { ManageAvailability } from './application/use-cases/manage-schedule.js';
import { ManageUsers } from './application/use-cases/manage-users.js';

import { buildServer } from './interface/http/server.js';
import type { AppDeps } from './interface/http/dependencies.js';
import { OutboxWorker } from './interface/workers/outbox-worker.js';
import { ReminderWorker } from './interface/workers/reminder-worker.js';

/**
 * The only file that knows about every layer at once, and the only one the
 * boundaries lint rule exempts.
 *
 * Every swap the roadmap anticipates — a per-booking Zoom link instead of the
 * permanent room, a different mailer, SMS once DLT clears — is an edit here
 * and nowhere else.
 */

export const SERVICE_NAME = 'ca-consult-api';
export const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

export interface App {
  server: FastifyInstance;
  outboxWorker: OutboxWorker;
  reminderWorker: ReminderWorker;
  pool: Pool;
  env: Env;
}

function chooseVerifier(env: Env): JwtVerifier {
  // Supabase's local stack signs with a shared secret rather than publishing a
  // JWKS, so local development and e2e select this path. Production always has
  // SUPABASE_URL and no secret, and therefore always verifies asymmetrically.
  if (env.SUPABASE_JWT_SECRET) return new SharedSecretJwtVerifier(env.SUPABASE_JWT_SECRET);
  if (env.SUPABASE_URL) return new SupabaseJwtVerifier(env.SUPABASE_URL);

  throw new Error('Set SUPABASE_URL (or SUPABASE_JWT_SECRET for local development)');
}

function chooseEmailSender(env: Env, log: (msg: string) => void): EmailSender {
  if (env.NOTIFY_EMAIL_ENABLED && env.RESEND_API_KEY) {
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  log('email delivery is not configured — messages will be logged, not sent');
  return new ConsoleEmailSender();
}

function chooseSmsSender(env: Env, log: (msg: string) => void): SmsSender {
  // SMS stays dark until TRAI DLT registration clears. The sender is written
  // and tested; only this branch keeps it from being used.
  if (!env.NOTIFY_SMS_ENABLED) return new NoopSmsSender();

  if (env.MSG91_AUTH_KEY && env.MSG91_SENDER_ID && env.MSG91_FLOW_ID) {
    return new Msg91SmsSender(env.MSG91_AUTH_KEY, env.MSG91_SENDER_ID, env.MSG91_FLOW_ID);
  }

  log('NOTIFY_SMS_ENABLED is on but MSG91 is not configured — SMS will be skipped');
  return new NoopSmsSender();
}

export async function createApp(overrides: Partial<Env> = {}): Promise<App> {
  const env = { ...parseEnv(), ...overrides };
  const warn = (message: string) => console.warn(`[startup] ${message}`);

  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    ssl: env.NODE_ENV === 'production',
  });

  const clock = new SystemClock();
  const uow = new PgUnitOfWork(pool);

  const policy = {
    minLeadMinutes: env.BOOKING_MIN_LEAD_MINUTES,
    maxAdvanceDays: env.BOOKING_MAX_ADVANCE_DAYS,
    cancelWindowHours: env.BOOKING_CANCEL_WINDOW_HOURS,
    maxUpcomingPerUser: env.BOOKING_MAX_UPCOMING_PER_USER,
    maxPerUserPerDay: env.BOOKING_MAX_PER_USER_PER_DAY,
    noShowLockout: env.BOOKING_NO_SHOW_LOCKOUT,
  };

  const captcha = env.TURNSTILE_SECRET_KEY
    ? new TurnstileVerifier(env.TURNSTILE_SECRET_KEY)
    : (warn('TURNSTILE_SECRET_KEY is unset — the contact form has no captcha'),
      new DisabledCaptchaVerifier());

  const email = chooseEmailSender(env, warn);
  const sms = chooseSmsSender(env, warn);

  const deps: AppDeps = {
    clock,
    uow,
    policy,
    timezone: env.APP_TIMEZONE,

    getHealth: new GetHealth({
      clock,
      probes: [
        new ProcessProbe(),
        new DatabaseProbe(pool),
        new OutboxProbe(() => uow.repos.outbox.counts()),
      ],
      startedAt: clock.now(),
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: env.NODE_ENV,
    }),

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
    markThreadRead: new MarkThreadRead({ uow, clock }),
    closeThread: new CloseThread({ uow }),
    submitContactEnquiry: new SubmitContactEnquiry({ uow, clock, captcha }),
    getMyEngagements: new GetMyEngagements({ uow, clock }),
    getAdminDashboard: new GetAdminDashboard({ uow, clock }),
    manageCaProfile: new ManageCaProfile({ uow }),
    manageServices: new ManageServices({ uow }),
    manageAvailability: new ManageAvailability({ uow }),
    manageUsers: new ManageUsers({ uow }),
  };

  const server = await buildServer({
    deps,
    verifier: chooseVerifier(env),
    webOrigin: env.WEB_ORIGIN,
    logLevel: env.LOG_LEVEL,
    isTest: env.NODE_ENV === 'test',
  });

  const outboxWorker = new OutboxWorker({
    outbox: uow.repos.outbox,
    email,
    sms,
    clock,
    logger: { info: (m) => server.log.info(m), error: (m) => server.log.error(m) },
  });

  const reminderWorker = new ReminderWorker({ uow, clock });

  return { server, outboxWorker, reminderWorker, pool, env };
}
