/**
 * Phone numbers are stored in E.164 so that an SMS provider can be handed one
 * without further thought when DLT registration clears.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

/**
 * Accept what Indian users actually type — "98765 43210", "098765-43210",
 * "+91 98765 43210" — and produce one canonical form.
 *
 * Returns null when the input cannot be understood, rather than guessing. A
 * wrong phone number on a tax engagement is worse than a rejected form.
 */
export function normaliseIndianPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;

  // Explicitly international: the caller told us the country code, so take it
  // at face value and only check the shape.
  if (trimmed.startsWith('+')) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }
  if (digits.startsWith('00')) {
    const candidate = `+${digits.slice(2)}`;
    return isE164(candidate) ? candidate : null;
  }

  // Everything else is read as domestic, so it has to look like an Indian
  // mobile — 10 digits starting 6-9, optionally with the trunk 0 or the 91
  // country code in front.
  //
  // We deliberately do NOT fall back to treating an unrecognised string as an
  // international number. '2266000000' is a Mumbai landline typed without a
  // country code; turning it into '+2266000000' would invent a number in some
  // other country and quietly fail every SMS sent to it.
  const national = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;

  if (national.length === 10 && /^[6-9]/.test(national)) return `+91${national}`;
  if (national.length === 12 && national.startsWith('91') && /^[6-9]/.test(national.slice(2))) {
    return `+${national}`;
  }

  return null;
}

/** For display in the admin list: +919876543210 → +91 98765 43210. */
export function formatIndianPhone(e164: string): string {
  if (e164.startsWith('+91') && e164.length === 13) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}
