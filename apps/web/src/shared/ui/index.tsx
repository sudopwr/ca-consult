import type { ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ApiError } from '../api/client';
import { statusColour } from '../format';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box>
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}

export function Loading({ label }: { label?: string }): React.ReactElement {
  return (
    <Stack alignItems="center" spacing={2} sx={{ py: 6 }}>
      <CircularProgress size={28} />
      {label && (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      )}
    </Stack>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }): React.ReactElement {
  return (
    <Stack spacing={1.5}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={72} />
      ))}
    </Stack>
  );
}

/**
 * One place that turns an ApiError into something a person can act on.
 *
 * The API's `detail` is written for humans — the NO_ENGAGEMENT refusal, for
 * instance, explains what to do instead — so it is shown rather than
 * swallowed in favour of a generic message.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.ReactElement {
  const apiError = error instanceof ApiError ? error : null;
  const title = apiError?.problem.title ?? 'Something went wrong';
  const detail =
    apiError?.detail ??
    (error instanceof Error ? error.message : 'Please try again in a moment.');

  return (
    <Alert
      severity={apiError?.httpStatus === 404 ? 'info' : 'error'}
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {detail}
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 5, textAlign: 'center', borderStyle: 'dashed', bgcolor: 'transparent' }}
    >
      <Typography variant="h3" gutterBottom>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '44ch', mx: 'auto' }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 3 }}>{action}</Box>}
    </Paper>
  );
}

export function StatusChip({
  status,
  label,
  size = 'small',
}: {
  status: string;
  label: string;
  size?: 'small' | 'medium';
}): React.ReactElement {
  return <Chip size={size} label={label} color={statusColour(status)} variant="filled" />;
}
