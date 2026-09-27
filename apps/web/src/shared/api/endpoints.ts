import type {
  AdminAppointment,
  AdminCaProfile,
  AdminDashboard,
  AdminItrEngagement,
  AdminThreadDetail,
  AdminThreadSummary,
  AdminUserSummary,
  Appointment,
  AvailabilityResponse,
  ContactEnquiry,
  ItrEngagement,
  MeResponse,
  MyEngagementsResponse,
  Paged,
  PublicCaProfile,
  Service,
  ThreadDetail,
  ThreadSummary,
  UpsertCaProfileRequest,
  UpsertServiceRequest,
  UserProfile,
} from '@ca/contracts';
import { api } from './client';

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

/**
 * Every call the app makes, in one place.
 *
 * Keeping them here rather than inline in components means a route rename is
 * one edit, and the return types come from @ca/contracts — the same
 * definitions the API validates against.
 */
export const endpoints = {
  // ── public ────────────────────────────────────────────────────────────────
  publicCaProfile: () => api.get<PublicCaProfile>('/public/ca-profile', { anonymous: true }),

  publicServices: (kind?: 'CONSULTANCY' | 'ITR_FILING') =>
    api.get<Service[]>(`/public/services${qs({ kind })}`, { anonymous: true }),

  availability: (serviceId: string, from: string, to: string) =>
    api.get<AvailabilityResponse>(`/public/availability${qs({ serviceId, from, to })}`, {
      anonymous: true,
    }),

  submitEnquiry: (body: unknown) =>
    api.post<{ accepted: true }>('/public/contact-enquiries', body, { anonymous: true }),

  // ── me ────────────────────────────────────────────────────────────────────
  me: () => api.get<MeResponse>('/me'),

  updateProfile: (body: unknown) =>
    api.put<{ profile: UserProfile; profileComplete: boolean }>('/me/profile', body),

  myEngagements: (scope: 'upcoming' | 'past' | 'all' = 'all') =>
    api.get<MyEngagementsResponse>(`/me/engagements${qs({ scope })}`),

  // ── booking ───────────────────────────────────────────────────────────────
  bookAppointment: (body: unknown, idempotencyKey: string) =>
    api.post<Appointment>('/appointments', body, { idempotencyKey }),

  appointment: (id: string) => api.get<Appointment>(`/appointments/${id}`),

  cancelAppointment: (id: string, reason: string) =>
    api.post<Appointment>(`/appointments/${id}/cancel`, { reason }),

  rescheduleAppointment: (id: string, startsAt: string) =>
    api.post<Appointment>(`/appointments/${id}/reschedule`, { startsAt, notifyUser: true }),

  // ── ITR ───────────────────────────────────────────────────────────────────
  registerItr: (body: unknown, idempotencyKey: string) =>
    api.post<ItrEngagement>('/itr-engagements', body, { idempotencyKey }),

  itrEngagement: (id: string) => api.get<ItrEngagement>(`/itr-engagements/${id}`),

  cancelItr: (id: string, reason: string) =>
    api.post<ItrEngagement>(`/itr-engagements/${id}/cancel`, { reason }),

  // ── messaging ─────────────────────────────────────────────────────────────
  myThreads: () => api.get<ThreadSummary[]>('/me/threads'),
  thread: (id: string) => api.get<ThreadDetail>(`/me/threads/${id}`),
  startThread: (body: unknown) => api.post<{ id: string }>('/me/threads', body),
  postMessage: (threadId: string, body: string) =>
    api.post(`/me/threads/${threadId}/messages`, { body }),

  // ── admin ─────────────────────────────────────────────────────────────────
  admin: {
    dashboard: () => api.get<AdminDashboard>('/admin/dashboard'),

    caProfile: () => api.get<AdminCaProfile | null>('/admin/ca-profile'),
    saveCaProfile: (body: UpsertCaProfileRequest) =>
      api.put<AdminCaProfile>('/admin/ca-profile', body),

    services: (kind?: string) => api.get<Service[]>(`/admin/services${qs({ kind })}`),
    createService: (body: UpsertServiceRequest) => api.post<Service>('/admin/services', body),
    updateService: (id: string, body: UpsertServiceRequest) =>
      api.put<Service>(`/admin/services/${id}`, body),
    deleteService: (id: string) =>
      api.delete<{ deactivated: boolean }>(`/admin/services/${id}`),

    rules: () => api.get<import('@ca/contracts').AvailabilityRule[]>('/admin/availability/rules'),
    createRule: (body: unknown) => api.post('/admin/availability/rules', body),
    updateRule: (id: string, body: unknown) => api.put(`/admin/availability/rules/${id}`, body),
    deleteRule: (id: string) => api.delete(`/admin/availability/rules/${id}`),

    exceptions: () =>
      api.get<import('@ca/contracts').ScheduleException[]>('/admin/availability/exceptions'),
    createException: (body: unknown) =>
      api.post<import('@ca/contracts').ScheduleException & {
        conflicts: Array<{ reference: string; startsAt: string; userName: string | null }>;
      }>('/admin/availability/exceptions', body),
    deleteException: (id: string) => api.delete(`/admin/availability/exceptions/${id}`),

    users: (params: Record<string, unknown>) =>
      api.get<Paged<AdminUserSummary>>(`/admin/users${qs(params)}`),
    user: (id: string) => api.get<{ profile: UserProfile; appointments: unknown[]; engagements: unknown[] }>(`/admin/users/${id}`),
    setUserStatus: (id: string, status: 'ACTIVE' | 'BLOCKED', reason?: string) =>
      api.patch(`/admin/users/${id}/status`, { status, reason }),
    resetNoShows: (id: string) => api.post(`/admin/users/${id}/reset-no-shows`),

    appointments: (params: Record<string, unknown>) =>
      api.get<Paged<AdminAppointment>>(`/admin/appointments${qs(params)}`),
    appointment: (id: string) => api.get<AdminAppointment>(`/admin/appointments/${id}`),
    updateAppointment: (id: string, body: unknown) =>
      api.patch<AdminAppointment>(`/admin/appointments/${id}`, body),
    rescheduleAppointment: (id: string, startsAt: string, notifyUser: boolean) =>
      api.post<AdminAppointment>(`/admin/appointments/${id}/reschedule`, { startsAt, notifyUser }),

    itrEngagements: (params: Record<string, unknown>) =>
      api.get<Paged<AdminItrEngagement>>(`/admin/itr-engagements${qs(params)}`),
    itrEngagement: (id: string) => api.get<AdminItrEngagement>(`/admin/itr-engagements/${id}`),
    updateItrEngagement: (id: string, body: unknown) =>
      api.patch<AdminItrEngagement>(`/admin/itr-engagements/${id}`, body),

    threads: (params: Record<string, unknown>) =>
      api.get<Paged<AdminThreadSummary>>(`/admin/threads${qs(params)}`),
    thread: (id: string) => api.get<AdminThreadDetail>(`/admin/threads/${id}`),
    replyToThread: (id: string, body: string) => api.post(`/admin/threads/${id}/messages`, { body }),
    closeThread: (id: string) => api.patch(`/admin/threads/${id}`, { status: 'CLOSED' }),

    enquiries: (params: Record<string, unknown>) =>
      api.get<Paged<ContactEnquiry>>(`/admin/contact-enquiries${qs(params)}`),
    updateEnquiry: (id: string, body: unknown) =>
      api.patch<ContactEnquiry>(`/admin/contact-enquiries/${id}`, body),
  },
};

/** Query keys, colocated so an invalidation cannot drift from its fetch. */
export const keys = {
  me: ['me'] as const,
  publicProfile: ['public', 'ca-profile'] as const,
  publicServices: (kind?: string) => ['public', 'services', kind ?? 'all'] as const,
  availability: (serviceId: string, from: string, to: string) =>
    ['public', 'availability', serviceId, from, to] as const,
  myEngagements: (scope: string) => ['me', 'engagements', scope] as const,
  myThreads: ['me', 'threads'] as const,
  thread: (id: string) => ['me', 'threads', id] as const,
  admin: {
    dashboard: ['admin', 'dashboard'] as const,
    caProfile: ['admin', 'ca-profile'] as const,
    services: ['admin', 'services'] as const,
    rules: ['admin', 'rules'] as const,
    exceptions: ['admin', 'exceptions'] as const,
    users: (params: unknown) => ['admin', 'users', params] as const,
    user: (id: string) => ['admin', 'users', id] as const,
    appointments: (params: unknown) => ['admin', 'appointments', params] as const,
    appointment: (id: string) => ['admin', 'appointments', id] as const,
    itr: (params: unknown) => ['admin', 'itr', params] as const,
    itrOne: (id: string) => ['admin', 'itr', id] as const,
    threads: (params: unknown) => ['admin', 'threads', params] as const,
    thread: (id: string) => ['admin', 'threads', id] as const,
    enquiries: (params: unknown) => ['admin', 'enquiries', params] as const,
  },
};
