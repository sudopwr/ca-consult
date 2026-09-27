import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Appointment } from '@ca/contracts';
import { formatDateTime, formatMoney } from '../../shared/format';

/**
 * The payoff of auto-confirm: no "we'll be in touch", no pending state to
 * explain. The join link and a calendar file are here immediately.
 */
export function BookingConfirmation({ appointment }: { appointment: Appointment }): React.ReactElement {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
      <Card>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Typography variant="h2" component="h1">
                You are booked in
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A confirmation is on its way to your inbox, with a reminder the day before.
              </Typography>
            </Stack>

            <Divider />

            <Stack spacing={1.5}>
              <Row label="What" value={appointment.serviceName} />
              <Row label="When" value={formatDateTime(appointment.startsAt)} />
              <Row label="Fee" value={`${formatMoney(appointment.amountPaise)}, at the consultation`} />
              <Row label="Reference" value={appointment.reference} />
            </Stack>

            {appointment.meetingUrl && (
              <Alert severity="success" variant="outlined">
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  Join the video call from this link at your appointment time.
                </Typography>
                <Button
                  href={appointment.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="contained"
                  size="small"
                >
                  Open the meeting room
                </Button>
              </Alert>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button variant="outlined" onClick={() => downloadIcs(appointment)}>
                Add to calendar
              </Button>
              <Button component={RouterLink} to="/me" variant="text">
                See all my bookings
              </Button>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Need to change it? You can cancel or move this up to 12 hours before it starts.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Stack direction="row" spacing={2}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 92 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * A minimal .ics, built client-side. No dependency, no round trip, and it
 * imports cleanly into Google Calendar, Outlook and Apple Calendar.
 */
function downloadIcs(appointment: Appointment): void {
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CA Consult//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@ca-consult`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(appointment.startsAt)}`,
    `DTEND:${stamp(appointment.endsAt)}`,
    `SUMMARY:${appointment.serviceName}`,
    appointment.meetingUrl ? `LOCATION:${appointment.meetingUrl}` : '',
    `DESCRIPTION:Reference ${appointment.reference}${
      appointment.meetingUrl ? `\\nJoin: ${appointment.meetingUrl}` : ''
    }`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Consultation in 30 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${appointment.reference}.ics`;
  link.click();

  URL.revokeObjectURL(url);
}
