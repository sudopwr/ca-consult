import { z } from 'zod';
import { phoneSchema, pincodeSchema, pagedSchema } from './common.js';

export const userRoleSchema = z.enum(['USER', 'ADMIN']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['ACTIVE', 'BLOCKED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const addressSchema = z.object({
  line1: z.string().trim().min(3, 'Enter your address').max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2, 'Enter your city').max(80),
  state: z.string().trim().min(2, 'Enter your state').max(80),
  pincode: pincodeSchema,
});
export type Address = z.infer<typeof addressSchema>;

/**
 * The onboarding form. Google gives us an email and a display name; everything
 * a practice actually needs to run an engagement — a reachable phone and a
 * postal address — has to be asked for.
 */
export const completeProfileRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: phoneSchema,
  address: addressSchema,
});
export type CompleteProfileRequest = z.infer<typeof completeProfileRequestSchema>;

export const userProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  address: addressSchema.nullable(),
  avatarUrl: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  noShowCount: z.number().int(),
  profileCompletedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** `GET /me` — one call that tells the shell everything it needs to route. */
export const meResponseSchema = z.object({
  profile: userProfileSchema,
  profileComplete: z.boolean(),
  isAdmin: z.boolean(),
  /** False until the user holds a non-cancelled engagement; gates the message box. */
  canMessage: z.boolean(),
  unreadMessages: z.number().int(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: userStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserSummarySchema = userProfileSchema.extend({
  appointmentCount: z.number().int(),
  engagementCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserListResponseSchema = pagedSchema(adminUserSummarySchema);

export const setUserStatusRequestSchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().max(500).optional(),
});
export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;
