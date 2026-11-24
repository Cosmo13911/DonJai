export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_ASSETS_PER_GIFT = 25;
export const MAX_TOTAL_ASSET_BYTES_PER_GIFT = 50 * 1024 * 1024;

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const EXT_BY_MIME: Record<SupportedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function validateUploadedImage(
  bytes: Uint8Array,
  declaredMime?: string
): { mime: SupportedImageMime; ext: string } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error('ไฟล์รูปภาพว่างเปล่า');
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error('รูปภาพมีขนาดเกิน 10 MB');
  }

  const detected = detectImageMime(bytes);
  if (!detected) {
    throw new Error('รองรับเฉพาะไฟล์รูป JPG, PNG หรือ WebP เท่านั้น');
  }

  if (
    declaredMime &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(declaredMime) &&
    declaredMime !== detected
  ) {
    throw new Error('ชนิดไฟล์รูปภาพไม่ตรงกับข้อมูลจริง');
  }

  return { mime: detected, ext: EXT_BY_MIME[detected] };
}
