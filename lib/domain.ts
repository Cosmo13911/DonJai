export type Template = 'anniversary' | 'birthday' | 'letter';
export type BlockType = 'letter' | 'photo' | 'timeline' | 'game';

export interface Block {
  id: string;
  type: BlockType;
  title: string;
  text: string;
  image?: string;
  imageAssetId?: string;
  date?: string;
}

export interface Gift {
  id: string;
  slug?: string;
  template: Template;
  recipient: string;
  sender: string;
  title: string;
  subtitle: string;
  color: 'rose' | 'sage' | 'lilac';
  cover: string;
  coverAssetId?: string;
  blocks: Block[];
  updatedAt: string;
  publishedAt?: string;
  passwordProtected?: boolean;
  hint?: string;
}

export interface MatchState {
  open: number[];
  matched: number[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{4,80}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function generateSlug(title?: string): string {
  const asciiPrefix = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  const randomBytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(randomBytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8);
  const prefix = asciiPrefix.length >= 2 ? asciiPrefix : 'donjai';
  return `${prefix}-${suffix}`;
}

export function safeImage(src: unknown): boolean {
  return (
    typeof src === 'string' &&
    (src === '' ||
      /^\/images\/[a-zA-Z0-9_.-]+$/.test(src) ||
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ||
      /^https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/sign\/gift-assets\/[^\s"'<>]+$/i.test(src) ||
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/storage\/v1\/object\/sign\/gift-assets\/[^\s"'<>]+$/i.test(
        src
      ))
  );
}

export function validateGift(value: unknown): Gift {
  const g = value as Gift;
  if (
    !g ||
    !['anniversary', 'birthday', 'letter'].includes(g.template) ||
    typeof g.id !== 'string' ||
    !g.id.trim() ||
    g.id.length > 80
  ) {
    throw new Error('ข้อมูลของขวัญไม่ถูกต้อง');
  }
  if (g.slug !== undefined && g.slug !== '' && (typeof g.slug !== 'string' || !SLUG_RE.test(g.slug))) {
    throw new Error('รหัสลิงก์ของขวัญไม่ถูกต้อง');
  }
  for (const k of ['recipient', 'sender', 'title'] as const) {
    if (typeof g[k] !== 'string' || !g[k].trim() || g[k].length > 200) {
      throw new Error('กรุณาใส่ชื่อผู้รับ ผู้ส่ง และหัวข้อ');
    }
  }
  if (
    typeof g.subtitle !== 'string' ||
    g.subtitle.length > 2000 ||
    !['rose', 'sage', 'lilac'].includes(g.color) ||
    typeof g.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(g.updatedAt))
  ) {
    throw new Error('ข้อความ ธีม หรือวันที่แก้ไขไม่ถูกต้อง');
  }
  if (g.cover !== undefined && !safeImage(g.cover)) {
    throw new Error('รูปหน้าปกไม่ถูกต้อง');
  }
  if (g.coverAssetId !== undefined && g.coverAssetId !== '' && !isUuid(g.coverAssetId)) {
    throw new Error('รหัสรูปหน้าปกไม่ถูกต้อง');
  }
  if (!Array.isArray(g.blocks) || g.blocks.length > 20 || g.blocks.length === 0) {
    throw new Error('เพิ่มเนื้อหาอย่างน้อย 1 บล็อก และไม่เกิน 20 บล็อก');
  }
  const ids = new Set<string>();
  for (const b of g.blocks) {
    if (
      !b ||
      typeof b.id !== 'string' ||
      !b.id.trim() ||
      b.id.length > 80 ||
      ids.has(b.id) ||
      !['letter', 'photo', 'timeline', 'game'].includes(b.type) ||
      typeof b.title !== 'string' ||
      typeof b.text !== 'string' ||
      b.title.length > 200 ||
      b.text.length > 10000
    ) {
      throw new Error('เนื้อหาบล็อกไม่ถูกต้อง');
    }
    if (b.image !== undefined && !safeImage(b.image)) {
      throw new Error('รูปภาพไม่ถูกต้อง');
    }
    if (b.imageAssetId !== undefined && b.imageAssetId !== '' && !isUuid(b.imageAssetId)) {
      throw new Error('รหัสรูปภาพไม่ถูกต้อง');
    }
    if (
      b.date !== undefined &&
      b.date !== '' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date)))
    ) {
      throw new Error('วันที่ไม่ถูกต้อง');
    }
    ids.add(b.id);
  }
  if (JSON.stringify(g).length > 6500000) {
    throw new Error('ของขวัญใหญ่เกิน 6 MB กรุณาลดจำนวนรูป');
  }
  return g;
}

export function publishSnapshot(g: Gift): Gift {
  validateGift(g);
  return structuredClone({ ...g, publishedAt: new Date().toISOString() });
}

export function matchTurn(s: MatchState, index: number, cards: string[]): MatchState {
  if (
    index < 0 ||
    index >= cards.length ||
    s.open.length === 2 ||
    s.open.includes(index) ||
    s.matched.includes(index)
  ) {
    return s;
  }
  const open = [...s.open, index];
  if (open.length === 2 && cards[open[0]] === cards[index]) {
    return { open: [], matched: [...s.matched, ...open] };
  }
  return { ...s, open };
}
