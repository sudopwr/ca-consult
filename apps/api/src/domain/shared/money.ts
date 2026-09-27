/**
 * Money is integer paise. Never a float — 0.1 + 0.2 is not 0.3, and a tax
 * practice noticing a one-paisa drift in an invoice is a bad afternoon.
 */
export type Paise = number;

export function isValidPaise(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);
}

/** Display formatting, Indian digit grouping: 149900 → "₹1,499.00". */
export function formatPaise(paise: Paise, currency = 'INR'): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(rupees);
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}
