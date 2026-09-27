import type { TemplateKey } from '../../application/ports/notification-outbox.js';
import { formatPaise } from '../../domain/shared/money.js';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Payload = Record<string, unknown>;

const str = (payload: Payload, key: string, fallback = ''): string => {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
};

const num = (payload: Payload, key: string): number | null => {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
};

function formatWhen(iso: string, timezone = 'Asia/Kolkata'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/**
 * Plain, readable emails. A tax practice sends few enough of these that the
 * right tone is a well-written letter, not a marketing template — so: one
 * column, no images, and a plain-text part that says everything the HTML does.
 */
function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }): RenderedEmail {
  const text = [heading, '', ...paragraphs, cta ? `\n${cta.label}: ${cta.url}` : ''].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f8fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b2a4a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid rgba(27,42,74,.08);border-radius:10px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
    ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${p}</p>`).join('')}
    ${
      cta
        ? `<p style="margin:24px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#1b2a4a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">${escapeHtml(cta.label)}</a></p>`
        : ''
    }
  </div>
</body></html>`;

  return { subject: heading, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmail(templateKey: TemplateKey, payload: Payload): RenderedEmail {
  const name = str(payload, 'clientName') || str(payload, 'name') || 'there';
  const reference = str(payload, 'reference');
  const service = str(payload, 'serviceName');
  const timezone = str(payload, 'timezone', 'Asia/Kolkata');
  const when = formatWhen(str(payload, 'startsAt'), timezone);
  const meetingUrl = str(payload, 'meetingUrl');

  switch (templateKey) {
    case 'appointment.confirmed': {
      const amount = num(payload, 'amountPaise');
      const email = layout(
        'Your consultation is confirmed',
        [
          `Hello ${escapeHtml(name)},`,
          `Your <strong>${escapeHtml(service)}</strong> is booked for <strong>${escapeHtml(when)}</strong>.`,
          amount !== null ? `Fee: ${escapeHtml(formatPaise(amount))}, payable at the consultation.` : '',
          'The consultation is by video call. Use the link below to join at the scheduled time.',
          `Reference: ${escapeHtml(reference)}`,
        ].filter(Boolean),
        meetingUrl ? { label: 'Join the video call', url: meetingUrl } : undefined,
      );
      return { ...email, subject: `Confirmed: ${service} on ${when}` };
    }

    case 'appointment.reminder': {
      const email = layout(
        'Your consultation is tomorrow',
        [
          `Hello ${escapeHtml(name)},`,
          `A reminder that your <strong>${escapeHtml(service)}</strong> is at <strong>${escapeHtml(when)}</strong>.`,
          'If you need to move it, you can reschedule from your account up to 12 hours beforehand.',
        ],
        meetingUrl ? { label: 'Join the video call', url: meetingUrl } : undefined,
      );
      return { ...email, subject: `Tomorrow: ${service} at ${when}` };
    }

    case 'appointment.cancelled': {
      const reason = str(payload, 'reason');
      const by = str(payload, 'cancelledBy', 'you');
      const email = layout(
        'Your consultation has been cancelled',
        [
          `Hello ${escapeHtml(name)},`,
          `The <strong>${escapeHtml(service)}</strong> booked for ${escapeHtml(when)} has been cancelled by ${escapeHtml(by)}.`,
          reason ? `Reason given: ${escapeHtml(reason)}` : '',
          'You are welcome to book another time whenever suits you.',
        ].filter(Boolean),
      );
      return { ...email, subject: `Cancelled: ${service} on ${when}` };
    }

    case 'appointment.rescheduled': {
      const previous = formatWhen(str(payload, 'previousStartsAt'), timezone);
      const email = layout(
        'Your consultation has moved',
        [
          `Hello ${escapeHtml(name)},`,
          `Your <strong>${escapeHtml(service)}</strong> has moved from ${escapeHtml(previous)} to <strong>${escapeHtml(when)}</strong>.`,
          `New reference: ${escapeHtml(reference)}`,
        ],
        meetingUrl ? { label: 'Join the video call', url: meetingUrl } : undefined,
      );
      return { ...email, subject: `Moved: ${service} is now ${when}` };
    }

    case 'appointment.meeting_url_changed':
      return layout('Your meeting link has changed', [
        `Hello ${escapeHtml(name)},`,
        `The link for your consultation on ${escapeHtml(when)} has changed. Please use the new one below.`,
      ], meetingUrl ? { label: 'Join the video call', url: meetingUrl } : undefined);

    case 'admin.appointment.booked':
      return layout('New booking', [
        `<strong>${escapeHtml(str(payload, 'clientName', 'A client'))}</strong> booked ${escapeHtml(service)}.`,
        `When: ${escapeHtml(when)}`,
        `Contact: ${escapeHtml(str(payload, 'clientEmail'))} · ${escapeHtml(str(payload, 'clientPhone'))}`,
        `Reference: ${escapeHtml(reference)}`,
      ]);

    case 'admin.appointment.cancelled_by_user':
      return layout('A client cancelled', [
        `<strong>${escapeHtml(str(payload, 'clientName', 'A client'))}</strong> cancelled ${escapeHtml(service)} on ${escapeHtml(when)}.`,
        `Reason: ${escapeHtml(str(payload, 'reason', 'not given'))}`,
      ]);

    case 'admin.daily_digest':
      return layout("Tomorrow's schedule", [str(payload, 'summary', 'No appointments scheduled.')]);

    case 'itr.registered':
      return layout('We have your filing request', [
        `Hello ${escapeHtml(name)},`,
        `Your request to file <strong>${escapeHtml(str(payload, 'formType'))}</strong> for ${escapeHtml(str(payload, 'assessmentYear'))} has been received.`,
        'The CA will review it and come back to you — usually within two working days — with anything else that is needed.',
        `Reference: ${escapeHtml(reference)}`,
      ]);

    case 'itr.info_requested':
      return layout('We need something from you', [
        `Hello ${escapeHtml(name)},`,
        `To carry on with your ${escapeHtml(str(payload, 'assessmentYear'))} filing, the CA has asked for:`,
        `<em>${escapeHtml(str(payload, 'infoRequested'))}</em>`,
        'You can reply in your account and the CA will pick it up there.',
      ]);

    case 'itr.status_changed':
      return layout('An update on your filing', [
        `Hello ${escapeHtml(name)},`,
        `Your ${escapeHtml(str(payload, 'assessmentYear'))} filing is now: <strong>${escapeHtml(str(payload, 'statusLabel'))}</strong>.`,
        `Reference: ${escapeHtml(reference)}`,
      ]);

    case 'itr.filed': {
      const ack = str(payload, 'acknowledgementNumber');
      return layout('Your return has been filed', [
        `Hello ${escapeHtml(name)},`,
        `Your ${escapeHtml(str(payload, 'assessmentYear'))} return has been filed.`,
        `Acknowledgement number: <strong>${escapeHtml(ack)}</strong>`,
        'Keep this for your records. Do verify the return if you have not already.',
      ]);
    }

    case 'itr.cancelled':
      return layout('Your filing engagement has been closed', [
        `Hello ${escapeHtml(name)},`,
        `The ${escapeHtml(str(payload, 'assessmentYear'))} filing engagement has been closed by the CA.`,
        str(payload, 'reason') ? `Reason: ${escapeHtml(str(payload, 'reason'))}` : '',
      ].filter(Boolean));

    case 'admin.itr.registered':
      return layout('New filing request', [
        `<strong>${escapeHtml(str(payload, 'clientName', 'A client'))}</strong> registered ${escapeHtml(str(payload, 'formType'))} for ${escapeHtml(str(payload, 'assessmentYear'))}.`,
        payload.hasBusinessIncome ? 'Flagged as having business income.' : '',
        `Contact: ${escapeHtml(str(payload, 'clientEmail'))}`,
        `Reference: ${escapeHtml(reference)}`,
      ].filter(Boolean));

    case 'message.received':
      return layout('You have a new message', [
        `<strong>${escapeHtml(str(payload, 'fromName', 'Someone'))}</strong> wrote about "${escapeHtml(str(payload, 'subject'))}":`,
        `<em>${escapeHtml(str(payload, 'preview'))}</em>`,
        'Sign in to read it in full and reply.',
      ]);

    case 'contact.acknowledged':
      return layout('Thanks for getting in touch', [
        `Hello ${escapeHtml(str(payload, 'name', 'there'))},`,
        `We have your message about "${escapeHtml(str(payload, 'subject'))}" and will reply by email shortly.`,
      ]);

    case 'admin.contact.received':
      return layout('New enquiry from the website', [
        `<strong>${escapeHtml(str(payload, 'name'))}</strong> — ${escapeHtml(str(payload, 'email'))} ${escapeHtml(str(payload, 'phone'))}`,
        `Subject: ${escapeHtml(str(payload, 'subject'))}`,
        `<em>${escapeHtml(str(payload, 'body'))}</em>`,
      ]);

    case 'user.welcome':
      return layout('Welcome', [
        `Hello ${escapeHtml(name)},`,
        'Your account is set up. You can now book a video consultation or register an income tax filing.',
        'Consultations are confirmed instantly — pick a time that suits you and you will get a join link straight away.',
      ]);
  }
}

/**
 * SMS bodies, written as fixed strings with variable slots so that what gets
 * registered with DLT is exactly what gets sent.
 *
 * These are built and tested but not wired: NOTIFY_SMS_ENABLED stays false
 * until TRAI DLT templates clear, and the use cases create no SMS outbox rows
 * while it is off.
 */
export function renderSms(templateKey: TemplateKey, payload: Payload): string | null {
  const service = str(payload, 'serviceName');
  const when = formatWhen(str(payload, 'startsAt'), str(payload, 'timezone', 'Asia/Kolkata'));

  switch (templateKey) {
    case 'appointment.confirmed':
      return `Your ${service} is confirmed for ${when}. Join link sent by email. Ref ${str(payload, 'reference')}`;
    case 'appointment.reminder':
      return `Reminder: ${service} tomorrow at ${when}. Join link is in your email.`;
    case 'appointment.cancelled':
      return `Your ${service} on ${when} has been cancelled. Details by email.`;
    case 'appointment.rescheduled':
      return `Your ${service} has moved to ${when}. Details by email.`;
    default:
      return null;
  }
}
