import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatDateTime, todayLocal } from '../../shared/format';
import { ErrorState, Loading, PageHeader } from '../../shared/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface RuleDraft {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
}

const BLANK_RULE: RuleDraft = {
  dayOfWeek: 1,
  startTime: '10:00',
  endTime: '13:00',
  slotMinutes: 30,
  bufferMinutes: 5,
  isActive: true,
};

export function AdminSchedulePage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [blockDate, setBlockDate] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ reference: string; startsAt: string; userName: string | null }>>([]);

  const rulesQuery = useQuery({ queryKey: keys.admin.rules, queryFn: endpoints.admin.rules });
  const exceptionsQuery = useQuery({
    queryKey: keys.admin.exceptions,
    queryFn: endpoints.admin.exceptions,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.admin.rules });
    await queryClient.invalidateQueries({ queryKey: keys.admin.exceptions });
    await queryClient.invalidateQueries({ queryKey: ['public', 'availability'] });
  };

  const saveRule = useMutation({
    mutationFn: (draft: RuleDraft) => {
      const payload = {
        dayOfWeek: draft.dayOfWeek,
        startTime: draft.startTime,
        endTime: draft.endTime,
        slotMinutes: draft.slotMinutes,
        bufferMinutes: draft.bufferMinutes,
        isActive: draft.isActive,
      };
      return draft.id
        ? endpoints.admin.updateRule(draft.id, payload)
        : endpoints.admin.createRule(payload);
    },
    onSuccess: async () => {
      setRuleDraft(null);
      await refresh();
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => endpoints.admin.deleteRule(id),
    onSuccess: refresh,
  });

  const blockDay = useMutation({
    mutationFn: (date: string) =>
      endpoints.admin.createException({
        kind: 'BLOCKED',
        onDate: date,
        startTime: null,
        endTime: null,
        reason: 'Unavailable',
      }),
    onSuccess: async (result) => {
      // Blocking a day with bookings on it is allowed — the CA is usually
      // blocking it *because* something came up — but they are handed the
      // appointments just orphaned so they can deal with them deliberately.
      setConflicts(result.conflicts ?? []);
      setBlockDate(null);
      await refresh();
    },
  });

  const deleteException = useMutation({
    mutationFn: (id: string) => endpoints.admin.deleteException(id),
    onSuccess: refresh,
  });

  if (rulesQuery.isPending) return <Loading />;
  if (rulesQuery.isError) return <ErrorState error={rulesQuery.error} />;

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Your weekly hours, and any days off."
        action={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => setBlockDate(todayLocal())}>
              Block a day
            </Button>
            <Button variant="contained" onClick={() => setRuleDraft(BLANK_RULE)}>
              Add hours
            </Button>
          </Stack>
        }
      />

      {conflicts.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setConflicts([])}>
          <AlertTitle>That day had {conflicts.length} booking(s)</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Blocking the day does not cancel them. Cancel or move each one so the client is told.
          </Typography>
          <Stack spacing={0.5}>
            {conflicts.map((conflict) => (
              <Typography key={conflict.reference} variant="body2">
                {conflict.reference} · {conflict.userName ?? 'client'} ·{' '}
                {formatDateTime(conflict.startsAt)}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="h3" gutterBottom>
            Weekly hours
          </Typography>

          <Stack spacing={1.5}>
            {DAYS.map((dayName, dayIndex) => {
              const dayRules = rulesQuery.data.filter((rule) => rule.dayOfWeek === dayIndex);

              return (
                <Card key={dayName} variant="outlined">
                  <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <Typography variant="body2" fontWeight={600} sx={{ minWidth: 88 }}>
                        {dayName}
                      </Typography>

                      {dayRules.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          Closed
                        </Typography>
                      ) : (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {dayRules.map((rule) => (
                            <Chip
                              key={rule.id}
                              label={`${rule.startTime}–${rule.endTime} · ${rule.slotMinutes}m${rule.bufferMinutes ? ` +${rule.bufferMinutes}` : ''}`}
                              variant={rule.isActive ? 'filled' : 'outlined'}
                              onClick={() =>
                                setRuleDraft({
                                  id: rule.id,
                                  dayOfWeek: rule.dayOfWeek,
                                  startTime: rule.startTime,
                                  endTime: rule.endTime,
                                  slotMinutes: rule.slotMinutes,
                                  bufferMinutes: rule.bufferMinutes,
                                  isActive: rule.isActive,
                                })
                              }
                              onDelete={() => deleteRule.mutate(rule.id)}
                            />
                          ))}
                        </Stack>
                      )}

                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        onClick={() => setRuleDraft({ ...BLANK_RULE, dayOfWeek: dayIndex })}
                      >
                        Add
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>

          <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
            The gap after each slot matters: everyone joins the same meeting room, so without one
            a client can walk into the previous consultation.
          </Alert>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Typography variant="h3" gutterBottom>
            Days off
          </Typography>

          {exceptionsQuery.data?.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nothing blocked ahead.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {exceptionsQuery.data?.map((exception) => (
                <Card key={exception.id} variant="outlined">
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {exception.onDate}
                          {exception.startTime && ` · ${exception.startTime}–${exception.endTime}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {exception.kind === 'BLOCKED' ? 'Blocked' : 'Extra opening'}
                          {exception.reason && ` · ${exception.reason}`}
                        </Typography>
                      </Box>
                      <Button size="small" onClick={() => deleteException.mutate(exception.id)}>
                        Remove
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Grid>
      </Grid>

      {/* ── rule dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!ruleDraft} onClose={() => setRuleDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{ruleDraft?.id ? 'Edit hours' : 'Add hours'}</DialogTitle>
        <DialogContent>
          {ruleDraft && (
            <Grid container spacing={2} sx={{ pt: 1 }}>
              <Grid size={12}>
                <TextField
                  select
                  label="Day"
                  value={ruleDraft.dayOfWeek}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, dayOfWeek: Number(event.target.value) })
                  }
                  fullWidth
                >
                  {DAYS.map((day, index) => (
                    <MenuItem key={day} value={index}>
                      {day}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={6}>
                <TextField
                  label="From"
                  type="time"
                  value={ruleDraft.startTime}
                  onChange={(event) => setRuleDraft({ ...ruleDraft, startTime: event.target.value })}
                  fullWidth
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="To"
                  type="time"
                  value={ruleDraft.endTime}
                  onChange={(event) => setRuleDraft({ ...ruleDraft, endTime: event.target.value })}
                  fullWidth
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Slot length (min)"
                  type="number"
                  value={ruleDraft.slotMinutes}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, slotMinutes: Number(event.target.value) })
                  }
                  fullWidth
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Gap after (min)"
                  type="number"
                  value={ruleDraft.bufferMinutes}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, bufferMinutes: Number(event.target.value) })
                  }
                  helperText="5–10 recommended"
                  fullWidth
                />
              </Grid>
              {saveRule.isError && (
                <Grid size={12}>
                  <ErrorState error={saveRule.error} />
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDraft(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saveRule.isPending}
            onClick={() => ruleDraft && saveRule.mutate(ruleDraft)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── block a day ────────────────────────────────────────────────── */}
      <Dialog open={!!blockDate} onClose={() => setBlockDate(null)} fullWidth maxWidth="xs">
        <DialogTitle>Block a day</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Date"
              type="date"
              value={blockDate ?? ''}
              onChange={(event) => setBlockDate(event.target.value)}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              Existing bookings on that day are not cancelled — you will be shown which ones need
              attention.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBlockDate(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!blockDate || blockDay.isPending}
            onClick={() => blockDate && blockDay.mutate(blockDate)}
          >
            Block it
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
