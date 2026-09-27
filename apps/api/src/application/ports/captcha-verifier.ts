/**
 * Behind a port so tests never touch the network. `AlwaysPassCaptcha` and
 * `AlwaysFailCaptcha` in tests/fakes are what let the contact-form tests run in
 * microseconds instead of round-tripping to Cloudflare.
 */
export interface CaptchaVerifier {
  verify(token: string, remoteIp?: string | null): Promise<boolean>;
}
