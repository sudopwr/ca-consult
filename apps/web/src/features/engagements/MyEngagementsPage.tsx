import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Appointment, ItrEngagement } from '@ca/contracts';
import { endpoints, keys } from '../../shared/api/endpoints';
import {
  appointmentStatusLabel,
  formatDateTime,
  formatMoney,
  formatRelative,
  itrStatusLabel,
} from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusChip } from '../../shared/ui';

const ITR_PROGRESS: Record<string, number> = {
  SUBMITTED: 15,
  IN_REVIEW: 35,
  INFO_REQUESTED: 35,
  IN_PROGRESS: 60,
  FILED: 90,
  COMPLETED: 100,
};

/**
 * One timeline for both kinds of engagement. Clients think "my dealings with
 * the CA", not "my appointments table" — the two are separate in storage
 * because they share no invariants, and joined here because that is how they
 * are read.
 */
export function MyEngagementsPage(): React.ReactElement {
  const [scope, setScope] = useState<'upcoming' | 'past' | 'all'>('all');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: keys.myEngagements(scope),
    queryFn: () => endpoints.myEngagements(scope),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['me'] });

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        title="My engagements"
        subtitle="Consultations and filings, newest activity first."
        action={
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/book" variant="contained">
              Book
            </Button>
            <Button component={RouterLink} to="/itr" variant="outlined">
              File a return
            </Button>
          </Stack>
        }
      />

      <Tabs value={scope} onChange={(_e, value) => setScope(value)} sx={{ mb: 3 }}>
        <Tab value="all" label="All" />
        <Tab value="upcoming" label="Active" />
        <Tab value="past" label="Finished" />
      </Tabs>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}

      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="Nothing here yet"
          description="Book a video consultation or register an income tax filing to get started."
          action={
            <Button component={RouterLink} to="/book" variant="contained">
              Book a consultation
            </Button>
          }
        />
      )}

      <Stack spacing={2}>
        {query.data?.items.map((item) =>
          item.kind === 'APPOINTMENT' ? (
            <AppointmentCard
              key={item.appointment.id}
              appointment={item.appointment}
              onChanged={invalidate}
            />
          ) : (
            <EngagementCard
              key={item.engagement.id}
              engagement={item.engagement}
              onChanged={invalidate}
            />
          ),
        )}
      </Stack>
    </Container>
  );
}

function AppointmentCard({
  appointment,
  onChanged,
}: {
  appointment: Appointment;
  onChanged: () => void;
}): React.ReactElement {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const cancelMutation = useMutation({
    mutationFn: () => endpoints.cancelAppointment(appointment.id, reason),
    onSuccess: () => {
      setCancelling(false);
      setReason('');
      onChanged();
    },
  });

  const upcoming = appointment.status === 'CONFIRMED';
  const hoursAway = (new Date(appointment.startsAt).getTime() - Date.now()) / 3_600_000;
  const withinWindow = hoursAway >= 12;

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Consultation · {appointment.reference}
              </Typography>
              <Typography variant="h3">{appointment.serviceName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {formatDateTime(appointment.startsAt)}
                {upcoming && ` · ${formatRelative(appointment.startsAt)}`}
              </Typography>
            </Box>
            <StatusChip
              status={appointment.status}
              label={appointmentStatusLabel(appointment.status)}
            />
          </Stack>

          {appointment.cancellationReason && (
            <Alert severity="info" variant="outlined">
              {appointment.cancellationReason}
            </Alert>
          )}

          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              {formatMoney(appointment.amountPaise)}
            </Typography>

            {upcoming && appointment.meetingUrl && (
              <Button
                href={appointment.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                size="small"
              >
                Join the call
              </Button>
            )}

            {upcoming && withinWindow && (
              <Button size="small" color="inherit" onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}

            {upcoming && !withinWindow && (
              <Typography variant="caption" color="text.secondary">
                Too close to cancel online — send a message instead
              </Typography>
            )}
          </Stack>
        </Stack>
      </CardContent>

      <Dialog open={cancelling} onClose={() => setCancelling(false)} fullWidth maxWidth="xs">
        <DialogTitle>Cancel this consultation?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {appointment.serviceName} on {formatDateTime(appointment.startsAt)}
            </Typography>
            <TextField
              label="Reason"
              placeholder="A short note for the CA"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              multiline
              minRows={2}
              fullWidth
              autoFocus
            />
            {cancelMutation.isError && <ErrorState error={cancelMutation.error} />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(false)}>Keep it</Button>
          <Button
            variant="contained"
            color="error"
            disabled={reason.trim().length < 3 || cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Cancel the booking
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function EngagementCard({
  engagement,
  onChanged,
}: {
  engagement: ItrEngagement;
  onChanged: () => void;
}): React.ReactElement {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const cancelMutation = useMutation({
    mutationFn: () => endpoints.cancelItr(engagement.id, reason),
    onSuccess: () => {
      setCancelling(false);
      onChanged();
    },
  });

  const cancellable = ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED'].includes(engagement.status);
  const progress = ITR_PROGRESS[engagement.status] ?? 0;

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Tax filing · {engagement.reference}
              </Typography>
              <Typography variant="h3">{engagement.serviceName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {engagement.assessmentYear} · updated {formatRelative(engagement.updatedAt)}
              </Typography>
            </Box>
            <StatusChip status={engagement.status} label={itrStatusLabel(engagement.status)} />
          </Stack>

          {progress > 0 && (
            <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1 }} />
          )}

          {/* The one thing the client must act on. */}
          {engagement.status === 'INFO_REQUESTED' && engagement.infoRequested && (
            <Alert severity="warning">
              <Typography variant="body2" fontWeight={600} gutterBottom>
                The CA needs something from you
              </Typography>
              <Typography variant="body2">{engagement.infoRequested}</Typography>
              <Button component={RouterLink} to="/messages" size="small" sx={{ mt: 1 }}>
                Reply
              </Button>
            </Alert>
          )}

          {engagement.acknowledgementNumber && (
            <Alert severity="success" variant="outlined">
              Filed. Acknowledgement number <strong>{engagement.acknowledgementNumber}</strong>
            </Alert>
          )}

          {engagement.cancellationReason && (
            <Alert severity="info" variant="outlined">
              {engagement.cancellationReason}
            </Alert>
          )}

          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {formatMoney(engagement.amountPaise)}
            </Typography>
            {cancellable && (
              <Button size="small" color="inherit" onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>

      <Dialog open={cancelling} onClose={() => setCancelling(false)} fullWidth maxWidth="xs">
        <DialogTitle>Cancel this filing?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              multiline
              minRows={2}
              fullWidth
              autoFocus
            />
            {cancelMutation.isError && <ErrorState error={cancelMutation.error} />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(false)}>Keep it</Button>
          <Button
            variant="contained"
            color="error"
            disabled={reason.trim().length < 3 || cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Cancel the filing
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
