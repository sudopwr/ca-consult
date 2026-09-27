import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useAuth } from '../shared/auth/AuthProvider';

export function PublicLayout(): React.ReactElement {
  const { isAuthenticated, isAdmin, canMessage, me, signIn, signOut } = useAuth();
  const location = useLocation();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: 2 }}>
            <Typography
              component={RouterLink}
              to="/"
              variant="h3"
              sx={{ textDecoration: 'none', color: 'primary.main', mr: 2 }}
            >
              CA Consult
            </Typography>

            <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', md: 'flex' } }}>
              <Button component={RouterLink} to="/book" color="inherit">
                Book
              </Button>
              <Button component={RouterLink} to="/itr" color="inherit">
                File a return
              </Button>
              <Button component={RouterLink} to="/contact" color="inherit">
                Contact
              </Button>
            </Stack>

            <Box sx={{ flex: 1 }} />

            {isAuthenticated ? (
              <Stack direction="row" spacing={1} alignItems="center">
                {/* The message link only appears for clients with an
                    engagement — the guard would redirect anyone else, and
                    offering a link that bounces is worse than not offering it. */}
                {canMessage && (
                  <Button component={RouterLink} to="/messages" color="inherit">
                    <Badge color="primary" badgeContent={me?.unreadMessages ?? 0}>
                      Messages
                    </Badge>
                  </Button>
                )}
                <Button component={RouterLink} to="/me" color="inherit">
                  My engagements
                </Button>
                {isAdmin && (
                  <Button component={RouterLink} to="/admin" variant="outlined" size="small">
                    Admin
                  </Button>
                )}
                <Button onClick={() => void signOut()} color="inherit" size="small">
                  Sign out
                </Button>
              </Stack>
            ) : (
              <Button
                onClick={() => void signIn()}
                variant="contained"
                size="small"
                data-testid="sign-in"
              >
                Sign in with Google
              </Button>
            )}
          </Toolbar>
        </Container>
      </AppBar>

      <Box component="main" sx={{ flex: 1 }} key={location.pathname}>
        <Outlet />
      </Box>

      <Divider />
      <Box component="footer" sx={{ py: 3 }}>
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            spacing={1}
          >
            <Typography variant="caption" color="text.secondary">
              © {new Date().getFullYear()} CA Consult
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Consultations by video call · Times shown in IST
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
