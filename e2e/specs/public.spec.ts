import { test, expect } from '@playwright/test';

const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';

test.describe('the public site', () => {
  test('shows the practice profile and its charges', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'S. Mehta', level: 1 })).toBeVisible();
    await expect(page.getByText('Tax Planning Consultation')).toBeVisible();
    await expect(page.getByText('₹1,499')).toBeVisible();

    // ITR charges are on the same page — they are a price list as well as a
    // registrable service.
    await expect(page.getByText('ITR-1 · Salaried')).toBeVisible();
  });

  test('makes clear that bookings confirm instantly', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/confirmed instantly/i)).toBeVisible();
  });

  test('never exposes the meeting room link publicly', async ({ request }) => {
    // Anyone with this URL could walk into the CA's room without booking.
    const response = await request.get(`${API}/public/ca-profile`);
    const body = await response.json();

    expect(response.ok()).toBe(true);
    expect(body).not.toHaveProperty('defaultMeetingUrl');
    expect(JSON.stringify(body)).not.toContain('meet.google.com');
  });

  test('offers slots for a consultation without signing in', async ({ request }) => {
    const services = await (await request.get(`${API}/public/services?kind=CONSULTANCY`)).json();
    const service = services[0];

    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

    const response = await request.get(
      `${API}/public/availability?serviceId=${service.id}&from=${from}&to=${to}`,
    );

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(body.days.length).toBeGreaterThan(0);
  });

  test('refuses an availability window wider than the cap', async ({ request }) => {
    const services = await (await request.get(`${API}/public/services?kind=CONSULTANCY`)).json();

    const response = await request.get(
      `${API}/public/availability?serviceId=${services[0].id}&from=2026-01-01&to=2026-12-31`,
    );

    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_FAILED');
  });

  test('turns away an unauthenticated request for private data', async ({ request }) => {
    expect((await request.get(`${API}/me`)).status()).toBe(401);
  });

  test('answers an unknown route with problem+json, not an HTML error page', async ({ request }) => {
    const response = await request.get(`${API}/definitely-not-a-route`);

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

test.describe('the contact form', () => {
  test('accepts a genuine enquiry', async ({ page }) => {
    await page.goto('/contact');

    await page.getByLabel('Your name').fill('Priya Sharma');
    await page.getByLabel('Email').fill('priya@example.test');
    await page.getByLabel('Subject').fill('Capital gains on a flat');
    await page
      .getByLabel('Your message')
      .fill('I sold a flat this year and need help working out the gain.');

    // The form requires a few seconds of dwell time, so anything faster than
    // a human is dropped.
    await page.waitForTimeout(3500);
    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page.getByText(/that is with us/i)).toBeVisible();
  });

  test('always answers 202, whatever it did with the submission', async ({ request }) => {
    // A bot that can tell a rejection from an acceptance can tune itself.
    const spam = await request.post(`${API}/public/contact-enquiries`, {
      data: {
        name: 'Bot',
        email: 'bot@example.test',
        subject: 'Cheap backlinks',
        body: 'Buy our SEO services today, limited offer for your website.',
        captchaToken: 'x',
        website: 'http://spam.example', // honeypot filled
      },
    });

    expect(spam.status()).toBe(202);
    expect(await spam.json()).toEqual({ accepted: true });
  });
});
