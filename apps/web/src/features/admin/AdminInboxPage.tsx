import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatRelative } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatusChip } from '../../shared/ui';

const STATUS_LABEL: Record<string, string> = {
  AWAITING_ADMIN: 'Needs a reply',
  AWAITING_USER: 'Waiting on client',
  CLOSED: 'Closed',
};

export function AdminInboxPage(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = { page: 1, pageSize: 50 };
  const query = useQuery({
    queryKey: keys.admin.threads(params),
    queryFn: () => endpoints.admin.threads(params),
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader title="Messages" subtitle="Conversations with clients. Unanswered first." />

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} />}

      {query.data?.items.length === 0 && (
        <EmptyState
          title="No conversations"
          description="Clients can message you once they have a consultation booked or a filing registered."
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper variant="outlined">
              <List disablePadding>
                {query.data.items.map((thread) => (
                  <ListItemButton
                    key={thread.id}
                    selected={thread.id === selectedId}
                    onClick={() => setSelectedId(thread.id)}
                    sx={{ display: 'block', py: 1.75 }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="body2" fontWeight={thread.unread > 0 ? 700 : 500} noWrap>
                        {thread.userName ?? thread.userEmail}
                      </Typography>
                      {thread.unread > 0 && <Badge color="primary" badgeContent={thread.unread} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {thread.subject}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <StatusChip
                        status={thread.status === 'AWAITING_ADMIN' ? 'INFO_REQUESTED' : 'COMPLETED'}
                        label={STATUS_LABEL[thread.status] ?? thread.status}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {formatRelative(thread.lastMessageAt)}
                      </Typography>
                    </Stack>
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            {selectedId ? (
              <AdminThreadPanel threadId={selectedId} />
            ) : (
              <EmptyState title="Pick a conversation" />
            )}
          </Grid>
        </Grid>
      )}
    </>
  );
}

function AdminThreadPanel({ threadId }: { threadId: string }): React.ReactElement {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const query = useQuery({
    queryKey: keys.admin.thread(threadId),
    queryFn: () => endpoints.admin.thread(threadId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.admin.thread(threadId) });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'threads'] });
    await queryClient.invalidateQueries({ queryKey: keys.admin.dashboard });
  };

  const replyMutation = useMutation({
    mutationFn: () => endpoints.admin.replyToThread(threadId, body),
    onSuccess: async () => {
      setBody('');
      await invalidate();
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => endpoints.admin.closeThread(threadId),
    onSuccess: invalidate,
  });

  if (query.isPending) return <LoadingRows count={2} />;
  if (query.isError) return <ErrorState error={query.error} />;

  const thread = query.data;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h3">{thread.subject}</Typography>
            <Typography variant="caption" color="text.secondary">
              {thread.userName ?? thread.userEmail} · {thread.userEmail}
            </Typography>
          </Box>
          {thread.status !== 'CLOSED' && (
            <Button size="small" onClick={() => closeMutation.mutate()}>
              Close thread
            </Button>
          )}
        </Stack>

        <Divider />

        <Stack spacing={2} sx={{ my: 2, maxHeight: 420, overflowY: 'auto' }}>
          {thread.messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                alignSelf: message.senderRole === 'ADMIN' ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                bgcolor: message.senderRole === 'ADMIN' ? 'primary.main' : 'grey.100',
                color: message.senderRole === 'ADMIN' ? 'primary.contrastText' : 'text.primary',
                px: 2,
                py: 1.25,
                borderRadius: 2,
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.body}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                {message.senderRole === 'ADMIN' ? 'You' : thread.userName ?? 'Client'} ·{' '}
                {formatRelative(message.createdAt)}
              </Typography>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.5}>
          <TextField
            placeholder="Write a reply…"
            multiline
            minRows={3}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, 5000))}
            fullWidth
          />
          {replyMutation.isError && <ErrorState error={replyMutation.error} />}
          <Button
            variant="contained"
            disabled={!body.trim() || replyMutation.isPending}
            onClick={() => replyMutation.mutate()}
            sx={{ alignSelf: 'flex-start' }}
          >
            Send reply
          </Button>
          {/* Closing a thread does not silence it — a new message reopens it. */}
          <Typography variant="caption" color="text.secondary">
            Closing a thread tidies your inbox; if the client writes again it reopens.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
