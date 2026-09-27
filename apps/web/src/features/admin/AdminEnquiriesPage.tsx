import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatDateTime } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '../../shared/ui';

const STATUS_COLOURS: Record<string, 'default' | 'primary' | 'success' | 'error'> = {
  NEW: 'primary',
  READ: 'default',
  REPLIED: 'success',
  SPAM: 'error',
};

/**
 * Visitors cannot open a thread, so this is where their questions land. The
 * CA replies by email — there is no anonymous conversation to maintain, and
 * once an enquirer books they become a client with normal messaging.
 */
export function AdminEnquiriesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');

  const params = { status: status || undefined, page: 1, pageSize: 50 };

  const query = useQuery({
    queryKey: keys.admin.enquiries(params),
    queryFn: () => endpoints.admin.enquiries(params),
  });

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      endpoints.admin.updateEnquiry(id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'enquiries'] });
      await queryClient.invalidateQueries({ queryKey: keys.admin.dashboard });
    },
  });

  return (
    <>
      <PageHeader
        title="Website enquiries"
        subtitle="Questions from people who have not booked yet."
        action={
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="NEW">New</MenuItem>
            <MenuItem value="READ">Read</MenuItem>
            <MenuItem value="REPLIED">Replied</MenuItem>
            <MenuItem value="SPAM">Spam</MenuItem>
          </TextField>
        }
      />

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} />}

      {query.data?.items.length === 0 && (
        <EmptyState title="No enquiries" description="Nothing to answer right now." />
      )}

      <Stack spacing={2}>
        {query.data?.items.map((enquiry) => (
          <Card key={enquiry.id}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ sm: 'flex-start' }}
                  spacing={1}
                >
                  <div>
                    <Typography variant="body1" fontWeight={600}>
                      {enquiry.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {enquiry.name} ·{' '}
                      <Link href={`mailto:${enquiry.email}`}>{enquiry.email}</Link>
                      {enquiry.phone && ` · ${enquiry.phone}`} ·{' '}
                      {formatDateTime(enquiry.createdAt)}
                    </Typography>
                  </div>
                  <Chip
                    size="small"
                    label={enquiry.status}
                    color={STATUS_COLOURS[enquiry.status] ?? 'default'}
                  />
                </Stack>

                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {enquiry.body}
                </Typography>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="contained"
                    href={`mailto:${enquiry.email}?subject=${encodeURIComponent(`Re: ${enquiry.subject}`)}`}
                    onClick={() =>
                      mutation.mutate({ id: enquiry.id, body: { status: 'REPLIED' } })
                    }
                  >
                    Reply by email
                  </Button>
                  {enquiry.status === 'NEW' && (
                    <Button
                      size="small"
                      onClick={() => mutation.mutate({ id: enquiry.id, body: { status: 'READ' } })}
                    >
                      Mark read
                    </Button>
                  )}
                  {enquiry.status !== 'SPAM' && (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => mutation.mutate({ id: enquiry.id, body: { status: 'SPAM' } })}
                    >
                      Spam
                    </Button>
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </>
  );
}
