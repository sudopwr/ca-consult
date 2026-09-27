import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAuth } from '../../shared/auth/AuthProvider';
import { Loading } from '../../shared/ui';

export function SignInPage(): React.ReactElement {
  const { isAuthenticated, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/me';

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  if (loading) return <Loading />;

  return (
    <Container maxWidth="xs" sx={{ py: { xs: 6, md: 10 } }}>
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Typography variant="h2" component="h1">
                Sign in
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Use your Google account. We only ask for your name and email.
              </Typography>
            </Stack>

            <Button variant="contained" size="large" onClick={() => void signIn()} fullWidth>
              Continue with Google
            </Button>

            <Typography variant="caption" color="text.secondary">
              After signing in we will ask for a phone number and address — the practice needs
              those to act for you.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

/**
 * Where Google sends the browser back to. supabase-js parses the code out of
 * the URL itself (detectSessionInUrl), so this page only has to wait for the
 * session to appear and then route on.
 */
export function AuthCallbackPage(): React.ReactElement {
  const { isAuthenticated, profileComplete, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      navigate('/sign-in', { replace: true });
      return;
    }
    navigate(profileComplete ? '/me' : '/onboarding', { replace: true });
  }, [isAuthenticated, profileComplete, loading, navigate]);

  return <Loading label="Signing you in…" />;
}
