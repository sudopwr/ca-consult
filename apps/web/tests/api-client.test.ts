import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError, request } from '../src/shared/api/client';

vi.mock('../src/shared/auth/supabase', () => ({
  getAccessToken: async () => 'test-token',
}));

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('the API client', () => {
  beforeEach(() => vi.unstubAllGlobals?.());

  it('attaches the access token to authenticated calls', async () => {
    const fetchMock = mockFetch(200, { ok: true });
    await request('/me');

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('omits the token on public calls', async () => {
    const fetchMock = mockFetch(200, []);
    await request('/public/services', { anonymous: true });

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends the idempotency key when one is given', async () => {
    const fetchMock = mockFetch(201, {});
    await request('/appointments', { method: 'POST', body: {}, idempotencyKey: 'key-1' });

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-1');
  });

  it('turns a problem+json body into an ApiError carrying the code', async () => {
    mockFetch(409, {
      type: 'https://errors.ca-consult.app/slot-unavailable',
      title: 'That slot is no longer available',
      status: 409,
      code: 'SLOT_UNAVAILABLE',
      detail: 'Someone else booked that time a moment ago.',
    });

    // Components branch on `code`, never on a message string.
    await expect(request('/appointments', { method: 'POST' })).rejects.toThrow(ApiError);

    try {
      await request('/appointments', { method: 'POST' });
    } catch (error) {
      expect((error as ApiError).code).toBe('SLOT_UNAVAILABLE');
      expect((error as ApiError).detail).toMatch(/a moment ago/);
    }
  });

  it('exposes field errors keyed by path', async () => {
    mockFetch(400, {
      type: 'about:blank',
      title: 'The request could not be validated',
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [
        { path: 'address.pincode', message: 'Enter a valid 6-digit PIN code' },
        { path: 'phone', message: 'Enter a phone number in international format' },
      ],
    });

    try {
      await request('/me/profile', { method: 'PUT', body: {} });
    } catch (error) {
      const fields = (error as ApiError).fieldErrors;
      expect(fields['address.pincode']).toMatch(/6-digit/);
      expect(fields.phone).toMatch(/international/);
    }
  });

  it('survives a response that is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    );

    // A proxy returning an HTML error page must not crash the app.
    try {
      await request('/me');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).httpStatus).toBe(502);
    }
  });

  it('wraps a network failure in the same shape as everything else', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    try {
      await request('/me');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('NETWORK_ERROR');
    }
  });

  it('returns undefined for a 204 rather than trying to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));
    await expect(request('/admin/availability/rules/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
