import { test, expect } from '@playwright/test';
import { SEEDED, mintAccessToken, signInAs } from '../fixtures/auth';

const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';

test.describe('the admin panel', () => {
  test('opens on what needs doing today', async ({ page }) => {
    await signInAs(page, 'admin', '/admin');

    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByText('Filing pipeline')).toBeVisible();
  });

  test('refuses to publish the landing page without a meeting room', async ({ request }) => {
    const token = await mintAccessToken(SEEDED.admin);

    const response = await request.put(`${API}/admin/ca-profile`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        fullName: 'S. Mehta',
        qualifications: [],
        specialisations: [],
        languages: [],
        timezone: 'Asia/Kolkata',
        defaultMeetingUrl: null,
        isPublished: true,
      },
    });

    // Bookings confirm instantly, so the confirmation email needs a link.
    expect(response.status()).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/meeting room/i);
  });

  test('walks an ITR engagement through to filed', async ({ request }) => {
    const clientToken = await mintAccessToken(SEEDED.client);
    const adminToken = await mintAccessToken(SEEDED.admin);
    const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

    const services = await (await request.get(`${API}/public/services?kind=ITR_FILING`)).json();
    const service = services.at(-1); // least likely to clash with other specs

    const created = await request.post(`${API}/itr-engagements`, {
      headers: authed(clientToken),
      data: { serviceId: service.id, hasBusinessIncome: false, notes: 'e2e' },
    });

    // Another spec may already hold this assessment year for this client.
    if (created.status() === 409) {
      expect((await created.json()).code).toBe('DUPLICATE_ENGAGEMENT');
      return;
    }

    expect(created.status()).toBe(201);
    const engagement = await created.json();
    expect(engagement.status).toBe('SUBMITTED');
    // A PAN is never collected on the public form.
    expect(engagement.panNumber).toBeNull();

    const step = (body: Record<string, unknown>) =>
      request.patch(`${API}/admin/itr-engagements/${engagement.id}`, {
        headers: authed(adminToken),
        data: body,
      });

    expect((await step({ status: 'IN_REVIEW' })).status()).toBe(200);

    // The CA asks for what they need, and the client is told.
    const requested = await step({
      status: 'INFO_REQUESTED',
      infoRequested: 'Please send your Form 16 and PAN.',
    });
    expect(requested.status()).toBe(200);

    // Recording the PAN is admin-only, and this is the only route that can.
    expect((await step({ panNumber: 'ABCDE1234F' })).status()).toBe(200);

    expect((await step({ status: 'IN_PROGRESS' })).status()).toBe(200);

    // Filing without an acknowledgement number is refused.
    expect((await step({ status: 'FILED' })).status()).toBe(400);

    const filed = await step({ status: 'FILED', acknowledgementNumber: '123456789012345' });
    expect(filed.status()).toBe(200);
    expect((await filed.json()).acknowledgementNumber).toBe('123456789012345');
  });

  test('the client sees the PAN masked, the admin sees it in full', async ({ request }) => {
    const clientToken = await mintAccessToken(SEEDED.client);
    const adminToken = await mintAccessToken(SEEDED.admin);

    const mine = await (
      await request.get(`${API}/me/engagements`, {
        headers: { Authorization: `Bearer ${clientToken}` },
      })
    ).json();

    const withPan = mine.items.find(
      (item: { kind: string; engagement?: { panNumber: string | null } }) =>
        item.kind === 'ITR' && item.engagement?.panNumber,
    );

    if (withPan) {
      expect(withPan.engagement.panNumber).toMatch(/^[A-Z]{5}\*{4}[A-Z]$/);

      const adminView = await (
        await request.get(`${API}/admin/itr-engagements/${withPan.engagement.id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
      ).json();

      expect(adminView.panNumber).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
    }
  });

  test('blocking a day removes its slots from the public availability', async ({ request }) => {
    const adminToken = await mintAccessToken(SEEDED.admin);
    const authed = { Authorization: `Bearer ${adminToken}` };

    // A Monday three weeks out, well clear of other specs.
    const target = new Date(Date.now() + 21 * 86_400_000);
    while (target.getUTCDay() !== 1) target.setUTCDate(target.getUTCDate() + 1);
    const date = target.toISOString().slice(0, 10);

    const services = await (await request.get(`${API}/public/services?kind=CONSULTANCY`)).json();
    const serviceId = services[0].id;

    const before = await (
      await request.get(`${API}/public/availability?serviceId=${serviceId}&from=${date}&to=${date}`)
    ).json();
    expect(before.days[0].slots.length).toBeGreaterThan(0);

    const created = await request.post(`${API}/admin/availability/exceptions`, {
      headers: authed,
      data: { kind: 'BLOCKED', onDate: date, reason: 'e2e block' },
    });
    expect(created.status()).toBe(201);

    const after = await (
      await request.get(`${API}/public/availability?serviceId=${serviceId}&from=${date}&to=${date}`)
    ).json();
    expect(after.days[0].slots).toHaveLength(0);

    // Put it back so re-runs start clean.
    const exceptionId = (await created.json()).exception.id;
    await request.delete(`${API}/admin/availability/exceptions/${exceptionId}`, { headers: authed });
  });

  test('a suspended client cannot book', async ({ request }) => {
    const adminToken = await mintAccessToken(SEEDED.admin);
    const clientToken = await mintAccessToken(SEEDED.client);
    const authed = { Authorization: `Bearer ${adminToken}` };

    await request.patch(`${API}/admin/users/${SEEDED.client.id}/status`, {
      headers: authed,
      data: { status: 'BLOCKED' },
    });

    const response = await request.get(`${API}/me`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe('ACCOUNT_BLOCKED');

    await request.patch(`${API}/admin/users/${SEEDED.client.id}/status`, {
      headers: authed,
      data: { status: 'ACTIVE' },
    });
  });

  test('an admin account cannot be suspended', async ({ request }) => {
    const adminToken = await mintAccessToken(SEEDED.admin);

    // Otherwise the panel could be locked out with one misclick.
    const response = await request.patch(`${API}/admin/users/${SEEDED.admin.id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'BLOCKED' },
    });

    expect(response.status()).toBe(400);
  });
});
