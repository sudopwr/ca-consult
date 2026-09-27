import type { CaptchaVerifier } from '../../src/application/ports/captcha-verifier.js';

/**
 * Why the captcha sits behind a port at all: these two let the contact-form
 * tests run in microseconds instead of round-tripping to Cloudflare, and they
 * make "what happens when verification fails" a one-line test rather than an
 * exercise in network mocking.
 */
export class AlwaysPassCaptcha implements CaptchaVerifier {
  readonly tokens: string[] = [];

  async verify(token: string): Promise<boolean> {
    this.tokens.push(token);
    return true;
  }
}

export class AlwaysFailCaptcha implements CaptchaVerifier {
  async verify(): Promise<boolean> {
    return false;
  }
}

export class ThrowingCaptcha implements CaptchaVerifier {
  async verify(): Promise<boolean> {
    throw new Error('Turnstile unreachable');
  }
}
