import { createGiftService } from '../../../lib/server/gifts-service';
import { handleRouteError, jsonNoStore, requireCreatorUserId } from '../../../lib/server/http';

export async function GET() {
  try {
    const ownerId = await requireCreatorUserId();
    const service = createGiftService();
    const gifts = await service.listOwnerGifts(ownerId);
    return jsonNoStore({ gifts });
  } catch (error) {
    return handleRouteError(error);
  }
}
