import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from '../shared/auth/AuthProvider';

function Loading(): React.ReactElement {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * The guard chain from the architecture doc, in the order a user meets it:
 *
 *   RequireAuth → RequireCompleteProfile → RequireEngagement
 *                                        ↘ RequireAdmin
 *
 * Each redirects rather than erroring, and each remembers where the user was
 * going so they land there after signing in or finishing onboarding.
 */
export function RequireAuth(): React.ReactElement {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

export function RequireCompleteProfile(): React.ReactElement {
  const { profileComplete, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!profileComplete) {
    return <Navigate to="/onboarding" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}

/**
 * Messaging is for clients. Someone without an engagement is sent to the
 * contact form rather than shown an error — the API's 403 carries the same
 * message, but getting there via a dead end would be worse UX than never
 * offering the link.
 */
export function RequireEngagement(): React.ReactElement {
  const { canMessage, loading } = useAuth();

  if (loading) return <Loading />;
  if (!canMessage) return <Navigate to="/contact?reason=no-engagement" replace />;
  return <Outlet />;
}

export function RequireAdmin(): React.ReactElement {
  const { isAdmin, loading } = useAuth();

  if (loading) return <Loading />;
  // A non-admin gets sent home rather than told an admin area exists.
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
