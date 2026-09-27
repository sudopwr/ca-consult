import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatRelative } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '../../shared/ui';

export function AdminUsersPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const params = { q: search || undefined, status: status || undefined, page: page + 1, pageSize: 20 };

  const query = useQuery({
    queryKey: keys.admin.users(params),
    queryFn: () => endpoints.admin.users(params),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'ACTIVE' | 'BLOCKED' }) =>
      endpoints.admin.setUserStatus(id, next),
    onSuccess: refresh,
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => endpoints.admin.resetNoShows(id),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader title="Clients" subtitle="Everyone who has signed in." />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Name, email or phone"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280 }}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="BLOCKED">Suspended</MenuItem>
        </TextField>
      </Stack>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} />}

      {query.data?.items.length === 0 && <EmptyState title="No clients match that" />}

      {query.data && query.data.items.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Client</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell align="center">Consults</TableCell>
                <TableCell align="center">Filings</TableCell>
                <TableCell>Last activity</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data.items.map((user) => (
                <TableRow key={user.id} hover sx={{ opacity: user.status === 'BLOCKED' ? 0.5 : 1 }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {user.fullName ?? '—'}
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {user.role === 'ADMIN' && <Chip size="small" label="Admin" color="primary" />}
                      {user.status === 'BLOCKED' && (
                        <Chip size="small" label="Suspended" color="error" />
                      )}
                      {!user.profileCompletedAt && (
                        <Chip size="small" variant="outlined" label="Onboarding" />
                      )}
                      {user.noShowCount >= 3 && (
                        <Chip size="small" color="warning" label={`${user.noShowCount} no-shows`} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{user.email}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {user.phone ?? 'no phone'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">{user.appointmentCount}</TableCell>
                  <TableCell align="center">{user.engagementCount}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {user.lastActivityAt ? formatRelative(user.lastActivityAt) : 'never'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {/* Three no-shows pauses online booking; this is how the
                          CA reopens it after a conversation. */}
                      {user.noShowCount > 0 && (
                        <Button size="small" onClick={() => resetMutation.mutate(user.id)}>
                          Reset no-shows
                        </Button>
                      )}
                      {user.role !== 'ADMIN' && (
                        <Button
                          size="small"
                          color={user.status === 'BLOCKED' ? 'primary' : 'error'}
                          onClick={() =>
                            statusMutation.mutate({
                              id: user.id,
                              next: user.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED',
                            })
                          }
                        >
                          {user.status === 'BLOCKED' ? 'Restore' : 'Suspend'}
                        </Button>
                      )}
                    </Stack>
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
    </>
  );
}
