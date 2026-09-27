import type { Appointment } from '../../domain/appointment/appointment.js';
import { visibleMeetingUrl } from '../../domain/appointment/appointment.js';
import type { ItrEngagement } from '../../domain/itr/itr-engagement.js';
import { maskPan } from '../../domain/user/pan-number.js';
import type { UserProfile } from '../../domain/user/user-profile.js';
import type { CaProfile } from '../../domain/ca-profile/ca-profile.js';
import type { Service } from '../../domain/service/service.js';
import type { AppointmentWithUser } from '../../application/ports/appointment-repository.js';
import type { ItrEngagementWithUser } from '../../application/ports/itr-engagement-repository.js';

/**
 * The boundary where domain objects become JSON.
 *
 * Two things live here on purpose. First, `adminNotes` is stripped from every
 * client-facing shape — the CA's private notes about a client must not be one
 * forgotten spread operator away from the client's own browser. Second, PANs
 * are masked everywhere except the admin's engagement view.
 */

export function toPublicUser(user: UserProfile) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    address: user.address,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    noShowCount: user.noShowCount,
    profileCompletedAt: user.profileCompletedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** For the client who owns it. No admin notes, and no stale meeting link. */
export function toClientAppointment(appointment: Appointment, now: Date) {
  return {
    id: appointment.id,
    reference: appointment.reference,
    serviceId: appointment.serviceId,
    serviceName: appointment.serviceName,
    amountPaise: appointment.amountPaise,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    meetingUrl: visibleMeetingUrl(appointment, now),
    userNotes: appointment.userNotes,
    cancellationReason: appointment.cancellationReason,
    supersededBy: appointment.supersededBy,
    createdAt: appointment.createdAt.toISOString(),
  };
}

export function toAdminAppointment(appointment: AppointmentWithUser, now: Date) {
  return {
    ...toClientAppointment(appointment, now),
    // The admin always sees the link, including after the appointment, so they
    // can check which room a client was sent to.
    meetingUrl: appointment.meetingUrl,
    userId: appointment.userId,
    userName: appointment.userName,
    userEmail: appointment.userEmail,
    userPhone: appointment.userPhone,
    adminNotes: appointment.adminNotes,
  };
}

export function toClientEngagement(engagement: ItrEngagement) {
  return {
    id: engagement.id,
    reference: engagement.reference,
    serviceId: engagement.serviceId,
    serviceName: engagement.serviceName,
    amountPaise: engagement.amountPaise,
    status: engagement.status,
    assessmentYear: engagement.assessmentYear,
    itrFormType: engagement.itrFormType,
    hasBusinessIncome: engagement.hasBusinessIncome,
    // Masked even for the owner: there is no reason to echo a full PAN back
    // into a browser, and plenty of reasons not to.
    panNumber: maskPan(engagement.panNumber),
    userNotes: engagement.userNotes,
    infoRequested: engagement.infoRequested,
    acknowledgementNumber: engagement.acknowledgementNumber,
    filedAt: engagement.filedAt?.toISOString() ?? null,
    cancellationReason: engagement.cancellationReason,
    createdAt: engagement.createdAt.toISOString(),
    updatedAt: engagement.updatedAt.toISOString(),
  };
}

export function toAdminEngagement(engagement: ItrEngagementWithUser) {
  return {
    ...toClientEngagement(engagement),
    // The one place an unmasked PAN is served, because the CA needs it to file.
    panNumber: engagement.panNumber,
    userId: engagement.userId,
    userName: engagement.userName,
    userEmail: engagement.userEmail,
    userPhone: engagement.userPhone,
    adminNotes: engagement.adminNotes,
  };
}

/** The landing page. `defaultMeetingUrl` is deliberately absent. */
export function toPublicCaProfile(profile: CaProfile) {
  return {
    fullName: profile.fullName,
    headline: profile.headline,
    membershipNumber: profile.membershipNumber,
    firmName: profile.firmName,
    bio: profile.bio,
    photoUrl: profile.photoUrl,
    yearsExperience: profile.yearsExperience,
    qualifications: profile.qualifications,
    specialisations: profile.specialisations,
    languages: profile.languages,
    officeAddress: profile.officeAddress,
    googleMapsUrl: profile.googleMapsUrl,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    whatsappNumber: profile.whatsappNumber,
    linkedinUrl: profile.linkedinUrl,
    timezone: profile.timezone,
  };
}

export function toAdminCaProfile(profile: CaProfile) {
  return {
    ...toPublicCaProfile(profile),
    defaultMeetingUrl: profile.defaultMeetingUrl,
    isPublished: profile.isPublished,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toServiceJson(service: Service) {
  return {
    id: service.id,
    kind: service.kind,
    name: service.name,
    slug: service.slug,
    description: service.description,
    amountPaise: service.amountPaise,
    currency: service.currency,
    durationMinutes: service.durationMinutes,
    assessmentYear: service.assessmentYear,
    itrFormType: service.itrFormType,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
  };
}
