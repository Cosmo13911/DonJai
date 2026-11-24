import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { assertSameOrigin, handleRouteError, jsonNoStore } from '../../../../lib/server/http';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    return jsonNoStore({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
