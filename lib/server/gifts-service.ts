import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateSlug,
  isUuid,
  validateGift,
  type Block,
  type BlockType,
  type Gift,
  type Template,
} from '../domain';
import { hashPassword, verifyPassword } from '../password';
import {
  hashClientIp,
  signUnlockToken,
  UNLOCK_SESSION_TTL_SECONDS,
  unlockCookieName,
  verifyUnlockToken,
} from '../session';
import { createSupabaseAdminClient } from '../supabase/admin';
import {
  MAX_ASSETS_PER_GIFT,
  MAX_TOTAL_ASSET_BYTES_PER_GIFT,
  validateUploadedImage,
} from './file-validation';

const SIGNED_URL_TTL_SECONDS = 1800;
const UNLOCK_MAX_ATTEMPTS = 5;
const UNLOCK_WINDOW_SECONDS = 600;

export class ServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

export interface StoredAsset {
  id: string;
  giftId: string;
  ownerId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StoredBlockRecord {
  id: string;
  type: BlockType;
  title: string;
  text: string;
  imageAssetId?: string | null;
  imagePreset?: string | null;
  date?: string | null;
}

export interface StoredGiftRecord {
  id: string;
  ownerId: string;
  slug: string;
  template: Template;
  title: string;
  subtitle: string;
  recipient: string;
  sender: string;
  color: 'rose' | 'sage' | 'lilac';
  coverAssetId?: string | null;
  coverPreset: string;
  status: 'draft' | 'published';
  passwordProtected: boolean;
  hint: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  updatedAt: string;
  blocks: StoredBlockRecord[];
}

export interface StoredGiftSnapshot {
  id: string;
  slug: string;
  template: Template;
  recipient: string;
  sender: string;
  title: string;
  subtitle: string;
  color: 'rose' | 'sage' | 'lilac';
  coverAssetId?: string | null;
  coverPreset: string;
  blocks: StoredBlockRecord[];
  updatedAt: string;
  publishedAt: string;
  passwordProtected: boolean;
  hint?: string;
}

export interface StoredPublicationRecord {
  giftId: string;
  slug: string;
  snapshot: StoredGiftSnapshot;
  passwordProtected: boolean;
  passwordHash?: string | null;
  hint: string;
  version: number;
  isActive: boolean;
  publishedAt: string;
  expiresAt?: string | null;
}

export interface GiftStore {
  listOwnerGifts(ownerId: string): Promise<StoredGiftRecord[]>;
  getGiftMeta(giftId: string): Promise<{ id: string; ownerId: string; slug: string } | null>;
  getOwnerGift(ownerId: string, giftId: string): Promise<StoredGiftRecord | null>;
  findGiftBySlug(slug: string): Promise<{ id: string; ownerId: string } | null>;
  saveGift(gift: StoredGiftRecord): Promise<StoredGiftRecord>;
  deleteGift(ownerId: string, giftId: string): Promise<boolean>;
  listGiftAssets(ownerId: string, giftId: string): Promise<StoredAsset[]>;
  getAssetById(ownerId: string, giftId: string, assetId: string): Promise<StoredAsset | null>;
  getAssetsByIds(assetIds: string[]): Promise<Map<string, StoredAsset>>;
  uploadAssetBytes(asset: StoredAsset, bytes: Uint8Array): Promise<void>;
  deleteAssetObjects(storagePaths: string[]): Promise<void>;
  createSignedAssetUrls(storagePaths: string[], expiresInSeconds: number): Promise<Map<string, string>>;
  getPublicationByGiftId(giftId: string): Promise<StoredPublicationRecord | null>;
  getPublicationBySlugOrId(slugOrId: string): Promise<StoredPublicationRecord | null>;
  upsertPublication(pub: StoredPublicationRecord): Promise<void>;
  deactivatePublication(giftId: string, nextVersion: number): Promise<void>;
  recordUnlockAttempt(
    giftId: string,
    ipHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attemptCount: number }>;
  clearUnlockAttempts(giftId: string, ipHash: string): Promise<void>;
}

function collectAssetIds(record: {
  coverAssetId?: string | null;
  blocks: StoredBlockRecord[];
}): string[] {
  const ids = new Set<string>();
  if (record.coverAssetId && isUuid(record.coverAssetId)) {
    ids.add(record.coverAssetId);
  }
  for (const b of record.blocks) {
    if (b.imageAssetId && isUuid(b.imageAssetId)) {
      ids.add(b.imageAssetId);
    }
  }
  return [...ids];
}

export class GiftService {
  constructor(private readonly store: GiftStore) {}

  private async hydrateRecord(
    record: Omit<
      StoredGiftRecord,
      'ownerId' | 'status' | 'expiresAt' | 'hint'
    > & { hint?: string }
  ): Promise<Gift> {
    const assetIds = collectAssetIds(record);
    const assetMap = assetIds.length ? await this.store.getAssetsByIds(assetIds) : new Map<string, StoredAsset>();
    const paths = [...new Set([...assetMap.values()].map((a) => a.storagePath))];
    const signedUrls = paths.length
      ? await this.store.createSignedAssetUrls(paths, SIGNED_URL_TTL_SECONDS)
      : new Map<string, string>();

    const resolveAssetUrl = (assetId?: string | null, preset?: string | null): string => {
      if (assetId) {
        const asset = assetMap.get(assetId);
        if (asset) {
          const url = signedUrls.get(asset.storagePath);
          if (url) return url;
        }
      }
      return preset || '';
    };

    const blocks: Block[] = record.blocks.map((b) => {
      const image = resolveAssetUrl(b.imageAssetId, b.imagePreset);
      return {
        id: b.id,
        type: b.type,
        title: b.title,
        text: b.text,
        ...(image ? { image } : {}),
        ...(b.imageAssetId ? { imageAssetId: b.imageAssetId } : {}),
        ...(b.date ? { date: b.date } : {}),
      };
    });

    const cover = resolveAssetUrl(record.coverAssetId, record.coverPreset);

    return {
      id: record.id,
      slug: record.slug,
      template: record.template,
      recipient: record.recipient,
      sender: record.sender,
      title: record.title,
      subtitle: record.subtitle,
      color: record.color,
      cover,
      ...(record.coverAssetId ? { coverAssetId: record.coverAssetId } : {}),
      blocks,
      updatedAt: record.updatedAt,
      ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
      passwordProtected: Boolean(record.passwordProtected),
      ...(record.hint ? { hint: record.hint } : {}),
    };
  }

  async listOwnerGifts(ownerId: string): Promise<Gift[]> {
    const records = await this.store.listOwnerGifts(ownerId);
    return Promise.all(records.map((r) => this.hydrateRecord(r)));
  }

  async getOwnerGift(ownerId: string, giftId: string): Promise<Gift> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }
    const meta = await this.store.getGiftMeta(giftId);
    if (!meta) {
      throw new ServiceError('ไม่พบฉบับร่างนี้', 404);
    }
    if (meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์เข้าถึงของขวัญชิ้นนี้', 403);
    }
    const record = await this.store.getOwnerGift(ownerId, giftId);
    if (!record) {
      throw new ServiceError('ไม่พบฉบับร่างนี้', 404);
    }
    return this.hydrateRecord(record);
  }

  async saveOwnerGift(ownerId: string, giftId: string, rawGift: unknown): Promise<Gift> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }

    let parsed: Gift;
    try {
      parsed = validateGift(rawGift);
    } catch (err) {
      throw new ServiceError(err instanceof Error ? err.message : 'ข้อมูลของขวัญไม่ถูกต้อง', 400);
    }

    if (parsed.id !== giftId) {
      throw new ServiceError('รหัสของขวัญไม่ตรงกัน', 400);
    }

    const meta = await this.store.getGiftMeta(giftId);
    if (meta && meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์แก้ไขของขวัญชิ้นนี้', 403);
    }

    const existing = meta ? await this.store.getOwnerGift(ownerId, giftId) : null;
    if (existing && parsed.updatedAt < existing.updatedAt) {
      throw new ServiceError(
        'พบฉบับร่างใหม่กว่าจากอีกหน้าต่าง กรุณาดาวน์โหลดสำรองแล้วเปิดของขวัญใหม่อีกครั้ง',
        409
      );
    }

    let coverAssetId: string | null = null;
    let coverPreset = '';

    if (parsed.coverAssetId) {
      const asset = await this.store.getAssetById(ownerId, giftId, parsed.coverAssetId);
      if (!asset) {
        throw new ServiceError('ไม่พบรูปหน้าปกที่อ้างอิง', 400);
      }
      coverAssetId = asset.id;
    } else if (!parsed.cover) {
      coverPreset = '';
    } else if (parsed.cover.startsWith('/images/')) {
      coverPreset = parsed.cover;
    } else if (parsed.cover.startsWith('data:image/')) {
      throw new ServiceError('กรุณาอัปโหลดรูปหน้าปกขึ้นระบบก่อนบันทึกออนไลน์', 400);
    } else {
      throw new ServiceError('รูปหน้าปกต้องอ้างอิงไฟล์ที่อัปโหลดแล้ว', 400);
    }

    const blocks: StoredBlockRecord[] = [];
    for (const b of parsed.blocks) {
      const blockId = isUuid(b.id) ? b.id : crypto.randomUUID();
      let imageAssetId: string | null = null;
      let imagePreset: string | null = null;

      if (b.imageAssetId) {
        const asset = await this.store.getAssetById(ownerId, giftId, b.imageAssetId);
        if (!asset) {
          throw new ServiceError('ไม่พบรูปภาพในบล็อกที่อ้างอิง', 400);
        }
        imageAssetId = asset.id;
      } else if (!b.image) {
        imagePreset = null;
      } else if (b.image.startsWith('/images/')) {
        imagePreset = b.image;
      } else if (b.image.startsWith('data:image/')) {
        throw new ServiceError('กรุณาอัปโหลดรูปภาพในบล็อกขึ้นระบบก่อนบันทึกออนไลน์', 400);
      } else {
        throw new ServiceError('รูปภาพในบล็อกต้องอ้างอิงไฟล์ที่อัปโหลดแล้ว', 400);
      }

      blocks.push({
        id: blockId,
        type: b.type,
        title: b.title,
        text: b.text,
        imageAssetId,
        imagePreset,
        date: b.date || null,
      });
    }

    let slug = existing?.slug || '';
    if (!slug) {
      const candidate = parsed.slug || generateSlug(parsed.title);
      const conflict = await this.store.findGiftBySlug(candidate);
      slug = conflict && conflict.id !== giftId ? generateSlug(parsed.title) : candidate;
    }

    const record: StoredGiftRecord = {
      id: giftId,
      ownerId,
      slug,
      template: parsed.template,
      title: parsed.title,
      subtitle: parsed.subtitle,
      recipient: parsed.recipient,
      sender: parsed.sender,
      color: parsed.color,
      coverAssetId,
      coverPreset,
      status: existing?.status ?? 'draft',
      passwordProtected: existing?.passwordProtected ?? false,
      hint: existing?.hint ?? (parsed.hint || ''),
      publishedAt: existing?.publishedAt ?? null,
      expiresAt: existing?.expiresAt ?? null,
      updatedAt: parsed.updatedAt,
      blocks,
    };

    const saved = await this.store.saveGift(record);
    return this.hydrateRecord(saved);
  }

  async deleteOwnerGift(ownerId: string, giftId: string): Promise<{ deleted: true }> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }
    const meta = await this.store.getGiftMeta(giftId);
    if (!meta) {
      throw new ServiceError('ไม่พบของขวัญนี้', 404);
    }
    if (meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์ลบของขวัญชิ้นนี้', 403);
    }

    const assets = await this.store.listGiftAssets(ownerId, giftId);
    if (assets.length) {
      await this.store.deleteAssetObjects(assets.map((a) => a.storagePath));
    }
    await this.store.deleteGift(ownerId, giftId);
    return { deleted: true };
  }

  async uploadAsset(
    ownerId: string,
    giftId: string,
    fileBytes: Uint8Array,
    declaredMime?: string
  ): Promise<{ assetId: string; signedUrl: string; mimeType: string; sizeBytes: number }> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }
    const meta = await this.store.getGiftMeta(giftId);
    if (!meta) {
      throw new ServiceError('กรุณาบันทึกฉบับร่างก่อนอัปโหลดรูป', 404);
    }
    if (meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์แก้ไขของขวัญชิ้นนี้', 403);
    }

    let validated: { mime: string; ext: string };
    try {
      validated = validateUploadedImage(fileBytes, declaredMime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไฟล์รูปภาพไม่ถูกต้อง';
      throw new ServiceError(msg, msg.includes('10 MB') ? 413 : 400);
    }

    const existingAssets = await this.store.listGiftAssets(ownerId, giftId);
    if (existingAssets.length >= MAX_ASSETS_PER_GIFT) {
      throw new ServiceError(`อัปโหลดได้สูงสุด ${MAX_ASSETS_PER_GIFT} รูปต่อของขวัญ`, 400);
    }
    const usedBytes = existingAssets.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (usedBytes + fileBytes.byteLength > MAX_TOTAL_ASSET_BYTES_PER_GIFT) {
      throw new ServiceError('ขนาดรูปทั้งหมดเกิน 50 MB ต่อของขวัญ', 413);
    }

    const assetId = crypto.randomUUID();
    const storagePath = `${ownerId}/${giftId}/${assetId}.${validated.ext}`;
    const asset: StoredAsset = {
      id: assetId,
      giftId,
      ownerId,
      storagePath,
      mimeType: validated.mime,
      sizeBytes: fileBytes.byteLength,
      createdAt: new Date().toISOString(),
    };

    await this.store.uploadAssetBytes(asset, fileBytes);
    const urls = await this.store.createSignedAssetUrls([storagePath], SIGNED_URL_TTL_SECONDS);

    return {
      assetId,
      signedUrl: urls.get(storagePath) || '',
      mimeType: validated.mime,
      sizeBytes: fileBytes.byteLength,
    };
  }

  async publishGift(
    ownerId: string,
    giftId: string,
    options: { password?: string; hint?: string; keepExistingPassword?: boolean }
  ): Promise<{ gift: Gift; slug: string; url: string }> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }
    const meta = await this.store.getGiftMeta(giftId);
    if (!meta) {
      throw new ServiceError('กรุณาบันทึกฉบับร่างก่อนเผยแพร่', 404);
    }
    if (meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์เผยแพร่ของขวัญชิ้นนี้', 403);
    }

    const current = await this.store.getOwnerGift(ownerId, giftId);
    if (!current) {
      throw new ServiceError('กรุณาบันทึกฉบับร่างก่อนเผยแพร่', 404);
    }
    if (!current.blocks.length) {
      throw new ServiceError('เพิ่มเนื้อหาอย่างน้อย 1 บล็อกก่อนเผยแพร่', 400);
    }

    const existingPub = await this.store.getPublicationByGiftId(giftId);
    const rawPassword = typeof options.password === 'string' ? options.password : '';
    const keepExisting = Boolean(options.keepExistingPassword);
    const cleanHint = String(options.hint ?? '').trim().slice(0, 300);

    let passwordProtected = false;
    let passwordHash: string | null = null;
    let version = (existingPub?.version ?? 0) + 1;

    if (rawPassword) {
      if (rawPassword.length < 4 || rawPassword.length > 128) {
        throw new ServiceError('รหัสต้องมี 4–128 ตัวอักษร', 400);
      }
      passwordProtected = true;
      passwordHash = await hashPassword(rawPassword);
      version = (existingPub?.version ?? 0) + 1;
    } else if (keepExisting && existingPub?.passwordProtected && existingPub.passwordHash) {
      passwordProtected = true;
      passwordHash = existingPub.passwordHash;
      version = existingPub.version || 1;
    } else {
      passwordProtected = false;
      passwordHash = null;
      version = (existingPub?.version ?? 0) + 1;
    }

    const now = new Date().toISOString();
    const snapshot: StoredGiftSnapshot = {
      id: current.id,
      slug: current.slug,
      template: current.template,
      recipient: current.recipient,
      sender: current.sender,
      title: current.title,
      subtitle: current.subtitle,
      color: current.color,
      coverAssetId: current.coverAssetId ?? null,
      coverPreset: current.coverPreset,
      blocks: structuredClone(current.blocks),
      updatedAt: current.updatedAt,
      publishedAt: now,
      passwordProtected,
      ...(passwordProtected && cleanHint ? { hint: cleanHint } : {}),
    };

    await this.store.upsertPublication({
      giftId,
      slug: current.slug,
      snapshot,
      passwordProtected,
      passwordHash,
      hint: passwordProtected ? cleanHint : '',
      version,
      isActive: true,
      publishedAt: now,
      expiresAt: current.expiresAt ?? null,
    });

    const updatedDraft: StoredGiftRecord = {
      ...current,
      status: 'published',
      publishedAt: now,
      passwordProtected,
      hint: passwordProtected ? cleanHint : '',
    };
    const saved = await this.store.saveGift(updatedDraft);
    const gift = await this.hydrateRecord(saved);

    return {
      gift,
      slug: current.slug,
      url: `/g/${current.slug}`,
    };
  }

  async unpublishGift(ownerId: string, giftId: string): Promise<{ gift: Gift }> {
    if (!isUuid(giftId)) {
      throw new ServiceError('รหัสของขวัญไม่ถูกต้อง', 400);
    }
    const meta = await this.store.getGiftMeta(giftId);
    if (!meta) {
      throw new ServiceError('ไม่พบของขวัญนี้', 404);
    }
    if (meta.ownerId !== ownerId) {
      throw new ServiceError('คุณไม่มีสิทธิ์ยกเลิกเผยแพร่ของขวัญชิ้นนี้', 403);
    }

    const current = await this.store.getOwnerGift(ownerId, giftId);
    if (!current) {
      throw new ServiceError('ไม่พบของขวัญนี้', 404);
    }

    const existingPub = await this.store.getPublicationByGiftId(giftId);
    if (existingPub) {
      await this.store.deactivatePublication(giftId, existingPub.version + 1);
    }

    const updatedDraft: StoredGiftRecord = {
      ...current,
      status: 'draft',
      publishedAt: null,
      passwordProtected: false,
    };
    const saved = await this.store.saveGift(updatedDraft);
    const gift = await this.hydrateRecord(saved);
    return { gift };
  }

  async openGift(
    slugOrId: string,
    options: {
      unlockCookieToken?: string | null | ((giftId: string) => string | undefined | null);
      sessionSecret: string;
    }
  ): Promise<
    | { locked: true; giftId: string; slug: string; hint: string }
    | { locked: false; giftId: string; slug: string; gift: Gift }
  > {
    if (!slugOrId || !/^[-\w]{4,80}$/.test(slugOrId)) {
      throw new ServiceError('ไม่พบของขวัญนี้', 404);
    }

    const pub = await this.store.getPublicationBySlugOrId(slugOrId);
    if (!pub || !pub.isActive) {
      throw new ServiceError('ของขวัญนี้ยังไม่เผยแพร่ หรือถูกยกเลิกแล้ว', 404);
    }
    if (pub.expiresAt && Date.parse(pub.expiresAt) <= Date.now()) {
      throw new ServiceError('ของขวัญนี้หมดอายุแล้ว', 410);
    }

    if (pub.passwordProtected) {
      const token =
        typeof options.unlockCookieToken === 'function'
          ? options.unlockCookieToken(pub.giftId)
          : options.unlockCookieToken;
      const unlocked = await verifyUnlockToken(
        token,
        { giftId: pub.giftId, version: pub.version },
        options.sessionSecret
      );
      if (!unlocked) {
        return {
          locked: true,
          giftId: pub.giftId,
          slug: pub.slug,
          hint: pub.hint || '',
        };
      }
    }

    const gift = await this.hydrateRecord(pub.snapshot);
    return {
      locked: false,
      giftId: pub.giftId,
      slug: pub.slug,
      gift,
    };
  }

  async unlockGift(
    slugOrId: string,
    options: { password: string; ip: string; sessionSecret: string }
  ): Promise<{
    gift: Gift;
    giftId: string;
    slug: string;
    cookieName?: string;
    token?: string;
  }> {
    if (!slugOrId || !/^[-\w]{4,80}$/.test(slugOrId)) {
      throw new ServiceError('ไม่พบของขวัญนี้', 404);
    }

    const pub = await this.store.getPublicationBySlugOrId(slugOrId);
    if (!pub || !pub.isActive) {
      throw new ServiceError('ของขวัญนี้ยังไม่เผยแพร่ หรือถูกยกเลิกแล้ว', 404);
    }
    if (pub.expiresAt && Date.parse(pub.expiresAt) <= Date.now()) {
      throw new ServiceError('ของขวัญนี้หมดอายุแล้ว', 410);
    }

    if (!pub.passwordProtected || !pub.passwordHash) {
      const gift = await this.hydrateRecord(pub.snapshot);
      return { gift, giftId: pub.giftId, slug: pub.slug };
    }

    if (typeof options.password !== 'string' || !options.password || options.password.length > 128) {
      throw new ServiceError('กรุณาใส่รหัสให้ถูกต้อง', 400);
    }

    const ipHash = await hashClientIp(options.ip || 'shared', options.sessionSecret);
    const attempt = await this.store.recordUnlockAttempt(
      pub.giftId,
      ipHash,
      UNLOCK_MAX_ATTEMPTS,
      UNLOCK_WINDOW_SECONDS
    );
    if (!attempt.allowed) {
      throw new ServiceError('ลองรหัสหลายครั้งแล้ว รออีก 10 นาทีก่อนลองใหม่', 429);
    }

    const matched = await verifyPassword(options.password, pub.passwordHash);
    if (!matched) {
      throw new ServiceError('รหัสยังไม่ถูกนะ ลองดูคำใบ้อีกครั้ง ♡', 401);
    }

    const live = await this.store.getPublicationBySlugOrId(pub.giftId);
    if (!live || !live.isActive) {
      throw new ServiceError('ของขวัญนี้ถูกยกเลิกเผยแพร่แล้ว', 404);
    }
    if (live.expiresAt && Date.parse(live.expiresAt) <= Date.now()) {
      throw new ServiceError('ของขวัญนี้หมดอายุแล้ว', 410);
    }
    if (live.version !== pub.version) {
      throw new ServiceError('รหัสผ่านของของขวัญถูกเปลี่ยนแปลง กรุณาลองอีกครั้ง', 401);
    }

    await this.store.clearUnlockAttempts(live.giftId, ipHash);

    const token = await signUnlockToken(
      {
        giftId: live.giftId,
        version: live.version,
        exp: Math.floor(Date.now() / 1000) + UNLOCK_SESSION_TTL_SECONDS,
      },
      options.sessionSecret
    );
    const gift = await this.hydrateRecord(live.snapshot);

    return {
      gift,
      giftId: live.giftId,
      slug: live.slug,
      cookieName: unlockCookieName(live.giftId),
      token,
    };
  }
}

interface GiftRow {
  id: string;
  owner_id: string;
  slug: string;
  template_id: Template;
  title: string;
  subtitle: string;
  recipient_name: string;
  sender_name: string;
  theme_color: 'rose' | 'sage' | 'lilac';
  cover_asset_id: string | null;
  cover_preset: string;
  status: 'draft' | 'published';
  password_protected: boolean;
  hint: string;
  published_at: string | null;
  expires_at: string | null;
  updated_at: string;
}

interface BlockRow {
  id: string;
  gift_id: string;
  type: BlockType;
  position: number;
  content: {
    title?: string;
    text?: string;
    imageAssetId?: string | null;
    imagePreset?: string | null;
    date?: string | null;
  };
}

interface AssetRow {
  id: string;
  gift_id: string;
  owner_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface PublicationRow {
  gift_id: string;
  snapshot: StoredGiftSnapshot;
  password_protected: boolean;
  password_hash: string | null;
  hint: string;
  version: number;
  is_active: boolean;
  published_at: string;
}

function mapAssetRow(row: AssetRow): StoredAsset {
  return {
    id: row.id,
    giftId: row.gift_id,
    ownerId: row.owner_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function mapGiftRow(row: GiftRow, blockRows: BlockRow[]): StoredGiftRecord {
  const sorted = [...blockRows].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    template: row.template_id,
    title: row.title,
    subtitle: row.subtitle || '',
    recipient: row.recipient_name,
    sender: row.sender_name,
    color: row.theme_color,
    coverAssetId: row.cover_asset_id,
    coverPreset: row.cover_preset || '',
    status: row.status,
    passwordProtected: row.password_protected,
    hint: row.hint || '',
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    blocks: sorted.map((b) => ({
      id: b.id,
      type: b.type,
      title: b.content?.title || '',
      text: b.content?.text || '',
      imageAssetId: b.content?.imageAssetId || null,
      imagePreset: b.content?.imagePreset || null,
      date: b.content?.date || null,
    })),
  };
}

export class SupabaseGiftStore implements GiftStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async listOwnerGifts(ownerId: string): Promise<StoredGiftRecord[]> {
    const { data: giftRows, error } = await this.supabase
      .from('gifts')
      .select('*')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false });

    if (error) throw new ServiceError('โหลดรายการของขวัญไม่สำเร็จ', 500);
    if (!giftRows?.length) return [];

    const giftIds = giftRows.map((g: GiftRow) => g.id);
    const { data: blockRows, error: blockErr } = await this.supabase
      .from('gift_blocks')
      .select('*')
      .in('gift_id', giftIds)
      .order('position', { ascending: true });

    if (blockErr) throw new ServiceError('โหลดเนื้อหาของขวัญไม่สำเร็จ', 500);

    const blocksByGift = new Map<string, BlockRow[]>();
    for (const row of (blockRows || []) as BlockRow[]) {
      const list = blocksByGift.get(row.gift_id) || [];
      list.push(row);
      blocksByGift.set(row.gift_id, list);
    }

    return (giftRows as GiftRow[]).map((g) => mapGiftRow(g, blocksByGift.get(g.id) || []));
  }

  async getGiftMeta(giftId: string): Promise<{ id: string; ownerId: string; slug: string } | null> {
    if (!isUuid(giftId)) return null;
    const { data, error } = await this.supabase
      .from('gifts')
      .select('id, owner_id, slug')
      .eq('id', giftId)
      .maybeSingle();

    if (error) throw new ServiceError('ตรวจสอบข้อมูลของขวัญไม่สำเร็จ', 500);
    if (!data) return null;
    return { id: data.id, ownerId: data.owner_id, slug: data.slug };
  }

  async getOwnerGift(ownerId: string, giftId: string): Promise<StoredGiftRecord | null> {
    if (!isUuid(giftId)) return null;
    const { data: giftRow, error } = await this.supabase
      .from('gifts')
      .select('*')
      .eq('id', giftId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) throw new ServiceError('โหลดของขวัญไม่สำเร็จ', 500);
    if (!giftRow) return null;

    const { data: blockRows, error: blockErr } = await this.supabase
      .from('gift_blocks')
      .select('*')
      .eq('gift_id', giftId)
      .order('position', { ascending: true });

    if (blockErr) throw new ServiceError('โหลดบล็อกของขวัญไม่สำเร็จ', 500);
    return mapGiftRow(giftRow as GiftRow, (blockRows || []) as BlockRow[]);
  }

  async findGiftBySlug(slug: string): Promise<{ id: string; ownerId: string } | null> {
    const { data, error } = await this.supabase
      .from('gifts')
      .select('id, owner_id')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new ServiceError('ตรวจสอบลิงก์ของขวัญไม่สำเร็จ', 500);
    if (!data) return null;
    return { id: data.id, ownerId: data.owner_id };
  }

  async saveGift(gift: StoredGiftRecord): Promise<StoredGiftRecord> {
    const { data: savedRow, error: giftError } = await this.supabase
      .from('gifts')
      .upsert(
        {
          id: gift.id,
          owner_id: gift.ownerId,
          slug: gift.slug,
          template_id: gift.template,
          title: gift.title,
          subtitle: gift.subtitle,
          recipient_name: gift.recipient,
          sender_name: gift.sender,
          theme_color: gift.color,
          cover_asset_id: gift.coverAssetId ?? null,
          cover_preset: gift.coverPreset || '',
          status: gift.status,
          password_protected: gift.passwordProtected,
          hint: gift.hint || '',
          published_at: gift.publishedAt ?? null,
          expires_at: gift.expiresAt ?? null,
          updated_at: gift.updatedAt,
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (giftError || !savedRow) {
      throw new ServiceError('บันทึกของขวัญลงฐานข้อมูลไม่สำเร็จ', 500);
    }

    const blocksPayload = gift.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      content: {
        title: b.title,
        text: b.text,
        imageAssetId: b.imageAssetId ?? null,
        imagePreset: b.imagePreset ?? null,
        date: b.date ?? null,
      },
    }));

    const { error: blocksError } = await this.supabase.rpc('save_gift_blocks', {
      p_gift_id: gift.id,
      p_blocks: blocksPayload,
    });

    if (blocksError) {
      throw new ServiceError('บันทึกบล็อกเนื้อหาไม่สำเร็จ', 500);
    }

    const reloaded = await this.getOwnerGift(gift.ownerId, gift.id);
    if (!reloaded) {
      throw new ServiceError('โหลดของขวัญหลังบันทึกไม่สำเร็จ', 500);
    }
    return reloaded;
  }

  async deleteGift(ownerId: string, giftId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('gifts')
      .delete()
      .eq('id', giftId)
      .eq('owner_id', ownerId);

    if (error) throw new ServiceError('ลบของขวัญไม่สำเร็จ', 500);
    return true;
  }

  async listGiftAssets(ownerId: string, giftId: string): Promise<StoredAsset[]> {
    const { data, error } = await this.supabase
      .from('gift_assets')
      .select('*')
      .eq('gift_id', giftId)
      .eq('owner_id', ownerId);

    if (error) throw new ServiceError('โหลดรายการรูปภาพไม่สำเร็จ', 500);
    return ((data || []) as AssetRow[]).map(mapAssetRow);
  }

  async getAssetById(ownerId: string, giftId: string, assetId: string): Promise<StoredAsset | null> {
    if (!isUuid(assetId)) return null;
    const { data, error } = await this.supabase
      .from('gift_assets')
      .select('*')
      .eq('id', assetId)
      .eq('gift_id', giftId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) throw new ServiceError('ตรวจสอบรูปภาพไม่สำเร็จ', 500);
    return data ? mapAssetRow(data as AssetRow) : null;
  }

  async getAssetsByIds(assetIds: string[]): Promise<Map<string, StoredAsset>> {
    const clean = assetIds.filter((id) => isUuid(id));
    if (!clean.length) return new Map();
    const { data, error } = await this.supabase
      .from('gift_assets')
      .select('*')
      .in('id', clean);

    if (error) throw new ServiceError('โหลดข้อมูลรูปภาพไม่สำเร็จ', 500);
    const result = new Map<string, StoredAsset>();
    for (const row of (data || []) as AssetRow[]) {
      result.set(row.id, mapAssetRow(row));
    }
    return result;
  }

  async uploadAssetBytes(asset: StoredAsset, bytes: Uint8Array): Promise<void> {
    const { error: uploadErr } = await this.supabase.storage
      .from('gift-assets')
      .upload(asset.storagePath, bytes, {
        contentType: asset.mimeType,
        upsert: false,
      });

    if (uploadErr) {
      throw new ServiceError('อัปโหลดรูปภาพไปยังที่เก็บข้อมูลไม่สำเร็จ', 500);
    }

    const { error: dbErr } = await this.supabase.from('gift_assets').insert({
      id: asset.id,
      gift_id: asset.giftId,
      owner_id: asset.ownerId,
      storage_path: asset.storagePath,
      mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes,
    });

    if (dbErr) {
      await this.supabase.storage.from('gift-assets').remove([asset.storagePath]);
      throw new ServiceError('บันทึกข้อมูลรูปภาพไม่สำเร็จ', 500);
    }
  }

  async deleteAssetObjects(storagePaths: string[]): Promise<void> {
    if (!storagePaths.length) return;
    await this.supabase.storage.from('gift-assets').remove(storagePaths);
  }

  async createSignedAssetUrls(
    storagePaths: string[],
    expiresInSeconds: number
  ): Promise<Map<string, string>> {
    if (!storagePaths.length) return new Map();
    const { data, error } = await this.supabase.storage
      .from('gift-assets')
      .createSignedUrls(storagePaths, expiresInSeconds);

    if (error || !data) {
      throw new ServiceError('สร้างลิงก์รูปภาพชั่วคราวไม่สำเร็จ', 500);
    }

    const map = new Map<string, string>();
    for (const item of data) {
      if (item.path && item.signedUrl) {
        map.set(item.path, item.signedUrl);
      }
    }
    return map;
  }

  async getPublicationByGiftId(giftId: string): Promise<StoredPublicationRecord | null> {
    if (!isUuid(giftId)) return null;
    const { data: giftMeta, error: giftErr } = await this.supabase
      .from('gifts')
      .select('id, slug, expires_at')
      .eq('id', giftId)
      .maybeSingle();

    if (giftErr) throw new ServiceError('ตรวจสอบข้อมูลการเผยแพร่ไม่สำเร็จ', 500);
    if (!giftMeta) return null;

    const { data: pub, error: pubErr } = await this.supabase
      .from('gift_publications')
      .select('*')
      .eq('gift_id', giftId)
      .maybeSingle();

    if (pubErr) throw new ServiceError('ตรวจสอบข้อมูลการเผยแพร่ไม่สำเร็จ', 500);
    if (!pub) return null;

    const row = pub as PublicationRow;
    return {
      giftId: row.gift_id,
      slug: giftMeta.slug,
      snapshot: row.snapshot,
      passwordProtected: row.password_protected,
      passwordHash: row.password_hash,
      hint: row.hint || '',
      version: row.version,
      isActive: row.is_active,
      publishedAt: row.published_at,
      expiresAt: giftMeta.expires_at,
    };
  }

  async getPublicationBySlugOrId(slugOrId: string): Promise<StoredPublicationRecord | null> {
    let giftMeta: { id: string; slug: string; expires_at: string | null } | null = null;

    if (isUuid(slugOrId)) {
      const { data, error } = await this.supabase
        .from('gifts')
        .select('id, slug, expires_at')
        .eq('id', slugOrId)
        .maybeSingle();
      if (error) throw new ServiceError('ค้นหาของขวัญไม่สำเร็จ', 500);
      giftMeta = data;
    }

    if (!giftMeta) {
      const { data, error } = await this.supabase
        .from('gifts')
        .select('id, slug, expires_at')
        .eq('slug', slugOrId)
        .maybeSingle();
      if (error) throw new ServiceError('ค้นหาของขวัญไม่สำเร็จ', 500);
      giftMeta = data;
    }

    if (!giftMeta) return null;

    const { data: pub, error: pubErr } = await this.supabase
      .from('gift_publications')
      .select('*')
      .eq('gift_id', giftMeta.id)
      .maybeSingle();

    if (pubErr) throw new ServiceError('ค้นหาของขวัญไม่สำเร็จ', 500);
    if (!pub) return null;

    const row = pub as PublicationRow;
    return {
      giftId: row.gift_id,
      slug: giftMeta.slug,
      snapshot: row.snapshot,
      passwordProtected: row.password_protected,
      passwordHash: row.password_hash,
      hint: row.hint || '',
      version: row.version,
      isActive: row.is_active,
      publishedAt: row.published_at,
      expiresAt: giftMeta.expires_at,
    };
  }

  async upsertPublication(pub: StoredPublicationRecord): Promise<void> {
    const { error } = await this.supabase.from('gift_publications').upsert(
      {
        gift_id: pub.giftId,
        snapshot: pub.snapshot,
        password_protected: pub.passwordProtected,
        password_hash: pub.passwordHash ?? null,
        hint: pub.hint || '',
        version: pub.version,
        is_active: pub.isActive,
        published_at: pub.publishedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gift_id' }
    );

    if (error) throw new ServiceError('บันทึกฉบับเผยแพร่ไม่สำเร็จ', 500);
  }

  async deactivatePublication(giftId: string, nextVersion: number): Promise<void> {
    const { error } = await this.supabase
      .from('gift_publications')
      .update({
        is_active: false,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('gift_id', giftId);

    if (error) throw new ServiceError('ยกเลิกเผยแพร่ไม่สำเร็จ', 500);
  }

  async recordUnlockAttempt(
    giftId: string,
    ipHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attemptCount: number }> {
    const { data, error } = await this.supabase.rpc('record_unlock_attempt', {
      p_gift_id: giftId,
      p_ip_hash: ipHash,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });

    if (error || !data || !Array.isArray(data) || !data[0]) {
      throw new ServiceError('ตรวจสอบสิทธิ์การเปิดของขวัญไม่สำเร็จ', 500);
    }

    return {
      allowed: Boolean(data[0].allowed),
      attemptCount: Number(data[0].attempt_count || 0),
    };
  }

  async clearUnlockAttempts(giftId: string, ipHash: string): Promise<void> {
    await this.supabase
      .from('gift_unlock_attempts')
      .delete()
      .eq('gift_id', giftId)
      .eq('ip_hash', ipHash);
  }
}

export function createGiftService(): GiftService {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new ServiceError(
      'ยังไม่ได้เชื่อมต่อ Supabase (ตั้งค่า .env.local ก่อนใช้งานออนไลน์) ฉบับร่างยังบันทึกในเครื่องได้',
      503
    );
  }
  return new GiftService(new SupabaseGiftStore(admin));
}

export class MemoryGiftStore implements GiftStore {
  gifts = new Map<string, StoredGiftRecord>();
  assets = new Map<string, StoredAsset>();
  assetBytes = new Map<string, Uint8Array>();
  publications = new Map<string, StoredPublicationRecord>();
  attempts = new Map<string, { count: number; untilMs: number }>();

  async listOwnerGifts(ownerId: string): Promise<StoredGiftRecord[]> {
    return [...this.gifts.values()]
      .filter((g) => g.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((g) => structuredClone(g));
  }

  async getGiftMeta(giftId: string): Promise<{ id: string; ownerId: string; slug: string } | null> {
    const g = this.gifts.get(giftId);
    return g ? { id: g.id, ownerId: g.ownerId, slug: g.slug } : null;
  }

  async getOwnerGift(ownerId: string, giftId: string): Promise<StoredGiftRecord | null> {
    const g = this.gifts.get(giftId);
    if (!g || g.ownerId !== ownerId) return null;
    return structuredClone(g);
  }

  async findGiftBySlug(slug: string): Promise<{ id: string; ownerId: string } | null> {
    for (const g of this.gifts.values()) {
      if (g.slug === slug) return { id: g.id, ownerId: g.ownerId };
    }
    return null;
  }

  async saveGift(gift: StoredGiftRecord): Promise<StoredGiftRecord> {
    const copy = structuredClone(gift);
    this.gifts.set(copy.id, copy);
    return structuredClone(copy);
  }

  async deleteGift(ownerId: string, giftId: string): Promise<boolean> {
    const g = this.gifts.get(giftId);
    if (!g || g.ownerId !== ownerId) return false;
    this.gifts.delete(giftId);
    this.publications.delete(giftId);
    for (const [id, asset] of this.assets.entries()) {
      if (asset.giftId === giftId) {
        this.assets.delete(id);
        this.assetBytes.delete(asset.storagePath);
      }
    }
    return true;
  }

  async listGiftAssets(ownerId: string, giftId: string): Promise<StoredAsset[]> {
    return [...this.assets.values()]
      .filter((a) => a.ownerId === ownerId && a.giftId === giftId)
      .map((a) => structuredClone(a));
  }

  async getAssetById(ownerId: string, giftId: string, assetId: string): Promise<StoredAsset | null> {
    const a = this.assets.get(assetId);
    if (!a || a.ownerId !== ownerId || a.giftId !== giftId) return null;
    return structuredClone(a);
  }

  async getAssetsByIds(assetIds: string[]): Promise<Map<string, StoredAsset>> {
    const map = new Map<string, StoredAsset>();
    for (const id of assetIds) {
      const a = this.assets.get(id);
      if (a) map.set(id, structuredClone(a));
    }
    return map;
  }

  async uploadAssetBytes(asset: StoredAsset, bytes: Uint8Array): Promise<void> {
    this.assets.set(asset.id, structuredClone(asset));
    this.assetBytes.set(asset.storagePath, new Uint8Array(bytes));
  }

  async deleteAssetObjects(storagePaths: string[]): Promise<void> {
    for (const p of storagePaths) {
      this.assetBytes.delete(p);
    }
  }

  async createSignedAssetUrls(
    storagePaths: string[],
    expiresInSeconds: number
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const p of storagePaths) {
      if (this.assetBytes.has(p)) {
        map.set(
          p,
          `https://demo.supabase.co/storage/v1/object/sign/gift-assets/${p}?token=mock-${expiresInSeconds}`
        );
      }
    }
    return map;
  }

  async getPublicationByGiftId(giftId: string): Promise<StoredPublicationRecord | null> {
    const p = this.publications.get(giftId);
    return p ? structuredClone(p) : null;
  }

  async getPublicationBySlugOrId(slugOrId: string): Promise<StoredPublicationRecord | null> {
    const direct = this.publications.get(slugOrId);
    if (direct) return structuredClone(direct);
    for (const p of this.publications.values()) {
      if (p.slug === slugOrId) return structuredClone(p);
    }
    return null;
  }

  async upsertPublication(pub: StoredPublicationRecord): Promise<void> {
    this.publications.set(pub.giftId, structuredClone(pub));
  }

  async deactivatePublication(giftId: string, nextVersion: number): Promise<void> {
    const existing = this.publications.get(giftId);
    if (existing) {
      existing.isActive = false;
      existing.version = nextVersion;
    }
  }

  async recordUnlockAttempt(
    giftId: string,
    ipHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attemptCount: number }> {
    const key = `${giftId}:${ipHash}`;
    const now = Date.now();
    const existing = this.attempts.get(key);
    if (existing && existing.untilMs > now && existing.count >= maxAttempts) {
      return { allowed: false, attemptCount: existing.count };
    }
    const next =
      !existing || existing.untilMs <= now
        ? { count: 1, untilMs: now + windowSeconds * 1000 }
        : { count: existing.count + 1, untilMs: existing.untilMs };
    this.attempts.set(key, next);
    return { allowed: true, attemptCount: next.count };
  }

  async clearUnlockAttempts(giftId: string, ipHash: string): Promise<void> {
    this.attempts.delete(`${giftId}:${ipHash}`);
  }
}
