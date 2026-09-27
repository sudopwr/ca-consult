import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Service } from '@ca/contracts';
import { ApiError } from '../../shared/api/client';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatMoney } from '../../shared/format';
import { ErrorState, Loading, PageHeader } from '../../shared/ui';

interface Draft {
  id?: string;
  kind: 'CONSULTANCY' | 'ITR_FILING';
  name: string;
  slug: string;
  description: string;
  amountRupees: string;
  durationMinutes: string;
  assessmentYear: string;
  itrFormType: string;
  isActive: boolean;
  sortOrder: string;
}

const BLANK: Draft = {
  kind: 'CONSULTANCY',
  name: '',
  slug: '',
  description: '',
  amountRupees: '',
  durationMinutes: '30',
  assessmentYear: '',
  itrFormType: '',
  isActive: true,
  sortOrder: '0',
};

export function AdminServicesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({ queryKey: keys.admin.services, queryFn: () => endpoints.admin.services() });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.admin.services });
    await queryClient.invalidateQueries({ queryKey: ['public', 'services'] });
  };

  const saveMutation = useMutation({
    mutationFn: (value: Draft) => {
      const payload = {
        kind: value.kind,
        name: value.name,
        slug: value.slug,
        description: value.description || null,
        // Rupees in the form, paise on the wire. Money is never a float here.
        amountPaise: Math.round(Number(value.amountRupees) * 100),
        durationMinutes: value.kind === 'CONSULTANCY' ? Number(value.durationMinutes) : null,
        assessmentYear: value.kind === 'ITR_FILING' ? value.assessmentYear : null,
        itrFormType: value.kind === 'ITR_FILING' ? value.itrFormType : null,
        isActive: value.isActive,
        sortOrder: Number(value.sortOrder),
      };

      return value.id
        ? endpoints.admin.updateService(value.id, payload as never)
        : endpoints.admin.createService(payload as never);
    },
    onSuccess: async () => {
      setDraft(null);
      setErrors({});
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => endpoints.admin.deleteService(id),
    onSuccess: async (result) => {
      setNotice(
        result.deactivated
          ? 'That service has bookings against it, so it has been hidden rather than deleted.'
          : 'Service deleted.',
      );
      await refresh();
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;

  const edit = (service: Service) =>
    setDraft({
      id: service.id,
      kind: service.kind,
      name: service.name,
      slug: service.slug,
      description: service.description ?? '',
      amountRupees: String(service.amountPaise / 100),
      durationMinutes: String(service.durationMinutes ?? 30),
      assessmentYear: service.assessmentYear ?? '',
      itrFormType: service.itrFormType ?? '',
      isActive: service.isActive,
      sortOrder: String(service.sortOrder),
    });

  return (
    <>
      <PageHeader
        title="Services and charges"
        subtitle="What appears on the landing page, and what it costs."
        action={
          <Button variant="contained" onClick={() => setDraft(BLANK)}>
            Add a service
          </Button>
        }
      />

      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell>Details</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {query.data.map((service) => (
              <TableRow key={service.id} sx={{ opacity: service.isActive ? 1 : 0.5 }}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {service.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    /{service.slug}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={service.kind === 'CONSULTANCY' ? 'Consultation' : 'ITR filing'}
                  />
                </TableCell>
                <TableCell align="right">{formatMoney(service.amountPaise)}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {service.kind === 'CONSULTANCY'
                      ? `${service.durationMinutes} minutes`
                      : `${service.itrFormType} · ${service.assessmentYear}`}
                    {!service.isActive && ' · hidden'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => edit(service)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => deleteMutation.mutate(service.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? 'Edit service' : 'New service'}</DialogTitle>
        <DialogContent>
          {draft && (
            <Grid container spacing={2} sx={{ pt: 1 }}>
              <Grid size={12}>
                <TextField
                  select
                  label="Type"
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({ ...draft, kind: event.target.value as Draft['kind'] })
                  }
                  fullWidth
                >
                  <MenuItem value="CONSULTANCY">Video consultation</MenuItem>
                  <MenuItem value="ITR_FILING">ITR filing</MenuItem>
                </TextField>
              </Grid>

              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  label="Name"
                  value={draft.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setDraft({
                      ...draft,
                      name,
                      // Only auto-slug a new service; changing an existing
                      // slug would break links the practice may have shared.
                      slug: draft.id
                        ? draft.slug
                        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                    });
                  }}
                  error={!!errors.name}
                  helperText={errors.name}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  label="Link"
                  value={draft.slug}
                  onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                  error={!!errors.slug}
                  helperText={errors.slug}
                  fullWidth
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  label="Description"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </Grid>

              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Price (₹)"
                  type="number"
                  value={draft.amountRupees}
                  onChange={(event) => setDraft({ ...draft, amountRupees: event.target.value })}
                  error={!!errors.amountPaise}
                  fullWidth
                />
              </Grid>

              {draft.kind === 'CONSULTANCY' ? (
                <Grid size={{ xs: 6, sm: 4 }}>
                  <TextField
                    label="Minutes"
                    type="number"
                    value={draft.durationMinutes}
                    onChange={(event) =>
                      setDraft({ ...draft, durationMinutes: event.target.value })
                    }
                    error={!!errors.durationMinutes}
                    helperText={errors.durationMinutes}
                    fullWidth
                  />
                </Grid>
              ) : (
                <>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      select
                      label="Form"
                      value={draft.itrFormType}
                      onChange={(event) => setDraft({ ...draft, itrFormType: event.target.value })}
                      error={!!errors.itrFormType}
                      fullWidth
                    >
                      {['ITR-1', 'ITR-2', 'ITR-3', 'ITR-4', 'ITR-5', 'ITR-6', 'ITR-7'].map((form) => (
                        <MenuItem key={form} value={form}>
                          {form}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="Assessment year"
                      placeholder="AY 2026-27"
                      value={draft.assessmentYear}
                      onChange={(event) =>
                        setDraft({ ...draft, assessmentYear: event.target.value })
                      }
                      error={!!errors.assessmentYear}
                      helperText={errors.assessmentYear}
                      fullWidth
                    />
                  </Grid>
                </>
              )}

              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Sort order"
                  type="number"
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                  fullWidth
                />
              </Grid>

              <Grid size={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={draft.isActive}
                      onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                    />
                  }
                  label="Show on the landing page"
                />
              </Grid>

              {saveMutation.isError && (
                <Grid size={12}>
                  <ErrorState error={saveMutation.error} />
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saveMutation.isPending}
            onClick={() => draft && saveMutation.mutate(draft)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
