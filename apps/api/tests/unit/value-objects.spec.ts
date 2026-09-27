import { describe, expect, it } from 'vitest';
import {
  formatIndianPhone,
  isE164,
  normaliseIndianPhone,
} from '../../src/domain/user/phone-number.js';
import {
  isValidPan,
  maskPan,
  normalisePan,
  panHolderType,
} from '../../src/domain/user/pan-number.js';
import { formatPaise, isValidPaise, paiseToRupees, rupeesToPaise } from '../../src/domain/shared/money.js';

describe('normaliseIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['00919876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseIndianPhone(input)).toBe(expected);
  });

  it('rejects a landline-style 10-digit number starting below 6', () => {
    // Indian mobiles start 6-9. A number that cannot receive an SMS is worse
    // than a rejected form on a tax engagement.
    expect(normaliseIndianPhone('2266000000')).toBeNull();
  });

  it.each([['123'], ['abcdefghij'], [''], ['   ']])('rejects %s', (input) => {
    expect(normaliseIndianPhone(input)).toBeNull();
  });

  it('keeps a valid foreign number in E.164', () => {
    expect(normaliseIndianPhone('+442071838750')).toBe('+442071838750');
  });

  it('formats for display without changing the stored value', () => {
    expect(formatIndianPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatIndianPhone('+442071838750')).toBe('+442071838750');
  });

  it('agrees with isE164 on its own output', () => {
    expect(isE164(normaliseIndianPhone('9876543210')!)).toBe(true);
  });
});

describe('PAN', () => {
  it('accepts a well-formed PAN', () => {
    expect(isValidPan('ABCDE1234F')).toBe(true);
    expect(normalisePan(' abcde1234f ')).toBe('ABCDE1234F');
  });

  it.each([['ABCDE1234'], ['ABCD1234F'], ['ABCDE12345'], ['ABCDEF234F'], ['']])(
    'rejects %s',
    (input) => {
      expect(isValidPan(input)).toBe(false);
      expect(normalisePan(input)).toBeNull();
    },
  );

  it('reads the holder type from the fourth character', () => {
    // A company PAN on an ITR-1 engagement is a mistake worth catching before
    // the return is prepared.
    expect(panHolderType('ABCPE1234F')).toBe('INDIVIDUAL');
    expect(panHolderType('ABCCE1234F')).toBe('COMPANY');
    expect(panHolderType('ABCHE1234F')).toBe('HUF');
    expect(panHolderType('ABCXE1234F')).toBe('UNKNOWN');
  });

  it('masks all but the first five and last character', () => {
    expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
  });

  it('masks a malformed value completely rather than leaking it', () => {
    expect(maskPan('nonsense')).toBe('**********');
  });

  it('leaves null alone', () => {
    expect(maskPan(null)).toBeNull();
  });
});

describe('money', () => {
  it('treats integer paise as valid and everything else as not', () => {
    expect(isValidPaise(149900)).toBe(true);
    expect(isValidPaise(0)).toBe(true);
    expect(isValidPaise(1499.5)).toBe(false);
    expect(isValidPaise(-1)).toBe(false);
  });

  it('round-trips rupees and paise without float drift', () => {
    expect(rupeesToPaise(1499)).toBe(149900);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // would be 30.000000000000004 as a float
    expect(paiseToRupees(149900)).toBe(1499);
  });

  it('formats with Indian digit grouping', () => {
    // 1499 groups as 1,499 — but 149900 rupees groups as 1,49,900 in en-IN.
    expect(formatPaise(149900)).toMatch(/1,499\.00/);
    expect(formatPaise(14990000)).toMatch(/1,49,900\.00/);
  });
});
