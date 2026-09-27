import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { endpoints, keys } from '../../shared/api/endpoints';
import { formatMoney } from '../../shared/format';
import { ErrorState, Loading } from '../../shared/ui';

export function LandingPage(): React.ReactElement {
  const profileQuery = useQuery({ queryKey: keys.publicProfile, queryFn: endpoints.publicCaProfile });
  const servicesQuery = useQuery({
    queryKey: keys.publicServices(),
    queryFn: () => endpoints.publicServices(),
  });

  if (profileQuery.isPending) return <Loading />;
  if (profileQuery.isError) return <ErrorState error={profileQuery.error} />;

  const profile = profileQuery.data;
  const consultations = servicesQuery.data?.filter((s) => s.kind === 'CONSULTANCY') ?? [];
  const filings = servicesQuery.data?.filter((s) => s.kind === 'ITR_FILING') ?? [];

  return (
    <Box component="main">
      {/* Hero */}
      <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', py: { xs: 6, md: 10 } }}>
        <Container maxWidth="lg">
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack spacing={2.5} alignItems="flex-start">
                {profile.headline && (
                  <Chip
                    label={profile.headline}
                    sx={{ bgcolor: 'rgba(255,255,255,.14)', color: 'inherit' }}
                  />
                )}
                <Typography variant="h1" component="h1">
                  {profile.fullName}
                </Typography>
                {profile.bio && (
                  <Typography sx={{ opacity: 0.85, maxWidth: '56ch', fontSize: '1.05rem' }}>
                    {profile.bio}
                  </Typography>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 1 }}>
                  <Button
                    component={RouterLink}
                    to="/book"
                    variant="contained"
                    size="large"
                    sx={{ bgcolor: 'common.white', color: 'primary.main', '&:hover': { bgcolor: 'grey.200' } }}
                  >
                    Book a consultation
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/itr"
                    variant="outlined"
                    size="large"
                    sx={{ borderColor: 'rgba(255,255,255,.4)', color: 'inherit' }}
                  >
                    Register an ITR filing
                  </Button>
                </Stack>

                {/* Auto-confirm is the single most reassuring thing about this
                    practice's booking flow, so it belongs above the fold. */}
                <Typography variant="caption" sx={{ opacity: 0.75 }}>
                  Consultations are by video call and confirmed instantly — you get a join link
                  straight away.
                </Typography>
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <Card sx={{ bgcolor: 'rgba(255,255,255,.08)', border: 'none' }}>
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                    <Avatar
                      src={profile.photoUrl ?? undefined}
                      sx={{ width: 64, height: 64, bgcolor: 'rgba(255,255,255,.2)' }}
                    >
                      {profile.fullName.charAt(0)}
                    </Avatar>
                    <Box sx={{ color: 'primary.contrastText' }}>
                      <Typography variant="h3">{profile.firmName ?? profile.fullName}</Typography>
                      {profile.membershipNumber && (
                        <Typography variant="caption" sx={{ opacity: 0.8 }}>
                          ICAI membership {profile.membershipNumber}
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Divider sx={{ borderColor: 'rgba(255,255,255,.15)', my: 2 }} />

                  <Stack spacing={1.5} sx={{ color: 'primary.contrastText' }}>
                    {profile.yearsExperience !== null && (
                      <DetailRow label="Experience" value={`${profile.yearsExperience} years`} />
                    )}
                    {profile.specialisations.length > 0 && (
                      <DetailRow label="Specialises in" value={profile.specialisations.join(', ')} />
                    )}
                    {profile.qualifications.length > 0 && (
                      <DetailRow label="Qualifications" value={profile.qualifications.join(', ')} />
                    )}
                    {profile.languages.length > 0 && (
                      <DetailRow label="Languages" value={profile.languages.join(', ')} />
                    )}
                    {profile.officeAddress && (
                      <DetailRow label="Office" value={profile.officeAddress} />
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Services */}
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        <Stack spacing={6}>
          <Box>
            <Typography variant="h2" gutterBottom>
              Consultations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              By video call. Pick a time and you are confirmed straight away.
            </Typography>

            <Grid container spacing={2}>
              {consultations.map((service) => (
                <Grid key={service.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card sx={{ height: '100%' }}>
                    <CardContent>
                      <Stack spacing={1.5} sx={{ height: '100%' }}>
                        <Typography variant="h3">{service.name}</Typography>
                        {service.description && (
                          <Typography variant="body2" color="text.secondary">
                            {service.description}
                          </Typography>
                        )}
                        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ pt: 1 }}>
                          <Typography variant="h3" color="primary.main">
                            {formatMoney(service.amountPaise)}
                          </Typography>
                          {service.durationMinutes && (
                            <Typography variant="caption" color="text.secondary">
                              · {service.durationMinutes} minutes
                            </Typography>
                          )}
                        </Stack>
                        <Button
                          component={RouterLink}
                          to={`/book?service=${service.id}`}
                          variant="outlined"
                          sx={{ mt: 'auto', alignSelf: 'flex-start' }}
                        >
                          Book this
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>

          <Box>
            <Typography variant="h2" gutterBottom>
              Income tax return filing
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Register a filing and the CA will review it and come back to you with anything else
              that is needed.
            </Typography>

            <Grid container spacing={2}>
              {filings.map((service) => (
                <Grid key={service.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card sx={{ height: '100%' }}>
                    <CardContent>
                      <Stack spacing={1.5}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" label={service.itrFormType} />
                          <Chip size="small" variant="outlined" label={service.assessmentYear} />
                        </Stack>
                        <Typography variant="h3">{service.name}</Typography>
                        {service.description && (
                          <Typography variant="body2" color="text.secondary">
                            {service.description}
                          </Typography>
                        )}
                        <Typography variant="h3" color="primary.main" sx={{ pt: 1 }}>
                          {formatMoney(service.amountPaise)}
                        </Typography>
                        <Button
                          component={RouterLink}
                          to={`/itr?service=${service.id}`}
                          variant="outlined"
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          Register this filing
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>

          <Divider />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
          >
            <Box>
              <Typography variant="h3" gutterBottom>
                Have a question first?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Send a message and the practice will reply by email.
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Button component={RouterLink} to="/contact" variant="outlined">
                Get in touch
              </Button>
              {profile.contactPhone && (
                <Button component={Link} href={`tel:${profile.contactPhone}`} variant="text">
                  {profile.contactPhone}
                </Button>
              )}
            </Stack>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Stack direction="row" spacing={2}>
      <Typography variant="caption" sx={{ minWidth: 110, opacity: 0.7 }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}
