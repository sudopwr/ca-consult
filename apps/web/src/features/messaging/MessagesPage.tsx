import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Badge from '@mui/material/Badge';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatDateTime, formatRelative } from '../../shared/format';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '../../shared/ui';

export function MessagesPage(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const threadsQuery = useQuery({ queryKey: keys.myThreads, queryFn: endpoints.myThreads });

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        title="Messages"
        subtitle="Direct line to the CA about your bookings and filings."
        action={
          <Button variant="contained" onClick={() => setComposing(true)}>
            New message
          </Button>
        }
      />

      {threadsQuery.isPending && <LoadingRows />}
      {threadsQuery.isError && <ErrorState error={threadsQuery.error} />}

      {threadsQuery.data?.length === 0 && (
        <EmptyState
          title="No messages yet"
          description="Ask the CA anything about a consultation you have booked or a return being prepared."
          action={
            <Button variant="contained" onClick={() => setComposing(true)}>
              Write a message
            </Button>
          }
        />
      )}

      {threadsQuery.data && threadsQuery.data.length > 0 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper variant="outlined">
              <List disablePadding>
                {threadsQuery.data.map((thread) => (
                  <ListItemButton
                    key={thread.id}
                    selected={thread.id === selectedId}
                    onClick={() => setSelectedId(thread.id)}
                    sx={{ display: 'block', py: 1.75 }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="body2" fontWeight={thread.unread > 0 ? 700 : 500} noWrap>
                        {thread.subject}
                      </Typography>
                      {thread.unread > 0 && <Badge color="primary" badgeContent={thread.unread} />}
                    </Stack>
                    {thread.lastMessagePreview && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {thread.lastMessagePreview}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatRelative(thread.lastMessageAt)}
                    </Typography>
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            {selectedId ? (
              <ThreadPanel threadId={selectedId} />
            ) : (
              <EmptyState title="Pick a conversation" description="Choose a thread on the left." />
            )}
          </Grid>
        </Grid>
      )}

      <ComposeDialog open={composing} onClose={() => setComposing(false)} onSent={setSelectedId} />
    </Container>
  );
}

function ThreadPanel({ threadId }: { threadId: string }): React.ReactElement {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const query = useQuery({
    queryKey: keys.thread(threadId),
    queryFn: () => endpoints.thread(threadId),
    // Someone waiting on the CA will leave this open; a slow poll keeps it
    // fresh without a websocket.
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () => endpoints.postMessage(threadId, body),
    onSuccess: async () => {
      setBody('');
      await queryClient.invalidateQueries({ queryKey: keys.thread(threadId) });
      await queryClient.invalidateQueries({ queryKey: keys.myThreads });
    },
  });

  if (query.isPending) return <LoadingRows count={2} />;
  if (query.isError) return <ErrorState error={query.error} />;

  const thread = query.data;

  return (
    <Card>
      <CardContent>
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="h3">{thread.subject}</Typography>
          <Typography variant="caption" color="text.secondary">
            Started {formatDateTime(thread.createdAt)}
          </Typography>
        </Stack>

        <Divider />

        <Stack spacing={2} sx={{ my: 2, maxHeight: 420, overflowY: 'auto' }}>
          {thread.messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                alignSelf: message.senderRole === 'USER' ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                bgcolor: message.senderRole === 'USER' ? 'primary.main' : 'grey.100',
                color: message.senderRole === 'USER' ? 'primary.contrastText' : 'text.primary',
                px: 2,
                py: 1.25,
                borderRadius: 2,
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.body}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                {message.senderRole === 'USER' ? 'You' : 'Your CA'} ·{' '}
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
            minRows={2}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, 5000))}
            fullWidth
          />
          {mutation.isError && <ErrorState error={mutation.error} />}
          <Button
            variant="contained"
            disabled={!body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            sx={{ alignSelf: 'flex-start' }}
          >
            Send
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function ComposeDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (id: string) => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: () => endpoints.startThread({ subject, body }),
    onSuccess: async (thread) => {
      setSubject('');
      setBody('');
      onSent(thread.id);
      onClose();
      await queryClient.invalidateQueries({ queryKey: keys.myThreads });
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New message</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value.slice(0, 200))}
            fullWidth
            autoFocus
          />
          <TextField
            label="Message"
            multiline
            minRows={4}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, 5000))}
            fullWidth
          />
          {mutation.isError && <ErrorState error={mutation.error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={subject.trim().length < 3 || !body.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
