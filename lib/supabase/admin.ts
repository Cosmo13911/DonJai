import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicSupabaseEnv, getServiceRoleKey, isServerSupabaseConfigured } from '../env';

let adminClient: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!isServerSupabaseConfigured()) {
    return null;
  }
  if (!adminClient) {
    const { url } = getPublicSupabaseEnv();
    const serviceRoleKey = getServiceRoleKey();
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return adminClient;
}
