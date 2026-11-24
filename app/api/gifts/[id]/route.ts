import { createGiftService, ServiceError } from '../../../../lib/server/gifts-service';
import {
  assertSameOrigin,
  handleRouteError,
  jsonNoStore,
  requireCreatorUserId,
} from '../../../../lib/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ownerId = await requireCreatorUserId();
    const service = createGiftService();
    const gift = await service.getOwnerGift(ownerId, id);
    return jsonNoStore({ gift });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const ownerId = await requireCreatorUserId();
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 6500000) {
      throw new ServiceError('ข้อมูลใหญ่เกิน 6 MB', 413);
    }
    const rawText = await request.text();
    if (rawText.length > 6500000) {
      throw new ServiceError('ข้อมูลใหญ่เกิน 6 MB', 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      throw new ServiceError('รูปแบบข้อมูล JSON ไม่ถูกต้อง', 400);
    }
    const service = createGiftService();
    const gift = await service.saveOwnerGift(ownerId, id, body);
    return jsonNoStore({ gift });
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
    const result = await service.deleteOwnerGift(ownerId, id);
    return jsonNoStore(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
