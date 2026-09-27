const TIMEZONE = 'Asia/Kolkata';

/** 149900 → "₹1,499". Whole rupees unless there are paise to show. */
export function formatMoney(paise: number, currency = 'INR'): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function formatDateTime(iso: string, timezone = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timezone = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatDate(iso: string, timezone = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** "in 3 days", "2 hours ago" — for list rows where the exact time is noise. */
export function formatRelative(iso: string, now = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];

  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return formatter.format(Math.round(diffMs / ms), unit);
  }
  return 'just now';
}

/** Today's date in the practice timezone, as YYYY-MM-DD. */
export function todayLocal(timezone = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

const APPOINTMENT_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  RESCHEDULED: 'Moved',
  COMPLETED: 'Completed',
  CANCELLED_BY_USER: 'Cancelled by you',
  CANCELLED_BY_ADMIN: 'Cancelled by the CA',
  NO_SHOW: 'Missed',
};

const ITR_LABELS: Record<string, string> = {
  SUBMITTED: 'Registered',
  IN_REVIEW: 'Under review',
  INFO_REQUESTED: 'Waiting on you',
  IN_PROGRESS: 'Being prepared',
  FILED: 'Filed',
  COMPLETED: 'Complete',
  CANCELLED_BY_USER: 'Cancelled by you',
  CANCELLED_BY_ADMIN: 'Cancelled by the CA',
};

export function appointmentStatusLabel(status: string): string {
  return APPOINTMENT_LABELS[status] ?? status;
}

export function itrStatusLabel(status: string): string {
  return ITR_LABELS[status] ?? status;
}

export type ChipColour = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export function statusColour(status: string): ChipColour {
  if (status === 'CONFIRMED' || status === 'IN_PROGRESS') return 'primary';
  if (status === 'COMPLETED' || status === 'FILED') return 'success';
  if (status === 'INFO_REQUESTED') return 'warning';
  if (status.startsWith('CANCELLED') || status === 'NO_SHOW') return 'error';
  if (status === 'SUBMITTED' || status === 'IN_REVIEW') return 'info';
  return 'default';
}
