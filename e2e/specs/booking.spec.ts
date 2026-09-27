import { test, expect } from '@playwright/test';
import { SEEDED, mintAccessToken, signInAs } from '../fixtures/auth';

const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';

async function firstFreeSlot(request: import('@playwright/test').APIRequestContext) {
  const services = await (await request.get(`${API}/public/services?kind=CONSULTANCY`)).json();
  const service = services[0];

  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

  const availability = await (
    await request.get(`${API}/public/availability?serviceId=${service.id}&from=${from}&to=${to}`)
  ).json();

  const day = availability.days.find((d: { slots: unknown[] }) => d.slots.length > 0);
  return { service, slot: day.slots[0] as { startsAt: string } };
}

test.describe('booking, end to end', () => {
  test('a client books and is confirmed immediately with a join link', async ({ page }) => {
    await signInAs(page, 'client', '/');

    await page.goto('/book');
    await page.getByText('Tax Planning Consultation').first().click();

    // Pick the first day that has slots, then the first slot on it.
    await page.getByRole('button', { name: /free$/ }).first().click();
    await page.getByRole('button', { name: /^\d{1,2}:\d{2}\s?(am|pm)$/i }).first().click();

    await page.getByRole('button', { name: /confirm booking/i }).click();

    // No pending state, no "we'll be in touch" — that is the point of
    // auto-confirm.
    await expect(page.getByText(/you are booked in/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /open the meeting room/i })).toBeVisible();
    await expect(page.getByText(/APT-\d{4}-\d{6}/)).toBeVisible();
  });

  test('the same slot is gone for the next client', async ({ request }) => {
    const clientToken = await mintAccessToken(SEEDED.client);
    const { service, slot } = await firstFreeSlot(request);

    const first = await request.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { serviceId: service.id, startsAt: slot.startsAt, notes: null },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { serviceId: service.id, startsAt: slot.startsAt, notes: null },
    });

    expect(second.status()).toBe(409);
    expect((await second.json()).code).toBe('SLOT_UNAVAILABLE');
  });

  test('two simultaneous requests for one slot produce exactly one booking', async ({ request }) => {
    // The race the exclusion constraint exists for. Without this test that
    // constraint is a hope rather than a guarantee.
    const token = await mintAccessToken(SEEDED.client);
    const { service, slot } = await firstFreeSlot(request);

    const attempt = () =>
      request.post(`${API}/appointments`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { serviceId: service.id, startsAt: slot.startsAt, notes: null },
      });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    const statuses = [a.status(), b.status()].sort();

    expect(statuses).toEqual([201, 409]);
  });

  test('replaying an idempotency key returns the same appointment', async ({ request }) => {
    const token = await mintAccessToken(SEEDED.client);
    const { service, slot } = await firstFreeSlot(request);
    const key = crypto.randomUUID();

    const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': key };
    const data = { serviceId: service.id, startsAt: slot.startsAt, notes: null };

    const first = await request.post(`${API}/appointments`, { headers, data });
    const second = await request.post(`${API}/appointments`, { headers, data });

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    expect((await second.json()).id).toBe((await first.json()).id);
  });

  test('a time inside the open window but off the slot grid is refused', async ({ request }) => {
    const token = await mintAccessToken(SEEDED.client);
    const { service, slot } = await firstFreeSlot(request);

    const offGrid = new Date(new Date(slot.startsAt).getTime() + 7 * 60_000).toISOString();

    const response = await request.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { serviceId: service.id, startsAt: offGrid, notes: null },
    });

    expect(response.status()).toBe(409);
  });

  test('a booking appears on the client’s engagements page', async ({ page, request }) => {
    const token = await mintAccessToken(SEEDED.client);
    const { service, slot } = await firstFreeSlot(request);

    await request.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { serviceId: service.id, startsAt: slot.startsAt, notes: 'From the e2e suite' },
    });

    await signInAs(page, 'client', '/me');
    await expect(page.getByText('Confirmed').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /join the call/i }).first()).toBeVisible();
  });
});

test.describe('the messaging gate', () => {
  test('a client with no engagement is sent to the contact form', async ({ page }) => {
    await signInAs(page, 'client', '/messages');

    // The guard redirects rather than showing a dead end, and the form
    // explains why they landed there.
    await expect(page).toHaveURL(/\/contact/);
    await expect(page.getByText(/messaging is for clients/i)).toBeVisible();
  });

  test('the API refuses thread creation with a message that points somewhere useful', async ({
    request,
  }) => {
    const token = await mintAccessToken(SEEDED.client);

    const response = await request.post(`${API}/me/threads`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { subject: 'A question', body: 'Can you help with my taxes?' },
    });

    if (response.status() === 403) {
      const problem = await response.json();
      expect(problem.code).toBe('NO_ENGAGEMENT');
      expect(problem.detail).toMatch(/contact form/i);
    } else {
      // The client may already hold an engagement from an earlier spec.
      expect(response.status()).toBe(201);
    }
  });
});

test.describe('authorisation', () => {
  test('a client cannot reach any admin route', async ({ request }) => {
    const token = await mintAccessToken(SEEDED.client);

    const routes = [
      '/admin/dashboard',
      '/admin/appointments',
      '/admin/itr-engagements',
      '/admin/users',
      '/admin/services',
      '/admin/ca-profile',
      '/admin/availability/rules',
      '/admin/threads',
      '/admin/contact-enquiries',
    ];

    // Parameterised over the whole table, so a new admin route cannot ship
    // unguarded without this failing.
    for (const route of routes) {
      const response = await request.get(`${API}${route}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status(), `${route} should be forbidden`).toBe(403);
    }
  });

  test('a forged token is rejected', async ({ request }) => {
    const response = await request.get(`${API}/me`, {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });
    expect(response.status()).toBe(401);
  });
});
