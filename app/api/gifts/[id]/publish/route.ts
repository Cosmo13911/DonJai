import { createGiftService, ServiceError } from '../../../../../lib/server/gifts-service';
import {
  assertSameOrigin,
  handleRouteError,
  jsonNoStore,
  requireCreatorUserId,
} from '../../../../../lib/server/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const ownerId = await requireCreatorUserId();
    let body: { password?: string; hint?: string; keepExistingPassword?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new ServiceError('รูปแบบข้อมูลไม่ถูกต้อง', 400);
    }
    const service = createGiftService();
    const result = await service.publishGift(ownerId, id, {
      password: body?.password,
      hint: body?.hint,
      keepExistingPassword: body?.keepExistingPassword,
    });
    return jsonNoStore(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const ownerId = await requireCreatorUserId();
    const service = createGiftService();
    const result = await service.unpublishGift(ownerId, id);
    return jsonNoStore(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
