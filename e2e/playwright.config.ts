import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3001;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // §10.4 asks for a mobile booking spec; the project is wired now so
    // slice 6 only has to add the spec.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  // Both servers are started by Playwright itself, so `pnpm test:e2e` is the
  // whole command — no README step anyone can forget.
  webServer: [
    {
      command: 'pnpm --filter @ca/api build && pnpm --filter @ca/api start',
      cwd: '..',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        // Points at the local Supabase stack started by `supabase start`.
        // The shared JWT secret is what lets the fixture mint sessions
        // instead of driving real Google OAuth, which cannot be scripted.
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
        SUPABASE_JWT_SECRET:
          process.env.SUPABASE_JWT_SECRET ??
          'super-secret-jwt-token-with-at-least-32-characters-long',
        NOTIFY_EMAIL_ENABLED: 'false',
        NOTIFY_SMS_ENABLED: 'false',
      },
    },
    {
      command: `pnpm --filter @ca/web build && pnpm --filter @ca/web preview --port ${WEB_PORT} --host 127.0.0.1`,
      cwd: '..',
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}/api/v1`,
        VITE_SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? 'local-anon-key',
      },
    },
  ],
});
