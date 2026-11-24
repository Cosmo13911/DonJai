import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '../supabase/server';
import { ServiceError } from './gifts-service';

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function jsonNoStore(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: SECURITY_HEADERS });
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;

  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host && (origin === `${proto}://${host}` || origin === `http://${host}` || origin === `https://${host}`)) {
    return;
  }

  throw new ServiceError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'shared'
  );
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return jsonNoStore({ error: error.message }, error.status);
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง';
  return jsonNoStore({ error: message }, 400);
}

export async function requireCreatorUserId(): Promise<string> {
  const { user, configured } = await getAuthenticatedUser();
  if (!configured) {
    throw new ServiceError(
      'ยังไม่ได้เชื่อมต่อ Supabase (ฉบับร่างยังบันทึกในเครื่องได้)',
      503
    );
  }
  if (!user) {
    throw new ServiceError('กรุณาเข้าสู่ระบบก่อนจัดการของขวัญ', 401);
  }
  return user.id;
}
