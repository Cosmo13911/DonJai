import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getPublicSupabaseEnv, isSupabaseConfigured } from '../env';

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignore cookie writes when invoked from a read-only Server Component render.
        }
      },
    },
  });
}

export async function getAuthenticatedUser(): Promise<{
  user: User | null;
  configured: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { user: null, configured: false };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { user: null, configured: true };
  }
  return { user: data.user, configured: true };
}
