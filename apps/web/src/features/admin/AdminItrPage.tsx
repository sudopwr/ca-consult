import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AdminItrEngagement } from '@ca/contracts';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatMoney, formatRelative, itrStatusLabel } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusChip } from '../../shared/ui';

/** What each status can legally become, mirroring the domain transition table. */
const NEXT_STATUSES: Record<string, string[]> = {
  SUBMITTED: ['IN_REVIEW', 'IN_PROGRESS', 'CANCELLED_BY_ADMIN'],
  IN_REVIEW: ['INFO_REQUESTED', 'IN_PROGRESS', 'CANCELLED_BY_ADMIN'],
  INFO_REQUESTED: ['IN_REVIEW', 'IN_PROGRESS', 'CANCELLED_BY_ADMIN'],
  IN_PROGRESS: ['FILED', 'INFO_REQUESTED', 'CANCELLED_BY_ADMIN'],
  FILED: ['COMPLETED'],
};

export function AdminItrPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminItrEngagement | null>(null);

  const params = { status: status || undefined, q: search || undefined, page: page + 1, pageSize: 20 };

  const query = useQuery({
    queryKey: keys.admin.itr(params),
    queryFn: () => endpoints.admin.itrEngagements(params),
  });

  return (
    <>
      <PageHeader
        title="Tax filings"
        subtitle="Newest requests and anything waiting on you, first."
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All</MenuItem>
          {Object.keys(NEXT_STATUSES)
            .concat(['COMPLETED', 'CANCELLED_BY_USER', 'CANCELLED_BY_ADMIN'])
            .map((value) => (
              <MenuItem key={value} value={value}>
                {itrStatusLabel(value)}
              </MenuItem>
            ))}
        </TextField>

        <TextField
          size="small"
          placeholder="Name, email or reference"
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

      {query.data?.items.length === 0 && (
        <EmptyState title="No filings" description="Nothing matches this filter." />
      )}

      {query.data && query.data.items.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Client</TableCell>
                <TableCell>Return</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data.items.map((engagement) => (
                <TableRow key={engagement.id} hover>
                  <TableCell>
                    <Typography variant="body2">
                      {engagement.userName ?? engagement.userEmail}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {engagement.reference}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Chip size="small" label={engagement.itrFormType} />
                      <Chip size="small" variant="outlined" label={engagement.assessmentYear} />
                    </Stack>
                    {engagement.hasBusinessIncome && (
                      <Typography variant="caption" color="warning.main">
                        business income
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={engagement.status}
                      label={itrStatusLabel(engagement.status)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {formatRelative(engagement.updatedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setSelected(engagement)}>
                      Open
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

      <EngagementDialog
        engagement={selected}
        onClose={() => setSelected(null)}
        onChanged={async () => {
          await queryClient.invalidateQueries({ queryKey: ['admin'] });
          setSelected(null);
        }}
      />
    </>
  );
}

function EngagementDialog({
  engagement,
  onClose,
  onChanged,
}: {
  engagement: AdminItrEngagement | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const [nextStatus, setNextStatus] = useState('');
  const [infoRequested, setInfoRequested] = useState('');
  const [acknowledgementNumber, setAcknowledgementNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      endpoints.admin.updateItrEngagement(engagement!.id, body),
    onSuccess: onChanged,
  });

  if (!engagement) return <Dialog open={false} onClose={onClose} />;

  const options = NEXT_STATUSES[engagement.status] ?? [];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{engagement.reference}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {engagement.userName ?? engagement.userEmail}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {engagement.serviceName} · {engagement.assessmentYear} ·{' '}
              {formatMoney(engagement.amountPaise)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {engagement.userEmail} · {engagement.userPhone ?? 'no phone'}
            </Typography>
          </Box>

          {engagement.userNotes && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                What the client wrote
              </Typography>
              <Typography variant="body2">{engagement.userNotes}</Typography>
            </Paper>
          )}

          {/* The only place in the whole app where a full PAN is shown, and
              the only route that can write one. */}
          <TextField
            label="PAN"
            placeholder="ABCDE1234F"
            defaultValue={engagement.panNumber ?? ''}
            onChange={(event) => setPanNumber(event.target.value.toUpperCase())}
            helperText="Recorded here when the client provides it — never collected on the public form."
            fullWidth
          />

          {engagement.acknowledgementNumber && (
            <Alert severity="success" variant="outlined">
              Filed · acknowledgement {engagement.acknowledgementNumber}
            </Alert>
          )}

          {options.length > 0 && (
            <>
              <TextField
                select
                label="Move to"
                value={nextStatus}
                onChange={(event) => setNextStatus(event.target.value)}
                fullWidth
              >
                <MenuItem value="">No change</MenuItem>
                {options.map((option) => (
                  <MenuItem key={option} value={option}>
                    {itrStatusLabel(option)}
                  </MenuItem>
                ))}
              </TextField>

              {nextStatus === 'INFO_REQUESTED' && (
                <TextField
                  label="What do you need from the client?"
                  helperText="They see this text in their account and by email"
                  value={infoRequested}
                  onChange={(event) => setInfoRequested(event.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
              )}

              {nextStatus === 'FILED' && (
                <TextField
                  label="Acknowledgement number"
                  value={acknowledgementNumber}
                  onChange={(event) => setAcknowledgementNumber(event.target.value)}
                  fullWidth
                />
              )}

              {nextStatus === 'CANCELLED_BY_ADMIN' && (
                <TextField
                  label="Reason for the client"
                  value={cancellationReason}
                  onChange={(event) => setCancellationReason(event.target.value)}
                  fullWidth
                />
              )}
            </>
          )}

          <TextField
            label="Private notes"
            defaultValue={engagement.adminNotes ?? ''}
            onChange={(event) => setAdminNotes(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />

          {mutation.isError && <ErrorState error={mutation.error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              status: nextStatus || undefined,
              infoRequested: infoRequested || undefined,
              acknowledgementNumber: acknowledgementNumber || undefined,
              panNumber: panNumber || undefined,
              cancellationReason: cancellationReason || undefined,
              adminNotes: adminNotes || undefined,
            })
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
