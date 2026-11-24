import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import {
  signUnlockToken,
  UNLOCK_SESSION_TTL_SECONDS,
  unlockCookieName,
  verifyUnlockToken,
} from '../lib/session.ts';
import { MAX_ASSET_BYTES, validateUploadedImage } from '../lib/server/file-validation.ts';
import { GiftService, MemoryGiftStore, ServiceError } from '../lib/server/gifts-service.ts';

const SECRET = 'test-session-secret-for-donjai-32bytes';

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function webpBytes(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

function makeDraft(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    template: 'anniversary' as const,
    recipient: 'มายด์',
    sender: 'ต้น',
    title: '365 วันที่มีเธอ',
    subtitle: 'ขอบคุณที่อยู่ด้วยกัน',
    color: 'rose' as const,
    cover: '/images/couple.jpg',
    updatedAt: new Date(1700000000000).toISOString(),
    blocks: [
      {
        id: crypto.randomUUID(),
        type: 'letter' as const,
        title: 'จดหมาย',
        text: 'ข้อความลับเฉพาะเราสองคน',
      },
    ],
    ...overrides,
  };
}

test('PBKDF2 password hashing uses random salt and verifies in constant time', async () => {
  const hashA = await hashPassword('140267');
  const hashB = await hashPassword('140267');

  assert.ok(hashA.startsWith('pbkdf2_sha256$210000$'));
  assert.notEqual(hashA, hashB);
  assert.equal(await verifyPassword('140267', hashA), true);
  assert.equal(await verifyPassword('wrong-code', hashA), false);
  assert.equal(await verifyPassword('140267', 'tampered$hash'), false);
});

test('HMAC unlock tokens enforce signature, giftId, version, and expiry', async () => {
  const giftId = crypto.randomUUID();
  const nowSec = 1700000000;
  const token = await signUnlockToken(
    { giftId, version: 2, exp: nowSec + UNLOCK_SESSION_TTL_SECONDS },
    SECRET
  );

  assert.equal(
    await verifyUnlockToken(token, { giftId, version: 2, nowMs: nowSec * 1000 }, SECRET),
    true
  );
  assert.equal(
    await verifyUnlockToken(token, { giftId, version: 3, nowMs: nowSec * 1000 }, SECRET),
    false
  );
  assert.equal(
    await verifyUnlockToken(
      token,
      { giftId: crypto.randomUUID(), version: 2, nowMs: nowSec * 1000 },
      SECRET
    ),
    false
  );
  assert.equal(
    await verifyUnlockToken(
      token,
      { giftId, version: 2, nowMs: (nowSec + UNLOCK_SESSION_TTL_SECONDS + 1) * 1000 },
      SECRET
    ),
    false
  );
  assert.equal(
    await verifyUnlockToken(token + 'x', { giftId, version: 2, nowMs: nowSec * 1000 }, SECRET),
    false
  );
  assert.match(unlockCookieName(giftId), /^donjai_unlock_[a-zA-Z0-9]+$/);
});

test('image validation checks magic bytes and rejects disguised or oversized files', () => {
  assert.deepEqual(validateUploadedImage(jpegBytes(), 'image/jpeg'), {
    mime: 'image/jpeg',
    ext: 'jpg',
  });
  assert.deepEqual(validateUploadedImage(pngBytes(), 'image/png'), {
    mime: 'image/png',
    ext: 'png',
  });
  assert.deepEqual(validateUploadedImage(webpBytes(), 'image/webp'), {
    mime: 'image/webp',
    ext: 'webp',
  });

  const textPayload = new TextEncoder().encode('<script>alert(1)</script>');
  assert.throws(() => validateUploadedImage(textPayload, 'image/jpeg'));
  assert.throws(() => validateUploadedImage(pngBytes(), 'image/jpeg'));

  const oversized = new Uint8Array(MAX_ASSET_BYTES + 1);
  oversized.set(jpegBytes(), 0);
  assert.throws(() => validateUploadedImage(oversized, 'image/jpeg'));
});

test('GiftService enforces owner isolation, asset signed URLs, snapshot isolation, rate limit, and unpublish revocation', async () => {
  const store = new MemoryGiftStore();
  const service = new GiftService(store);
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();

  const draft = makeDraft();
  const saved = await service.saveOwnerGift(ownerA, draft.id, draft);
  assert.equal(saved.id, draft.id);
  assert.ok(saved.slug);

  // AC-05: Another creator cannot read, edit, delete, or publish ownerA's gift
  await assert.rejects(
    () => service.getOwnerGift(ownerB, draft.id),
    (err: unknown) => err instanceof ServiceError && err.status === 403
  );
  await assert.rejects(
    () => service.saveOwnerGift(ownerB, draft.id, draft),
    (err: unknown) => err instanceof ServiceError && err.status === 403
  );
  await assert.rejects(
    () => service.deleteOwnerGift(ownerB, draft.id),
    (err: unknown) => err instanceof ServiceError && err.status === 403
  );

  // Stale timestamp rejected with 409
  await assert.rejects(
    () =>
      service.saveOwnerGift(ownerA, draft.id, {
        ...draft,
        updatedAt: new Date(1600000000000).toISOString(),
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  // Private Storage asset upload & attachment
  const uploaded = await service.uploadAsset(ownerA, draft.id, jpegBytes(), 'image/jpeg');
  assert.match(uploaded.signedUrl, /\/storage\/v1\/object\/sign\/gift-assets\//);

  const photoBlockId = crypto.randomUUID();
  const updatedDraft = await service.saveOwnerGift(ownerA, draft.id, {
    ...draft,
    cover: uploaded.signedUrl,
    coverAssetId: uploaded.assetId,
    updatedAt: new Date(1700000010000).toISOString(),
    blocks: [
      draft.blocks[0],
      {
        id: photoBlockId,
        type: 'photo',
        title: 'รูปคู่',
        text: 'ความทรงจำ',
        image: uploaded.signedUrl,
        imageAssetId: uploaded.assetId,
      },
    ],
  });
  assert.equal(updatedDraft.coverAssetId, uploaded.assetId);

  // Publish with password
  const pub = await service.publishGift(ownerA, draft.id, {
    password: '140267',
    hint: 'วันวาเลนไทน์',
  });
  assert.match(pub.url, /^\/g\//);

  // AC-06: Draft edit does NOT change published snapshot until republish
  await service.saveOwnerGift(ownerA, draft.id, {
    ...updatedDraft,
    title: 'ชื่อฉบับร่างใหม่ที่ยังไม่เผยแพร่',
    updatedAt: new Date(1700000020000).toISOString(),
  });

  // AC-04: Locked response hides snapshot content & signed URLs
  const lockedOpen = await service.openGift(pub.slug, { sessionSecret: SECRET });
  assert.equal(lockedOpen.locked, true);
  assert.equal(lockedOpen.hint, 'วันวาเลนไทน์');
  const serializedLocked = JSON.stringify(lockedOpen);
  assert.equal(serializedLocked.includes('ข้อความลับเฉพาะเราสองคน'), false);
  assert.equal(serializedLocked.includes('gift-assets'), false);

  // Rate limit: 5 wrong guesses allowed (401), 6th blocked (429)
  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () =>
        service.unlockGift(pub.slug, {
          password: 'wrong',
          ip: '203.0.113.10',
          sessionSecret: SECRET,
        }),
      (err: unknown) => err instanceof ServiceError && err.status === 401
    );
  }
  await assert.rejects(
    () =>
      service.unlockGift(pub.slug, {
        password: '140267',
        ip: '203.0.113.10',
        sessionSecret: SECRET,
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 429
  );

  // Valid IP unlocks & receives signed cookie + published snapshot (still old title)
  const unlocked = await service.unlockGift(pub.slug, {
    password: '140267',
    ip: '203.0.113.20',
    sessionSecret: SECRET,
  });
  assert.equal(unlocked.gift.title, '365 วันที่มีเธอ');
  assert.match(unlocked.gift.cover, /\/storage\/v1\/object\/sign\/gift-assets\//);
  assert.ok(unlocked.token);

  // Repeat open with cookie succeeds without password
  const repeatOpen = await service.openGift(pub.slug, {
    unlockCookieToken: unlocked.token,
    sessionSecret: SECRET,
  });
  assert.equal(repeatOpen.locked, false);

  // Changing password invalidates older unlock cookies
  await service.publishGift(ownerA, draft.id, {
    password: 'new-secret-99',
    hint: 'รหัสใหม่',
  });
  const oldCookieAfterPasswordChange = await service.openGift(pub.slug, {
    unlockCookieToken: unlocked.token,
    sessionSecret: SECRET,
  });
  assert.equal(oldCookieAfterPasswordChange.locked, true);

  const unlockedNew = await service.unlockGift(pub.slug, {
    password: 'new-secret-99',
    ip: '203.0.113.20',
    sessionSecret: SECRET,
  });

  // AC-08: Unpublishing rejects both fresh requests AND previously unlocked sessions
  await service.unpublishGift(ownerA, draft.id);
  await assert.rejects(
    () =>
      service.openGift(pub.slug, {
        unlockCookieToken: unlockedNew.token,
        sessionSecret: SECRET,
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 404
  );
  await assert.rejects(
    () =>
      service.unlockGift(pub.slug, {
        password: 'new-secret-99',
        ip: '203.0.113.20',
        sessionSecret: SECRET,
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 404
  );
});
