import type { Gift } from './domain';

const DB_NAME = 'donjai-v1';
let localWrites: Promise<unknown> = Promise.resolve();

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function localWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = localWrites.catch(() => {}).then(fn);
  localWrites = next;
  return next;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(DB_NAME, 1);
    q.onupgradeneeded = () => q.result.createObjectStore('gifts', { keyPath: 'id' });
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

export async function localGifts(): Promise<Gift[]> {
  await localWrites.catch(() => {});
  const d = await db();
  return new Promise((resolve, reject) => {
    const q = d.transaction('gifts').objectStore('gifts').getAll();
    q.onsuccess = () => {
      resolve(q.result.sort((a: Gift, b: Gift) => b.updatedAt.localeCompare(a.updatedAt)));
      d.close();
    };
    q.onerror = () => reject(q.error);
  });
}

export function localSave(g: Gift) {
  const snapshot = structuredClone(g);
  return localWrite(async () => {
    const d = await db();
    return new Promise<void>((resolve, reject) => {
      const t = d.transaction('gifts', 'readwrite');
      t.objectStore('gifts').put(snapshot);
      t.oncomplete = () => {
        resolve();
        d.close();
      };
      t.onerror = () => reject(t.error);
    });
  });
}

export function localDelete(id: string) {
  return localWrite(async () => {
    const d = await db();
    return new Promise<void>((resolve, reject) => {
      const t = d.transaction('gifts', 'readwrite');
      t.objectStore('gifts').delete(id);
      t.oncomplete = () => {
        resolve();
        d.close();
      };
      t.onerror = () => reject(t.error);
    });
  });
}

export function localClear() {
  return localWrite(async () => {
    const d = await db();
    return new Promise<void>((resolve, reject) => {
      const t = d.transaction('gifts', 'readwrite');
      t.objectStore('gifts').clear();
      t.oncomplete = () => {
        resolve();
        d.close();
      };
      t.onerror = () => reject(t.error);
    });
  });
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any;
  try {
    data = await r.json();
  } catch {
    throw new ApiError(
      'เชื่อมต่อพื้นที่เก็บข้อมูลออนไลน์ไม่ได้ ฉบับร่างยังบันทึกในเครื่อง',
      r.status || 503
    );
  }
  if (!r.ok) {
    throw new ApiError(data?.error || 'เชื่อมต่อไม่สำเร็จ', r.status);
  }
  return data as T;
}

export async function fetchAuthMe(): Promise<{
  authConfigured: boolean;
  user: AuthUser | null;
}> {
  try {
    return await api<{ authConfigured: boolean; user: AuthUser | null }>('/auth/me');
  } catch {
    return { authConfigured: false, user: null };
  }
}

export async function logoutAuth(): Promise<void> {
  await api('/auth/logout', 'POST');
}

const remoteWrites = new Map<string, Promise<Gift>>();

export function saveGift(g: Gift): Promise<Gift> {
  const snapshot = structuredClone(g);
  const previous = remoteWrites.get(g.id) || Promise.resolve(g);
  const result = previous
    .catch(() => g)
    .then(async () => {
      const data = await api<{ gift: Gift }>('/gifts/' + g.id, 'PUT', snapshot);
      return data.gift;
    });
  remoteWrites.set(g.id, result);
  void result
    .finally(() => {
      if (remoteWrites.get(g.id) === result) remoteWrites.delete(g.id);
    })
    .catch(() => {});
  return result;
}

export async function resizeImageToBlob(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('เลือกรูป JPG, PNG หรือ WebP');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('เลือกรูปขนาดไม่เกิน 10 MB');
  }
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82)
  );
  if (blob) return blob;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function imageData(file: File): Promise<string> {
  const blob = await resizeImageToBlob(file);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
    reader.readAsDataURL(blob);
  });
}

export async function uploadGiftAsset(
  giftId: string,
  file: File
): Promise<{ assetId: string; signedUrl: string; mimeType: string; sizeBytes: number }> {
  const blob = await resizeImageToBlob(file);
  const form = new FormData();
  form.append('file', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));

  const r = await fetch(`/api/gifts/${encodeURIComponent(giftId)}/assets`, {
    method: 'POST',
    body: form,
  });
  let data: any;
  try {
    data = await r.json();
  } catch {
    throw new ApiError('อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่', r.status || 503);
  }
  if (!r.ok) {
    throw new ApiError(data?.error || 'อัปโหลดรูปภาพไม่สำเร็จ', r.status);
  }
  return data;
}

function dataUrlToFile(dataUrl: string): File {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header?.match(/^data:(image\/(?:jpeg|png|webp));base64$/);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return new File([bytes], `gift-image.${ext}`, { type: mime });
}

export function stripPendingDataUrls(gift: Gift): Gift {
  return {
    ...gift,
    cover: gift.cover.startsWith('data:image/') && !gift.coverAssetId ? '' : gift.cover,
    blocks: gift.blocks.map((b) => ({
      ...b,
      image: b.image && b.image.startsWith('data:image/') && !b.imageAssetId ? undefined : b.image,
    })),
  };
}

export function hasPendingInlineImages(gift: Gift): boolean {
  if (gift.cover.startsWith('data:image/') && !gift.coverAssetId) return true;
  return gift.blocks.some((b) => Boolean(b.image?.startsWith('data:image/') && !b.imageAssetId));
}

export async function syncPendingInlineImages(gift: Gift): Promise<Gift> {
  if (!hasPendingInlineImages(gift)) {
    return gift;
  }

  // Ensure the gift row exists on the server before attaching uploaded assets.
  await saveGift(stripPendingDataUrls(gift));

  const next = structuredClone(gift);

  if (next.cover.startsWith('data:image/') && !next.coverAssetId) {
    const uploaded = await uploadGiftAsset(next.id, dataUrlToFile(next.cover));
    next.cover = uploaded.signedUrl;
    next.coverAssetId = uploaded.assetId;
  }

  for (const block of next.blocks) {
    if (block.image && block.image.startsWith('data:image/') && !block.imageAssetId) {
      const uploaded = await uploadGiftAsset(next.id, dataUrlToFile(block.image));
      block.image = uploaded.signedUrl;
      block.imageAssetId = uploaded.assetId;
    }
  }

  next.updatedAt = new Date().toISOString();
  return saveGift(next);
}
