import { MAX_ASSET_BYTES } from '../../../../../lib/server/file-validation';
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

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_ASSET_BYTES + 1024 * 1024) {
      throw new ServiceError('รูปภาพมีขนาดเกิน 10 MB', 413);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw new ServiceError('กรุณาเลือกไฟล์รูปภาพ', 400);
    }
    if (file.size > MAX_ASSET_BYTES) {
      throw new ServiceError('รูปภาพมีขนาดเกิน 10 MB', 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const service = createGiftService();
    const asset = await service.uploadAsset(ownerId, id, bytes, file.type);
    return jsonNoStore(asset, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
