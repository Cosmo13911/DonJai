import { isServerSupabaseConfigured, isSupabaseConfigured } from '../../../lib/env';
import { jsonNoStore } from '../../../lib/server/http';

export async function GET() {
  const authConfigured = isSupabaseConfigured();
  const storage = isServerSupabaseConfigured();
  return jsonNoStore({
    ok: true,
    authConfigured,
    storage,
    mode: storage ? 'supabase' : 'local-demo',
  });
}
