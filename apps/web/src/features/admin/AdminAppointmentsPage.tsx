import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AdminAppointment } from '@ca/contracts';
import { endpoints, keys } from '../../shared/api/endpoints';
import { appointmentStatusLabel, formatDateTime } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusChip } from '../../shared/ui';

type Scope = 'today' | 'upcoming' | 'past' | 'all';

export function AdminAppointmentsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminAppointment | null>(null);

  const params = { scope, q: search || undefined, page: page + 1, pageSize: 20 };

  const query = useQuery({
    queryKey: keys.admin.appointments(params),
    queryFn: () => endpoints.admin.appointments(params),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  return (
    <>
      <PageHeader title="Consultations" subtitle="Everything booked, past and future." />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Tabs
          value={scope}
          onChange={(_e, value: Scope) => {
            setScope(value);
            setPage(0);
          }}
        >
          <Tab value="today" label="Today" />
          <Tab value="upcoming" label="Upcoming" />
          <Tab value="past" label="Past" />
          <Tab value="all" label="All" />
        </Tabs>

        <TextField
          size="small"
          placeholder="Name, email, phone or reference"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280 }}
        />
      </Stack>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} />}

      {query.data && query.data.items.length === 0 && (
        <EmptyState title="Nothing here" description="No consultations match this filter." />
      )}

      {query.data && query.data.items.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Client</TableCell>
                <TableCell>Service</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data.items.map((appointment) => (
                <TableRow key={appointment.id} hover>
                  <TableCell>
                    <Typography variant="body2">{formatDateTime(appointment.startsAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {appointment.reference}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {appointment.userName ?? appointment.userEmail}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {appointment.userPhone ?? appointment.userEmail}
                    </Typography>
                  </TableCell>
                  <TableCell>{appointment.serviceName}</TableCell>
                  <TableCell>
                    <StatusChip
                      status={appointment.status}
                      label={appointmentStatusLabel(appointment.status)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setSelected(appointment)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <TablePagination
            component="div"
            count={query.data.total}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
          />
        </TableContainer>
      )}

      <ManageDialog
        appointment={selected}
        onClose={() => setSelected(null)}
        onChanged={async () => {
          await refresh();
          setSelected(null);
        }}
      />
    </>
  );
}

function ManageDialog({
  appointment,
  onClose,
  onChanged,
}: {
  appointment: AdminAppointment | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const [adminNotes, setAdminNotes] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      endpoints.admin.updateAppointment(appointment!.id, body),
    onSuccess: onChanged,
  });

  if (!appointment) return <Dialog open={false} onClose={onClose} />;

  const started = new Date(appointment.startsAt).getTime() <= Date.now();
  const ended = new Date(appointment.endsAt).getTime() <= Date.now();
  const live = appointment.status === 'CONFIRMED';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{appointment.reference}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {appointment.userName ?? appointment.userEmail}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {appointment.serviceName} · {formatDateTime(appointment.startsAt)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {appointment.userEmail} · {appointment.userPhone ?? 'no phone'}
            </Typography>
          </Box>

          {appointment.userNotes && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                What the client wrote
              </Typography>
              <Typography variant="body2">{appointment.userNotes}</Typography>
            </Paper>
          )}

          <TextField
            label="Private notes"
            helperText="Only you see these"
            defaultValue={appointment.adminNotes ?? ''}
            onChange={(event) => setAdminNotes(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />

          {live && (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  disabled={!started || mutation.isPending}
                  onClick={() => mutation.mutate({ status: 'COMPLETED', adminNotes })}
                >
                  Mark completed
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={!ended || mutation.isPending}
                  onClick={() => mutation.mutate({ status: 'NO_SHOW', adminNotes })}
                >
                  Mark no-show
                </Button>
              </Stack>

              {!started && (
                <Typography variant="caption" color="text.secondary">
                  You can mark the outcome once the appointment has started.
                </Typography>
              )}

              <TextField
                label="Cancel — reason for the client"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                fullWidth
              />
              <Button
                color="error"
                variant="outlined"
                disabled={cancellationReason.trim().length < 3 || mutation.isPending}
                onClick={() =>
                  mutation.mutate({ status: 'CANCELLED_BY_ADMIN', cancellationReason, adminNotes })
                }
              >
                Cancel this consultation
              </Button>
            </>
          )}

          {mutation.isError && <ErrorState error={mutation.error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ adminNotes })}
        >
          Save notes
        </Button>
      </DialogActions>
    </Dialog>
  );
}
