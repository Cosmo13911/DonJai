import { NextResponse } from 'next/server';
import { getSiteUrl } from '../../../lib/env';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

function safeNextPath(nextParam: string | null): string {
  if (!nextParam) return '/?view=dashboard';
  if (!nextParam.startsWith('/') || nextParam.startsWith('//') || nextParam.includes('\\')) {
    return '/?view=dashboard';
  }
  return nextParam;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextPath = safeNextPath(url.searchParams.get('next'));
  const baseUrl = getSiteUrl(url.origin);

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return NextResponse.redirect(
          new URL(`/?view=login&authError=${encodeURIComponent(error.message)}`, baseUrl)
        );
      }
    }
  }

  return NextResponse.redirect(new URL(nextPath, baseUrl));
}
