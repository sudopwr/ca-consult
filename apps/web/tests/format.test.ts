import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  appointmentStatusLabel,
  formatMoney,
  formatRelative,
  itrStatusLabel,
  statusColour,
} from '../src/shared/format';

describe('formatMoney', () => {
  it('renders whole rupees without trailing zeros', () => {
    expect(formatMoney(149900)).toMatch(/1,499$/);
  });

  it('shows paise when there are any', () => {
    expect(formatMoney(149950)).toMatch(/1,499\.50$/);
  });

  it('groups with Indian digit conventions', () => {
    // 1,49,900 rather than 149,900 — anything else looks wrong to the client.
    expect(formatMoney(14990000)).toMatch(/1,49,900$/);
  });

  it('handles free services', () => {
    expect(formatMoney(0)).toMatch(/0$/);
  });
});

describe('status presentation', () => {
  it('labels a cancellation by who did it', () => {
    expect(appointmentStatusLabel('CANCELLED_BY_USER')).toBe('Cancelled by you');
    expect(appointmentStatusLabel('CANCELLED_BY_ADMIN')).toBe('Cancelled by the CA');
  });

  it('phrases INFO_REQUESTED in terms of what the client must do', () => {
    expect(itrStatusLabel('INFO_REQUESTED')).toBe('Waiting on you');
  });

  it('colours anything needing attention as a warning', () => {
    expect(statusColour('INFO_REQUESTED')).toBe('warning');
  });

  it('colours every cancellation and no-show as an error', () => {
    for (const status of ['CANCELLED_BY_USER', 'CANCELLED_BY_ADMIN', 'NO_SHOW']) {
      expect(statusColour(status)).toBe('error');
    }
  });

  it('colours completion and filing as success', () => {
    expect(statusColour('COMPLETED')).toBe('success');
    expect(statusColour('FILED')).toBe('success');
  });
});

describe('date helpers', () => {
  it('crosses a month boundary', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses a leap day', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('goes backwards', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-09-16T09:00:00Z');

  it('describes the future', () => {
    expect(formatRelative('2026-09-19T09:00:00Z', now)).toMatch(/3 days/);
  });

  it('describes the past', () => {
    expect(formatRelative('2026-09-16T07:00:00Z', now)).toMatch(/2 hours ago/);
  });

  it('collapses anything under a minute', () => {
    expect(formatRelative('2026-09-16T09:00:30Z', now)).toBe('just now');
  });
});
