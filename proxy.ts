import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { getPublicSupabaseEnv, isSupabaseConfigured } from './lib/env';

export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  const hasSupabaseCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-'));
  if (!hasSupabaseCookie) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  try {
    const { url, anonKey } = getPublicSupabaseEnv();

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    await supabase.auth.getUser();
  } catch (error) {
    console.error('Supabase session refresh failed in proxy:', error);
    return NextResponse.next();
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2)$).*)',
  ],
};
