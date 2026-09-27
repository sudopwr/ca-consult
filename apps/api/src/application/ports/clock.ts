/**
 * Time is a dependency, not an ambient global.
 *
 * Nothing in `domain/` or `application/` may call `new Date()` or `Date.now()`.
 * That single rule is what makes the slot generator, the 12-hour cancellation
 * window and the 24-hour reminder testable without waiting for real time to
 * pass.
 */
export interface Clock {
  now(): Date;
}
