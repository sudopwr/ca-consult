import { useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from '../shared/theme';
import { AuthProvider } from '../shared/auth/AuthProvider';
import { ApiError } from '../shared/api/client';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying a 4xx just delays the error the user needs to see. Only
        // network and server failures are worth a second attempt.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.httpStatus >= 400 && error.httpStatus < 500) {
            return false;
          }
          return failureCount < 2;
        },
        // Slot availability goes stale while someone reads the page.
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}): React.ReactElement {
  // Held in state so tests can inject their own, and so each mount gets a
  // fresh cache rather than leaking results between test cases.
  const [client] = useState(() => queryClient ?? makeQueryClient());

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
