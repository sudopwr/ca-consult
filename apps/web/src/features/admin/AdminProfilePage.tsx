import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import type { AdminCaProfile } from '@ca/contracts';
import { ApiError } from '../../shared/api/client';
import { endpoints, keys } from '../../shared/api/endpoints';
import { ErrorState, Loading, PageHeader } from '../../shared/ui';

const EMPTY: AdminCaProfile = {
  fullName: '',
  headline: null,
  membershipNumber: null,
  firmName: null,
  bio: null,
  photoUrl: null,
  yearsExperience: null,
  qualifications: [],
  specialisations: [],
  languages: [],
  officeAddress: null,
  googleMapsUrl: null,
  contactEmail: null,
  contactPhone: null,
  whatsappNumber: null,
  linkedinUrl: null,
  defaultMeetingUrl: null,
  timezone: 'Asia/Kolkata',
  isPublished: false,
  updatedAt: '',
};

export function AdminProfilePage(): React.ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: keys.admin.caProfile, queryFn: endpoints.admin.caProfile });

  const [form, setForm] = useState<AdminCaProfile>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () =>
      endpoints.admin.saveCaProfile({
        ...form,
        qualifications: form.qualifications,
        specialisations: form.specialisations,
        languages: form.languages,
      } as never),
    onSuccess: async () => {
      setErrors({});
      await queryClient.invalidateQueries({ queryKey: keys.admin.caProfile });
      await queryClient.invalidateQueries({ queryKey: keys.publicProfile });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
    },
  });

  const set =
    <K extends keyof AdminCaProfile>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value || null }) as AdminCaProfile);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;

  /**
   * The publish switch is gated on a meeting room, because bookings
   * auto-confirm: the confirmation email leaves within seconds and has to
   * carry a working join link. The database enforces the same rule.
   */
  const canPublish = !!form.defaultMeetingUrl;

  return (
    <>
      <PageHeader
        title="Practice profile"
        subtitle="What clients see on the landing page."
        action={
          <Chip
            label={form.isPublished ? 'Live' : 'Not published'}
            color={form.isPublished ? 'success' : 'default'}
          />
        }
      />

      <Stack spacing={3}>
        {!canPublish && (
          <Alert severity="warning">
            Add a meeting room link before publishing. Bookings are confirmed instantly, so the
            confirmation email needs somewhere to send clients.
          </Alert>
        )}

        <Card>
          <CardContent>
            <Typography variant="h3" gutterBottom>
              Video consultations
            </Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              <TextField
                label="Meeting room link"
                placeholder="https://meet.google.com/abc-defg-hij"
                value={form.defaultMeetingUrl ?? ''}
                onChange={set('defaultMeetingUrl')}
                error={!!errors.defaultMeetingUrl}
                helperText={
                  errors.defaultMeetingUrl ??
                  'Your permanent Google Meet, Zoom or Jitsi room. Snapshotted onto each booking, so changing it later will not rewrite links already sent out.'
                }
                fullWidth
              />
              <Alert severity="info" variant="outlined">
                Because everyone joins the same room, set a 5–10 minute gap between slots on the
                schedule page and turn on your provider&apos;s waiting room.
              </Alert>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h3" gutterBottom>
              About you
            </Typography>

            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Full name"
                  value={form.fullName}
                  onChange={set('fullName')}
                  error={!!errors.fullName}
                  helperText={errors.fullName}
                  required
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Firm name"
                  value={form.firmName ?? ''}
                  onChange={set('firmName')}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  label="Headline"
                  placeholder="Chartered Accountant | 14 years in practice"
                  value={form.headline ?? ''}
                  onChange={set('headline')}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField
                  label="ICAI no."
                  value={form.membershipNumber ?? ''}
                  onChange={set('membershipNumber')}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField
                  label="Years"
                  type="number"
                  value={form.yearsExperience ?? ''}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      yearsExperience: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                  fullWidth
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  label="About the practice"
                  value={form.bio ?? ''}
                  onChange={set('bio')}
                  multiline
                  minRows={4}
                  fullWidth
                />
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <TagInput
                  label="Qualifications"
                  value={form.qualifications}
                  onChange={(value) => setForm((c) => ({ ...c, qualifications: value }))}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TagInput
                  label="Specialisations"
                  value={form.specialisations}
                  onChange={(value) => setForm((c) => ({ ...c, specialisations: value }))}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TagInput
                  label="Languages"
                  value={form.languages}
                  onChange={(value) => setForm((c) => ({ ...c, languages: value }))}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h3" gutterBottom>
              Contact
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Email"
                  value={form.contactEmail ?? ''}
                  onChange={set('contactEmail')}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Phone"
                  value={form.contactPhone ?? ''}
                  onChange={set('contactPhone')}
                  fullWidth
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  label="Office address"
                  value={form.officeAddress ?? ''}
                  onChange={set('officeAddress')}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {mutation.isError && <ErrorState error={mutation.error} />}
        {mutation.isSuccess && <Alert severity="success">Saved.</Alert>}

        <Stack direction="row" spacing={2} alignItems="center">
          <FormControlLabel
            control={
              <Switch
                checked={form.isPublished}
                disabled={!canPublish}
                onChange={(event) => setForm((c) => ({ ...c, isPublished: event.target.checked }))}
              />
            }
            label="Publish the landing page"
          />
          <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </Stack>
      </Stack>
    </>
  );
}

function TagInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
}): React.ReactElement {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={[...value]}
      onChange={(_event, next) => onChange(next as string[])}
      renderInput={(params) => <TextField {...params} label={label} placeholder="Type and press enter" />}
    />
  );
}
