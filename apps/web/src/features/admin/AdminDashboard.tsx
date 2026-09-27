import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatTime, itrStatusLabel } from '../../shared/format';
import { EmptyState, ErrorState, Loading, PageHeader, StatusChip } from '../../shared/ui';

/**
 * Everything here is something the practitioner might act on today. No vanity
 * metrics — a count of total users tells them nothing they can do anything
 * about at nine in the morning.
 */
export function AdminDashboard(): React.ReactElement {
  const query = useQuery({
    queryKey: keys.admin.dashboard,
    queryFn: endpoints.admin.dashboard,
    refetchInterval: 60_000,
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const data = query.data;

  return (
    <Box>
      <PageHeader title="Today" subtitle={data.today.date} />

      {data.outbox.dead > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {data.outbox.dead} notification{data.outbox.dead === 1 ? '' : 's'} could not be
          delivered. Check the email address on those records.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Stat label="Left today" value={data.today.remainingCount} to="/admin/appointments" />
        <Stat label="Next 7 days" value={data.upcomingSevenDays} to="/admin/appointments" />
        <Stat
          label="Waiting on clients"
          value={data.awaitingClientInfo}
          to="/admin/itr"
          highlight={data.awaitingClientInfo > 0}
        />
        <Stat
          label="Unread messages"
          value={data.unreadThreads}
          to="/admin/inbox"
          highlight={data.unreadThreads > 0}
        />
        <Stat
          label="New enquiries"
          value={data.newEnquiries}
          to="/admin/enquiries"
          highlight={data.newEnquiries > 0}
        />
        <Stat label="New clients this week" value={data.newUsersThisWeek} to="/admin/users" />
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="h3" gutterBottom>
            Today&apos;s consultations
          </Typography>

          {data.today.appointments.length === 0 ? (
            <EmptyState title="Nothing booked today" description="A clear day." />
          ) : (
            <Stack spacing={1.5}>
              {data.today.appointments.map((appointment) => (
                <Card key={appointment.id}>
                  <CardContent sx={{ py: 2 }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      spacing={2}
                    >
                      <Box>
                        <Typography variant="body1" fontWeight={600}>
                          {formatTime(appointment.startsAt)} · {appointment.userName ?? appointment.userEmail}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {appointment.serviceName} · {appointment.userPhone ?? 'no phone'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {appointment.meetingUrl && (
                          <Button
                            href={appointment.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="small"
                            variant="contained"
                          >
                            Join
                          </Button>
                        )}
                        <Button
                          component={RouterLink}
                          to={`/admin/appointments/${appointment.id}`}
                          size="small"
                        >
                          Open
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Typography variant="h3" gutterBottom>
            Filing pipeline
          </Typography>

          <Card>
            <CardContent>
              {data.itrPipeline.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No filings registered yet.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {data.itrPipeline
                    .filter((row) => !row.status.startsWith('CANCELLED'))
                    .map((row) => (
                      <Stack
                        key={row.status}
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <StatusChip status={row.status} label={itrStatusLabel(row.status)} />
                        <Typography variant="body1" fontWeight={600}>
                          {row.count}
                        </Typography>
                      </Stack>
                    ))}
                </Stack>
              )}
              <Button component={RouterLink} to="/admin/itr" sx={{ mt: 2 }} fullWidth>
                Open the pipeline
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function Stat({
  label,
  value,
  to,
  highlight,
}: {
  label: string;
  value: number;
  to: string;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
      <Card
        component={RouterLink}
        to={to}
        sx={{
          textDecoration: 'none',
          display: 'block',
          height: '100%',
          borderColor: highlight ? 'warning.main' : undefined,
          borderWidth: highlight ? 2 : 1,
        }}
      >
        <CardContent>
          <Typography variant="h2" color={highlight ? 'warning.dark' : 'primary.main'}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}
