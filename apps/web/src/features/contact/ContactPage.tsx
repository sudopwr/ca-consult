import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { endpoints } from '../../shared/api/endpoints';
import { ErrorState, PageHeader } from '../../shared/ui';
import { Turnstile } from './Turnstile';

/**
 * The way in for someone who has not engaged the practice yet.
 *
 * Four defences, three of which the visitor never sees: a hidden honeypot
 * field, the time between render and submit, a Turnstile token, and an IP rate
 * limit at the route.
 */
export function ContactPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const redirectedFromMessaging = searchParams.get('reason') === 'no-engagement';

  const renderedAt = useRef(Date.now());
  const [captchaToken, setCaptchaToken] = useState('');
  const [sent, setSent] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    body: '',
    website: '', // honeypot
  });

  useEffect(() => {
    renderedAt.current = Date.now();
  }, []);

  const mutation = useMutation({
    mutationFn: () =>
      endpoints.submitEnquiry({
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        subject: form.subject,
        body: form.body,
        captchaToken: captchaToken || 'unavailable',
        website: form.website,
        renderedAt: renderedAt.current,
      }),
    onSuccess: () => setSent(true),
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  if (sent) {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Card>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2}>
              <Typography variant="h2" component="h1">
                Thanks — that is with us
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The practice will reply to {form.email} shortly. If it is urgent, booking a
                consultation is the fastest route — those are confirmed instantly.
              </Typography>
              <Button href="/book" variant="contained" sx={{ alignSelf: 'flex-start' }}>
                Book a consultation
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader title="Get in touch" subtitle="Send a question and the practice will reply by email." />

      {/* Reached by the messaging guard, so explain why rather than just
          dumping them on a form. */}
      {redirectedFromMessaging && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <AlertTitle>Messaging is for clients</AlertTitle>
          Direct messaging opens once you have a consultation booked or a filing registered. Until
          then, this form reaches the same inbox.
        </Alert>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            noValidate
          >
            <Stack spacing={2.5}>
              <TextField label="Your name" value={form.name} onChange={set('name')} required fullWidth />
              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={set('email')}
                required
                fullWidth
              />
              <TextField label="Phone (optional)" value={form.phone} onChange={set('phone')} fullWidth />
              <TextField
                label="Subject"
                value={form.subject}
                onChange={set('subject')}
                required
                fullWidth
              />
              <TextField
                label="Your message"
                value={form.body}
                onChange={set('body')}
                multiline
                minRows={4}
                required
                fullWidth
                helperText={`${form.body.length}/3000`}
              />

              {/* The honeypot. Hidden from people and from screen readers, but
                  present in the DOM for a bot to fill in. */}
              <Box
                aria-hidden="true"
                sx={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
              >
                <label htmlFor="website">Leave this field empty</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={set('website')}
                />
              </Box>

              <Turnstile onToken={setCaptchaToken} />

              {mutation.isError && <ErrorState error={mutation.error} />}

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={mutation.isPending || form.body.trim().length < 10}
              >
                {mutation.isPending ? 'Sending…' : 'Send message'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
