import { cookies } from 'next/headers';
import { getSessionSecret } from '../../../../lib/env';
import { UNLOCK_SESSION_TTL_SECONDS, unlockCookieName } from '../../../../lib/session';
import { createGiftService, ServiceError } from '../../../../lib/server/gifts-service';
import {
  assertSameOrigin,
  getClientIp,
  handleRouteError,
  jsonNoStore,
} from '../../../../lib/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = createGiftService();
    const cookieStore = await cookies();
    const result = await service.openGift(id, {
      unlockCookieToken: (giftId) => cookieStore.get(unlockCookieName(giftId))?.value,
      sessionSecret: getSessionSecret(),
    });
    return jsonNoStore(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const service = createGiftService();
    let body: { password?: string } = {};
    try {
      body = (await request.json()) as { password?: string };
    } catch {
      throw new ServiceError('กรุณาใส่รหัสให้ถูกต้อง', 400);
    }

    const result = await service.unlockGift(id, {
      password: typeof body?.password === 'string' ? body.password : '',
      ip: getClientIp(request),
      sessionSecret: getSessionSecret(),
    });

    const response = jsonNoStore({
      gift: result.gift,
      giftId: result.giftId,
      slug: result.slug,
    });

    if (result.cookieName && result.token) {
      response.cookies.set(result.cookieName, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: UNLOCK_SESSION_TTL_SECONDS,
      });
    }

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
