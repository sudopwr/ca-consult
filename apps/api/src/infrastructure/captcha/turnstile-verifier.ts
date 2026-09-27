import type { CaptchaVerifier } from '../../application/ports/captcha-verifier.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Cloudflare Turnstile. Free, usually invisible to the visitor, and no
 * puzzle-solving — which matters on a contact form that is often the first
 * thing a prospective client touches.
 */
export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly timeoutMs = 5_000,
  ) {}

  async verify(token: string, remoteIp?: string | null): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(SITEVERIFY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) return false;

      const result = (await response.json()) as TurnstileResponse;
      return result.success === true;
    } catch {
      // Cloudflare being unreachable must not take the contact form down. The
      // honeypot, dwell time and IP rate limit are still in force, so failing
      // open here trades a little spam for not losing genuine enquiries.
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Used when TURNSTILE_SECRET_KEY is unset — local development, and any
 * deployment that has not set up Cloudflare yet. Logged loudly at boot so it
 * cannot be mistaken for the real thing in production.
 */
export class DisabledCaptchaVerifier implements CaptchaVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}
