import { z } from 'zod';

/**
 * Config is parsed once, at boot, and the process exits if it is wrong.
 * A missing key should kill the process at second zero — not surface as a 500
 * at 2 a.m. when the first request needs it.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),

  // Required from slice 2. Optional now so the walking skeleton runs with no
  // Supabase project at all — a skeleton you cannot start teaches nothing.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Local development and e2e only: Supabase's local stack signs with HS256. */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),

  // Booking policy — slice 6. Defaults are the values agreed in §5.2.
  BOOKING_MIN_LEAD_MINUTES: z.coerce.number().int().nonnegative().default(120),
  BOOKING_MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(60),
  BOOKING_CANCEL_WINDOW_HOURS: z.coerce.number().int().nonnegative().default(12),
  BOOKING_MAX_UPCOMING_PER_USER: z.coerce.number().int().positive().default(3),
  BOOKING_MAX_PER_USER_PER_DAY: z.coerce.number().int().positive().default(2),
  BOOKING_NO_SHOW_LOCKOUT: z.coerce.number().int().positive().default(3),

  // Notifications — slice 10. SMS stays dark until DLT templates clear.
  NOTIFY_EMAIL_ENABLED: booleanish.default(true),
  NOTIFY_SMS_ENABLED: booleanish.default(false),
  EMAIL_FROM: z.string().default('CA Consult <no-reply@ca-consult.test>'),
  RESEND_API_KEY: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  /** The DLT-approved template id. Required before SMS can be switched on. */
  MSG91_FLOW_ID: z.string().optional(),

  // Captcha — slice 9.
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
