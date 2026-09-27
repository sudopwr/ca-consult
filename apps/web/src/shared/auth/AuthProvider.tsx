import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@ca/contracts';
import { supabase, signInWithGoogle, signOut } from './supabase';
import type { Session } from './supabase';
import { endpoints, keys } from '../api/endpoints';

interface AuthContextValue {
  session: Session | null;
  me: MeResponse | null;
  /** True until we know whether there is a session, to avoid a login flash. */
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  profileComplete: boolean;
  canMessage: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // A sign-out has to clear the cache, or the next user to sign in on this
      // machine sees the previous one's appointments for a frame.
      if (!next) queryClient.clear();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: keys.me,
    queryFn: endpoints.me,
    enabled: !!session,
    staleTime: 60_000,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      me: me ?? null,
      loading: sessionLoading || (!!session && meLoading),
      isAuthenticated: !!session,
      isAdmin: me?.isAdmin ?? false,
      profileComplete: me?.profileComplete ?? false,
      canMessage: me?.canMessage ?? false,
      signIn: async () => {
        await signInWithGoogle();
      },
      signOut: async () => {
        await signOut();
        queryClient.clear();
      },
      refresh,
    }),
    [session, me, sessionLoading, meLoading, queryClient, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
