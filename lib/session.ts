export const UNLOCK_SESSION_TTL_SECONDS = 7200;

export interface UnlockTokenPayload {
  giftId: string;
  version: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error('Missing session secret');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function unlockCookieName(giftId: string): string {
  const clean = giftId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'gift';
  return `donjai_unlock_${clean}`;
}

export async function signUnlockToken(payload: UnlockTokenPayload, secret: string): Promise<string> {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  );
  return `${encodedPayload}.${toBase64Url(sig)}`;
}

export async function verifyUnlockToken(
  token: string | undefined | null,
  expected: { giftId: string; version: number; nowMs?: number },
  secret: string
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;

  const encodedPayload = token.slice(0, dot);
  const encodedSig = token.slice(dot + 1);

  try {
    const key = await importHmacKey(secret);
    const expectedSig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
    );
    const actualSig = fromBase64Url(encodedSig);
    if (!timingSafeEqual(actualSig, expectedSig)) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as Partial<UnlockTokenPayload>;
    const nowSec = Math.floor((expected.nowMs ?? Date.now()) / 1000);
    if (
      payload.giftId !== expected.giftId ||
      payload.version !== expected.version ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSec
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function hashClientIp(ip: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`ip:${ip}`))
  );
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}
