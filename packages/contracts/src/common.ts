import { z } from 'zod';

export const uuidSchema = z.uuid();

/** Indian mobile numbers in E.164. The DB enforces the same pattern. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'Enter a phone number in international format, e.g. +919876543210');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'A PAN looks like ABCDE1234F');

export const assessmentYearSchema = z
  .string()
  .regex(/^AY [0-9]{4}-[0-9]{2}$/, 'An assessment year looks like AY 2026-27');

export const itrFormTypeSchema = z.enum(['ITR-1', 'ITR-2', 'ITR-3', 'ITR-4', 'ITR-5', 'ITR-6', 'ITR-7']);

/** Integer paise. 149900 is Rs 1,499.00. */
export const moneyPaiseSchema = z.number().int().nonnegative();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function pagedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A calendar date with no timezone, e.g. '2026-09-20'. */
export const localDateSchema = z.iso.date();

/** An absolute instant with an offset, e.g. '2026-09-20T11:00:00+05:30'. */
export const instantSchema = z.iso.datetime({ offset: true });
