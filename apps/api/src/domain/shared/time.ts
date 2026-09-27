/**
 * Timezone-aware date arithmetic, with no library.
 *
 * The practice publishes availability in local wall-clock terms — "Tuesdays,
 * 10:00 to 13:00" — but appointments are stored as absolute instants. Getting
 * between those two is the single fiddliest thing in the whole system, so it
 * lives here, in the domain, as pure functions with no I/O and no ambient
 * clock. Everything here is exhaustively unit-tested.
 *
 * We use `Intl.DateTimeFormat` with a `timeZone`, which ships with Node and
 * knows the full IANA database including historical DST rules. India has no
 * DST, but writing this correctly costs nothing and means the code survives
 * the day the practice takes a client in another country.
 */

/** A calendar date with no time and no zone: 'YYYY-MM-DD'. */
export type LocalDate = string;

/** A wall-clock time with no date and no zone: 'HH:MM'. */
export type LocalTime = string;

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface TimeParts {
  hour: number; // 0-23
  minute: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function parseLocalDate(date: LocalDate): DateParts {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid local date: ${date}`);
  const [, y, mo, d] = m;
  return { year: Number(y), month: Number(mo), day: Number(d) };
}

export function parseLocalTime(time: LocalTime): TimeParts {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid local time: ${time}`);
  const [, h, mi] = m;
  const hour = Number(h);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) throw new Error(`Invalid local time: ${time}`);
  return { hour, minute };
}

export function formatLocalDate(parts: DateParts): LocalDate {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(parts.year, 4)}-${p(parts.month)}-${p(parts.day)}`;
}

export function minutesSinceMidnight(time: LocalTime): number {
  const { hour, minute } = parseLocalTime(time);
  return hour * 60 + minute;
}

export function minutesToLocalTime(minutes: number): LocalTime {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * How far ahead of UTC the given zone is at the given instant, in milliseconds.
 * Positive east of Greenwich: +19800000 (5h30m) for Asia/Kolkata.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    // Some implementations render midnight as hour 24 under hour12:false.
    (values.hour ?? 0) % 24,
    values.minute ?? 0,
    values.second ?? 0,
  );

  return asIfUtc - instant.getTime();
}

/**
 * Turn a wall-clock date and time in a zone into the absolute instant.
 *
 * Two passes: guess the offset at the naive instant, correct, then re-check.
 * The second pass is what makes DST transitions come out right — near a spring
 * forward the offset at the guess differs from the offset at the answer.
 */
export function zonedToInstant(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseLocalTime(time);

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstOffset = timeZoneOffsetMs(new Date(naive), timeZone);
  let instant = naive - firstOffset;

  const secondOffset = timeZoneOffsetMs(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) {
    instant = naive - secondOffset;
  }

  return new Date(instant);
}

/** The wall-clock calendar date at an instant, in a zone. */
export function instantToLocalDate(instant: Date, timeZone: string): LocalDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA formats as YYYY-MM-DD, which is what we want.
  return formatter.format(instant);
}

/** The wall-clock time at an instant, in a zone. */
export function instantToLocalTime(instant: Date, timeZone: string): LocalTime {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(instant).replace(/^24:/, '00:');
}

/**
 * Day of week for a calendar date, 0 = Sunday.
 * The calendar date alone determines this — no zone needed.
 */
export function dayOfWeek(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Inclusive at both ends. Returns [] if `to` is before `from`. */
export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const dates: LocalDate[] = [];
  for (let i = 0; i <= span; i += 1) dates.push(addDays(from, i));
  return dates;
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
