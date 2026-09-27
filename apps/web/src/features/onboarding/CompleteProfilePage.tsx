import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { completeProfileRequestSchema } from '@ca/contracts';
import { ApiError } from '../../shared/api/client';
import { endpoints } from '../../shared/api/endpoints';
import { useAuth } from '../../shared/auth/AuthProvider';

interface FormState {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

/**
 * Onboarding. Google hands over an email and a display name; a practice that
 * is going to file someone's return needs a number it can ring and an address
 * for correspondence — so it is asked once, here, rather than chased later.
 */
export function CompleteProfilePage(): React.ReactElement {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/me';

  const [form, setForm] = useState<FormState>({
    fullName: me?.profile.fullName ?? '',
    phone: me?.profile.phone ?? '',
    line1: me?.profile.address?.line1 ?? '',
    line2: me?.profile.address?.line2 ?? '',
    city: me?.profile.address?.city ?? '',
    state: me?.profile.address?.state ?? '',
    pincode: me?.profile.address?.pincode ?? '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: unknown) => endpoints.updateProfile(payload),
    onSuccess: async () => {
      await refresh();
      navigate(returnTo, { replace: true });
    },
    onError: (error) => {
      // The API validates with the same schema, so field errors come back
      // keyed by the same paths the form uses.
      if (error instanceof ApiError) setErrors(error.fieldErrors);
    },
  });

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const candidate = {
      fullName: form.fullName,
      phone: form.phone.startsWith('+') ? form.phone : `+91${form.phone.replace(/\D/g, '')}`,
      address: {
        line1: form.line1,
        line2: form.line2 || null,
        city: form.city,
        state: form.state,
        pincode: form.pincode,
      },
    };

    // Validated here with the shared schema so the user sees the problem
    // without a round trip; the server runs the identical check anyway.
    const parsed = completeProfileRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    mutation.mutate(parsed.data);
  };

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h2" component="h1">
          A few details before we start
        </Typography>
        <Typography variant="body2" color="text.secondary">
          The practice needs a number it can reach you on and an address for correspondence.
          You only have to do this once.
        </Typography>
      </Stack>

      <Card>
        <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
          <form onSubmit={submit} noValidate>
            <Stack spacing={2.5}>
              <TextField
                label="Full name"
                value={form.fullName}
                onChange={set('fullName')}
                error={!!errors.fullName}
                helperText={errors.fullName}
                autoComplete="name"
                required
                fullWidth
              />

              <TextField
                label="Mobile number"
                value={form.phone}
                onChange={set('phone')}
                error={!!errors.phone}
                helperText={errors.phone ?? 'A 10-digit Indian mobile, or an international number starting with +'}
                autoComplete="tel"
                required
                fullWidth
              />

              <TextField
                label="Address"
                value={form.line1}
                onChange={set('line1')}
                error={!!errors['address.line1']}
                helperText={errors['address.line1']}
                autoComplete="address-line1"
                required
                fullWidth
              />

              <TextField
                label="Address line 2"
                value={form.line2}
                onChange={set('line2')}
                autoComplete="address-line2"
                fullWidth
              />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 5 }}>
                  <TextField
                    label="City"
                    value={form.city}
                    onChange={set('city')}
                    error={!!errors['address.city']}
                    helperText={errors['address.city']}
                    autoComplete="address-level2"
                    required
                    fullWidth
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    label="State"
                    value={form.state}
                    onChange={set('state')}
                    error={!!errors['address.state']}
                    helperText={errors['address.state']}
                    autoComplete="address-level1"
                    required
                    fullWidth
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField
                    label="PIN code"
                    value={form.pincode}
                    onChange={set('pincode')}
                    error={!!errors['address.pincode']}
                    helperText={errors['address.pincode']}
                    autoComplete="postal-code"
                    required
                    fullWidth
                  />
                </Grid>
              </Grid>

              {mutation.isError && !Object.keys(errors).length && (
                <Alert severity="error">
                  {mutation.error instanceof Error ? mutation.error.message : 'Could not save'}
                </Alert>
              )}

              <Button type="submit" variant="contained" size="large" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save and continue'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
