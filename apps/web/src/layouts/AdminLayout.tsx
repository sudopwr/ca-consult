import { NavLink, Outlet, Link as RouterLink } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { useAuth } from '../shared/auth/AuthProvider';

const WIDTH = 232;

const NAV = [
  { to: '/admin', label: 'Today', end: true },
  { to: '/admin/appointments', label: 'Consultations' },
  { to: '/admin/itr', label: 'Tax filings' },
  { to: '/admin/inbox', label: 'Messages' },
  { to: '/admin/enquiries', label: 'Enquiries' },
  { to: '/admin/users', label: 'Clients' },
  { to: '/admin/schedule', label: 'Schedule' },
  { to: '/admin/services', label: 'Services' },
  { to: '/admin/profile', label: 'Practice profile' },
];

export function AdminLayout(): React.ReactElement {
  const { me, signOut } = useAuth();

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            component={RouterLink}
            to="/admin"
            variant="h3"
            sx={{ textDecoration: 'none', color: 'primary.main' }}
          >
            CA Consult
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Admin
          </Typography>

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {me?.profile.fullName ?? me?.profile.email}
            </Typography>
            <Button component={RouterLink} to="/" size="small" color="inherit">
              View site
            </Button>
            <Button onClick={() => void signOut()} size="small" color="inherit">
              Sign out
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: WIDTH,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box', borderRight: 1, borderColor: 'divider' },
        }}
      >
        <Toolbar />
        <List sx={{ px: 1, py: 2 }}>
          {NAV.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                '&.active': { bgcolor: 'primary.main', color: 'primary.contrastText' },
              }}
            >
              <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
        <Toolbar />
        <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 } }}>
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
