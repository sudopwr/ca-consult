/**
 * PAN handling.
 *
 * A PAN is a government identifier. It is not collected on the public
 * registration form — the admin records it through INFO_REQUESTED when the
 * filing actually needs it — and every non-admin serialisation masks it.
 *
 * The fourth character encodes the holder type, which is worth validating: a
 * 'C' (company) PAN on an ITR-1 (salaried) engagement is a mistake worth
 * catching before the return is prepared.
 */

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type PanHolderType =
  | 'INDIVIDUAL'
  | 'HUF'
  | 'COMPANY'
  | 'FIRM'
  | 'AOP'
  | 'BOI'
  | 'GOVERNMENT'
  | 'LOCAL_AUTHORITY'
  | 'ARTIFICIAL_JURIDICAL'
  | 'TRUST'
  | 'UNKNOWN';

const HOLDER_BY_CODE: Record<string, PanHolderType> = {
  P: 'INDIVIDUAL',
  H: 'HUF',
  C: 'COMPANY',
  F: 'FIRM',
  A: 'AOP',
  B: 'BOI',
  G: 'GOVERNMENT',
  L: 'LOCAL_AUTHORITY',
  J: 'ARTIFICIAL_JURIDICAL',
  T: 'TRUST',
};

export function isValidPan(value: string): boolean {
  return PAN.test(value.trim().toUpperCase());
}

export function normalisePan(value: string): string | null {
  const candidate = value.trim().toUpperCase().replace(/\s/g, '');
  return PAN.test(candidate) ? candidate : null;
}

export function panHolderType(pan: string): PanHolderType {
  const normalised = normalisePan(pan);
  if (!normalised) return 'UNKNOWN';
  return HOLDER_BY_CODE[normalised.charAt(3)!] ?? 'UNKNOWN';
}

/**
 * ABCDE1234F → ABCDE****F.
 *
 * Applied everywhere except the admin's engagement detail view. Never write an
 * unmasked PAN to a log line, an error payload, an audit diff or an email.
 */
export function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  const normalised = pan.trim().toUpperCase();
  if (normalised.length !== 10) return '**********';
  return `${normalised.slice(0, 5)}****${normalised.slice(9)}`;
}
