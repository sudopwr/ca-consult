/**
 * A half-open interval of absolute time: [start, end).
 *
 * Half-open is the whole reason back-to-back slots work. An 11:00-11:30
 * appointment and an 11:30-12:00 appointment do not overlap, because 11:30
 * belongs to the second one only. The database expresses the same thing with
 * `tstzrange(starts_at, ends_at, '[)')`, so the in-memory rule and the storage
 * rule agree by construction rather than by coincidence.
 */
export interface TimeRange {
  readonly start: Date;
  readonly end: Date;
}

export function makeRange(start: Date, end: Date): TimeRange {
  if (end.getTime() <= start.getTime()) {
    throw new Error(`A time range must end after it starts: ${start.toISOString()}..${end.toISOString()}`);
  }
  return { start, end };
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export function overlapsAny(range: TimeRange, others: readonly TimeRange[]): boolean {
  return others.some((other) => overlaps(range, other));
}

export function contains(outer: TimeRange, inner: TimeRange): boolean {
  return outer.start.getTime() <= inner.start.getTime() && inner.end.getTime() <= outer.end.getTime();
}

export function durationMinutes(range: TimeRange): number {
  return (range.end.getTime() - range.start.getTime()) / 60_000;
}

/**
 * Subtract a set of intervals from one interval, returning what remains.
 * Used to carve BLOCKED exceptions out of an availability window.
 */
export function subtract(base: TimeRange, cuts: readonly TimeRange[]): TimeRange[] {
  let remaining: TimeRange[] = [base];

  for (const cut of cuts) {
    const next: TimeRange[] = [];

    for (const piece of remaining) {
      if (!overlaps(piece, cut)) {
        next.push(piece);
        continue;
      }
      // Left fragment, if the cut starts after the piece does.
      if (piece.start.getTime() < cut.start.getTime()) {
        next.push({ start: piece.start, end: cut.start });
      }
      // Right fragment, if the cut ends before the piece does.
      if (cut.end.getTime() < piece.end.getTime()) {
        next.push({ start: cut.end, end: piece.end });
      }
      // Otherwise the cut swallows the piece and nothing is pushed.
    }

    remaining = next;
  }

  return remaining;
}

/** Merge overlapping or touching ranges into the smallest equivalent set. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeRange[] = [];
  let current = { start: sorted[0]!.start, end: sorted[0]!.end };

  for (const range of sorted.slice(1)) {
    if (range.start.getTime() <= current.end.getTime()) {
      // Touching counts as mergeable: 10:00-11:00 and 11:00-12:00 become
      // 10:00-12:00, which is what you want for two adjacent opening hours.
      if (range.end.getTime() > current.end.getTime()) current = { ...current, end: range.end };
    } else {
      merged.push(current);
      current = { start: range.start, end: range.end };
    }
  }

  merged.push(current);
  return merged;
}
