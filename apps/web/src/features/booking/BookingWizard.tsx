import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { Appointment, Service } from '@ca/contracts';
import { ApiError } from '../../shared/api/client';
import { endpoints, keys } from '../../shared/api/endpoints';
import { addDaysIso, formatDateTime, formatDayLabel, formatMoney, formatTime, todayLocal } from '../../shared/format';
import { EmptyState, ErrorState, Loading, PageHeader } from '../../shared/ui';
import { BookingConfirmation } from './BookingConfirmation';

/**
 * Three steps, not five. Video-only removed the mode question and auto-confirm
 * removed the "awaiting approval" screen, so what is left is: what, when,
 * confirm.
 */
const STEPS = ['Choose a service', 'Pick a time', 'Confirm'];

const WINDOW_DAYS = 27;

export function BookingWizard(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [serviceId, setServiceId] = useState(searchParams.get('service') ?? '');
  const [rangeStart, setRangeStart] = useState(todayLocal());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [booked, setBooked] = useState<Appointment | null>(null);

  // One key per attempt, so a retry after a dropped response returns the
  // original booking instead of creating a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const servicesQuery = useQuery({
    queryKey: keys.publicServices('CONSULTANCY'),
    queryFn: () => endpoints.publicServices('CONSULTANCY'),
  });

  const rangeEnd = addDaysIso(rangeStart, WINDOW_DAYS);

  const availabilityQuery = useQuery({
    queryKey: keys.availability(serviceId, rangeStart, rangeEnd),
    queryFn: () => endpoints.availability(serviceId, rangeStart, rangeEnd),
    enabled: !!serviceId,
    // Slots go stale while someone reads the page, so refetch when they come
    // back to the tab.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const bookMutation = useMutation({
    mutationFn: () =>
      endpoints.bookAppointment(
        { serviceId, startsAt: selectedSlot, notes: notes.trim() || null },
        idempotencyKey,
      ),
    onSuccess: async (appointment) => {
      setBooked(appointment);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: async (error) => {
      // The race we designed for: someone else committed this slot between the
      // page loading and the click. Refetch so the grid updates under them.
      if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
        setSelectedSlot(null);
        await queryClient.invalidateQueries({
          queryKey: keys.availability(serviceId, rangeStart, rangeEnd),
        });
      }
    },
  });

  const service = servicesQuery.data?.find((s) => s.id === serviceId) ?? null;

  const daysWithSlots = useMemo(
    () => (availabilityQuery.data?.days ?? []).filter((day) => day.slots.length > 0),
    [availabilityQuery.data],
  );

  const activeStep = booked ? 3 : !serviceId ? 0 : !selectedSlot ? 1 : 2;

  if (booked) return <BookingConfirmation appointment={booked} />;

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        title="Book a consultation"
        subtitle="By video call. Your slot is confirmed as soon as you book."
      />

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── 1. service ──────────────────────────────────────────────────── */}
      {servicesQuery.isPending && <Loading label="Loading services" />}
      {servicesQuery.isError && <ErrorState error={servicesQuery.error} />}

      {servicesQuery.data && (
        <Stack spacing={2} sx={{ mb: 4 }}>
          <Typography variant="h3">Which consultation?</Typography>
          <Stack spacing={1.5}>
            {servicesQuery.data.map((option) => (
              <ServiceOption
                key={option.id}
                service={option}
                selected={option.id === serviceId}
                onSelect={() => {
                  setServiceId(option.id);
                  setSelectedSlot(null);
                  setSelectedDate(null);
                }}
              />
            ))}
          </Stack>
        </Stack>
      )}

      {/* ── 2. date and slot ────────────────────────────────────────────── */}
      {serviceId && (
        <>
          <Divider sx={{ my: 3 }} />
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h3">Pick a time</Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  disabled={rangeStart === todayLocal()}
                  onClick={() => {
                    setRangeStart(
                      addDaysIso(rangeStart, -(WINDOW_DAYS + 1)) < todayLocal()
                        ? todayLocal()
                        : addDaysIso(rangeStart, -(WINDOW_DAYS + 1)),
                    );
                    setSelectedDate(null);
                  }}
                >
                  Earlier
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setRangeStart(addDaysIso(rangeStart, WINDOW_DAYS + 1));
                    setSelectedDate(null);
                  }}
                >
                  Later
                </Button>
              </Stack>
            </Stack>

            {availabilityQuery.isPending && <Loading label="Finding available times" />}
            {availabilityQuery.isError && <ErrorState error={availabilityQuery.error} />}

            {availabilityQuery.data && daysWithSlots.length === 0 && (
              <EmptyState
                title="Nothing free in this period"
                description="Try looking a little further ahead, or send a message and the CA will find a time."
                action={
                  <Button component={RouterLink} to="/contact" variant="outlined">
                    Get in touch
                  </Button>
                }
              />
            )}

            {daysWithSlots.length > 0 && (
              <>
                <ToggleButtonGroup
                  exclusive
                  value={selectedDate}
                  onChange={(_event, value: string | null) => {
                    setSelectedDate(value);
                    setSelectedSlot(null);
                  }}
                  sx={{ flexWrap: 'wrap', gap: 1, '& .MuiToggleButtonGroup-grouped': { border: 1, borderRadius: 2 } }}
                >
                  {daysWithSlots.map((day) => (
                    <ToggleButton key={day.date} value={day.date} sx={{ px: 2, py: 1 }}>
                      <Stack alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {formatDayLabel(day.date)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {day.slots.length} free
                        </Typography>
                      </Stack>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                {selectedDate && (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Times shown in {availabilityQuery.data.timezone.replace('_', ' ')}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {daysWithSlots
                        .find((day) => day.date === selectedDate)
                        ?.slots.map((slot) => (
                          <Button
                            key={slot.startsAt}
                            variant={selectedSlot === slot.startsAt ? 'contained' : 'outlined'}
                            onClick={() => setSelectedSlot(slot.startsAt)}
                          >
                            {formatTime(slot.startsAt, availabilityQuery.data.timezone)}
                          </Button>
                        ))}
                    </Stack>
                  </Box>
                )}
              </>
            )}
          </Stack>
        </>
      )}

      {/* ── 3. confirm ──────────────────────────────────────────────────── */}
      {selectedSlot && service && (
        <>
          <Divider sx={{ my: 3 }} />
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h3">Confirm your booking</Typography>

                <Stack spacing={0.5}>
                  <Typography variant="body1" fontWeight={600}>
                    {service.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDateTime(selectedSlot, availabilityQuery.data?.timezone)} ·{' '}
                    {service.durationMinutes} minutes · video call
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatMoney(service.amountPaise)}, payable at the consultation
                  </Typography>
                </Stack>

                <TextField
                  label="Anything the CA should know beforehand?"
                  placeholder="Optional — a sentence about what you would like to cover"
                  multiline
                  minRows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
                  fullWidth
                />

                {bookMutation.isError && (
                  <ErrorState error={bookMutation.error} />
                )}

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="contained"
                    size="large"
                    disabled={bookMutation.isPending}
                    onClick={() => bookMutation.mutate()}
                  >
                    {bookMutation.isPending ? 'Booking…' : 'Confirm booking'}
                  </Button>
                  <Button variant="text" onClick={() => setSelectedSlot(null)}>
                    Pick another time
                  </Button>
                </Stack>

                <Alert severity="info" variant="outlined">
                  You can cancel or move this up to 12 hours before it starts.
                </Alert>
              </Stack>
            </CardContent>
          </Card>
        </>
      )}

      <Box sx={{ mt: 4 }}>
        <Button variant="text" onClick={() => navigate('/')}>
          Back to the practice page
        </Button>
      </Box>
    </Container>
  );
}

function ServiceOption({
  service,
  selected,
  onSelect,
}: {
  service: Service;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <Card variant={selected ? 'elevation' : 'outlined'} sx={{ borderColor: selected ? 'primary.main' : undefined, borderWidth: selected ? 2 : 1 }}>
      <CardActionArea onClick={onSelect} sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
          <Box>
            <Typography variant="body1" fontWeight={600}>
              {service.name}
            </Typography>
            {service.description && (
              <Typography variant="body2" color="text.secondary">
                {service.description}
              </Typography>
            )}
          </Box>
          <Stack alignItems="flex-end">
            <Typography variant="body1" fontWeight={600} color="primary.main">
              {formatMoney(service.amountPaise)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {service.durationMinutes} min
            </Typography>
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
