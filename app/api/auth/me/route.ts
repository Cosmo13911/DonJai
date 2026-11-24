import { createSupabaseServerClient, getAuthenticatedUser } from '../../../../lib/supabase/server';
import { jsonNoStore } from '../../../../lib/server/http';

export async function GET() {
  const { user, configured } = await getAuthenticatedUser();
  if (!configured || !user) {
    return jsonNoStore({ authConfigured: configured, user: null });
  }

  let displayName =
    String(
      user.user_metadata?.display_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        ''
    ).trim() ||
    user.email?.split('@')[0] ||
    'ผู้สร้างของขวัญ';
  let avatarUrl = String(
    user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
  ).trim();

  try {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.display_name) displayName = profile.display_name;
      if (profile?.avatar_url) avatarUrl = profile.avatar_url;
    }
  } catch {
    // Fallback to auth metadata when profiles query isn't available yet.
  }

  return jsonNoStore({
    authConfigured: true,
    user: {
      id: user.id,
      email: user.email || '',
      displayName,
      avatarUrl,
    },
  });
}
