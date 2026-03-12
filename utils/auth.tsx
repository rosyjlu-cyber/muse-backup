import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Profile, getMyProfile } from './api';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  reloadSession: (sess?: Session | null) => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  reloadSession: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    const p = await getMyProfile();
    setProfile(p);
  };

  // Call this after sign-in to force-sync state without relying on onAuthStateChange.
  // Pass the session directly (from signInWithPassword response) to avoid getSession() timing issues on mobile.
  const reloadSession = async (sess?: Session | null) => {
    const resolvedSession = sess !== undefined
      ? sess
      : (await supabase.auth.getSession()).data.session;
    setSession(resolvedSession);
    if (resolvedSession) {
      try {
        const p = await getMyProfile();
        setProfile(p);
      } catch {
        // Profile fetch failed — session is still valid, AuthGate will navigate
      }
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        getMyProfile().then(p => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        getMyProfile().then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile, reloadSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
