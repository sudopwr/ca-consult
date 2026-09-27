import { createTheme } from '@mui/material/styles';

/**
 * The Minimal UI kit's theme, re-pointed at a palette suited to a CA practice.
 *
 * The kit ships a violet primary that reads as a SaaS startup. A tax practice
 * is selling care and precision, so: deep navy primary, a restrained teal for
 * confirmations, generous radii, and no shadow theatrics.
 *
 * Slice 3 replaces this file with the kit's full theme folder (palette,
 * typography, shadows, component overrides) with these values layered on top.
 */
export const theme = createTheme({
  palette: {
    primary: {
      main: '#1B2A4A',
      light: '#33456B',
      dark: '#101A2F',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#0F7B6C',
      contrastText: '#FFFFFF',
    },
    success: { main: '#118D57' },
    warning: { main: '#B76E00' },
    error: { main: '#B71D18' },
    background: {
      default: '#F7F8FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1B2A4A',
      secondary: '#5A6478',
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: ['"Public Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'].join(
      ',',
    ),
    h1: { fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.25rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { paddingInline: 20, paddingBlock: 10 } },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: '1px solid rgba(27, 42, 74, 0.08)', boxShadow: 'none' },
      },
    },
  },
});
