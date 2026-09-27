import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ItrEngagement } from '@ca/contracts';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatMoney } from '../../shared/format';
import { ErrorState, Loading, PageHeader } from '../../shared/ui';

export function ItrRegistrationPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [serviceId, setServiceId] = useState(searchParams.get('service') ?? '');
  const [hasBusinessIncome, setHasBusinessIncome] = useState(false);
  const [notes, setNotes] = useState('');
  const [registered, setRegistered] = useState<ItrEngagement | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const servicesQuery = useQuery({
    queryKey: keys.publicServices('ITR_FILING'),
    queryFn: () => endpoints.publicServices('ITR_FILING'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      endpoints.registerItr(
        { serviceId, hasBusinessIncome, notes: notes.trim() || null },
        idempotencyKey,
      ),
    onSuccess: async (engagement) => {
      setRegistered(engagement);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const service = servicesQuery.data?.find((s) => s.id === serviceId) ?? null;

  if (registered) {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Stack spacing={2.5}>
              <Typography variant="h2" component="h1">
                We have your filing request
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The CA will review it and come back to you — usually within two working days —
                with anything else that is needed. You will get an email at each step.
              </Typography>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="body2">
                  <strong>{registered.serviceName}</strong> · {registered.assessmentYear}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Reference {registered.reference}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatMoney(registered.amountPaise)}
                </Typography>
              </Stack>

              <Alert severity="info" variant="outlined">
                Do not send documents or your PAN yet — the CA will ask for exactly what is
                needed, and you can reply in your account.
              </Alert>

              <Button component={RouterLink} to="/me" variant="contained">
                Track this filing
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        title="Register an ITR filing"
        subtitle="Tell us which return you need. The CA takes it from there."
      />

      {servicesQuery.isPending && <Loading />}
      {servicesQuery.isError && <ErrorState error={servicesQuery.error} />}

      {servicesQuery.data && (
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Typography variant="h3">Which return?</Typography>
            <Typography variant="body2" color="text.secondary">
              Not sure which form applies to you? Pick the closest and the CA will correct it —
              or book a consultation first.
            </Typography>

            {servicesQuery.data.map((option) => (
              <Card
                key={option.id}
                variant={option.id === serviceId ? 'elevation' : 'outlined'}
                sx={{
                  borderColor: option.id === serviceId ? 'primary.main' : undefined,
                  borderWidth: option.id === serviceId ? 2 : 1,
                }}
              >
                <CardActionArea onClick={() => setServiceId(option.id)} sx={{ p: 2 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    spacing={1.5}
                  >
                    <Stack spacing={0.75}>
                      <Stack direction="row" spacing={1}>
                        <Chip size="small" label={option.itrFormType} />
                        <Chip size="small" variant="outlined" label={option.assessmentYear} />
                      </Stack>
                      <Typography variant="body1" fontWeight={600}>
                        {option.name}
                      </Typography>
                      {option.description && (
                        <Typography variant="body2" color="text.secondary">
                          {option.description}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="h3" color="primary.main">
                      {formatMoney(option.amountPaise)}
                    </Typography>
                  </Stack>
                </CardActionArea>
              </Card>
            ))}
          </Stack>

          {service && (
            <>
              <Divider />
              <Card>
                <CardContent>
                  <Stack spacing={2.5}>
                    <Typography variant="h3">A couple of questions</Typography>

                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={hasBusinessIncome}
                          onChange={(event) => setHasBusinessIncome(event.target.checked)}
                        />
                      }
                      label="I have income from a business or profession"
                    />

                    <TextField
                      label="Anything else the CA should know?"
                      placeholder="Optional — sold property, changed jobs, foreign income, and so on"
                      multiline
                      minRows={3}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
                      fullWidth
                    />

                    {/* PAN is deliberately not asked for here. It is a
                        government identifier, and it does not belong in a form
                        that anyone can submit — the CA requests it through the
                        engagement once the filing actually needs it. */}
                    <Alert severity="info" variant="outlined">
                      No documents or PAN needed yet. Register the filing and the CA will ask for
                      exactly what is required.
                    </Alert>

                    {mutation.isError && <ErrorState error={mutation.error} />}

                    <Button
                      variant="contained"
                      size="large"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate()}
                    >
                      {mutation.isPending ? 'Registering…' : 'Register this filing'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </>
          )}
        </Stack>
      )}
    </Container>
  );
}
