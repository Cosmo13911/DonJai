'use client';
import { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Check,
  CloudOff,
  LoaderCircle,
  Undo2,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Mail,
  Image,
  CalendarHeart,
  Gamepad2,
  Upload,
  Smartphone,
  Palette,
  LockKeyhole,
  Copy,
  ExternalLink,
  Heart,
  Globe,
  Download,
  LogIn,
} from 'lucide-react';
import type { Gift, Block, BlockType } from '../lib/domain';
import { validateGift } from '../lib/domain';
import { blockNames } from '../lib/templates';
import {
  api,
  ApiError,
  hasPendingInlineImages,
  imageData,
  localSave,
  saveGift,
  stripPendingDataUrls,
  syncPendingInlineImages,
  uploadGiftAsset,
  type AuthUser,
} from '../lib/client';
import { Button, Modal } from './ui';
import GiftView from './GiftView';
import { downloadGift } from './Dashboard';
import { StepScene, MagicBurst } from './Motion';

const icons = { letter: Mail, photo: Image, timeline: CalendarHeart, game: Gamepad2 };

function BlockRow({
  block,
  selected,
  onSelect,
  onMove,
  onRemove,
  first,
  last,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  onMove: (n: number) => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: block.id,
  });
  const Icon = icons[block.type];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`block-row ${selected ? 'selected' : ''}`}
    >
      <button
        className="drag-handle"
        {...attributes}
        {...listeners}
        aria-label={`ลากเรียง ${blockNames[block.type]}`}
      >
        <GripVertical size={17} />
      </button>
      <button className="block-select" onClick={onSelect}>
        <Icon size={17} />
        <span>
          {block.title || blockNames[block.type]}
          <small>{blockNames[block.type]}</small>
        </span>
      </button>
      <div className="block-row-actions">
        <button disabled={first} onClick={() => onMove(-1)} aria-label="เลื่อนขึ้น">
          <ChevronUp size={14} />
        </button>
        <button disabled={last} onClick={() => onMove(1)} aria-label="เลื่อนลง">
          <ChevronDown size={14} />
        </button>
        <button onClick={onRemove} aria-label="ลบบล็อก" className="danger">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default function Editor({
  initial,
  user,
  authConfigured,
  skipUnmountSaveRef,
  onExit,
  onToast,
  onRequireAuth,
}: {
  initial: Gift;
  user: AuthUser | null;
  authConfigured: boolean;
  skipUnmountSaveRef?: { current: boolean };
  onExit: () => void;
  onToast: (s: string) => void;
  onRequireAuth: () => void;
}) {
  const [gift, setGift] = useState<Gift>(initial);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(initial.blocks[0]?.id || '');
  const [status, setStatus] = useState<'saving' | 'saved' | 'local' | 'error'>('saving');
  const [preview, setPreview] = useState(false);
  const [add, setAdd] = useState(false);
  const [mobileTab, setMobileTab] = useState('edit');
  const [history, setHistory] = useState<Gift[]>([]);
  const [password, setPassword] = useState('');
  const [protectedGift, setProtectedGift] = useState(Boolean(initial.passwordProtected));
  const [keepExistingPassword, setKeepExistingPassword] = useState(
    Boolean(initial.passwordProtected)
  );
  const [hint, setHint] = useState(initial.hint || '');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [savedReason, setSavedReason] = useState('');

  const input = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef('cover');
  const saveVersion = useRef(0);
  const giftRef = useRef(gift);
  giftRef.current = gift;
  const userRef = useRef(user);
  userRef.current = user;
  const initialUserIdRef = useRef(user?.id || null);
  const authConfiguredRef = useRef(authConfigured);
  authConfiguredRef.current = authConfigured;
  const lastRemoteSyncedAt = useRef('');
  const publicationBusy = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (initialUserIdRef.current && !user) return;
    setStatus('saving');
    const version = ++saveVersion.current;
    void localSave(gift).catch(() => setStatus('error'));

    const timer = setTimeout(async () => {
      if (initialUserIdRef.current && !userRef.current) return;
      try {
        await localSave(gift);
        if (!user || !authConfigured) {
          if (version === saveVersion.current) {
            setStatus('local');
            setSavedReason(
              authConfigured
                ? 'บันทึกในเครื่องแล้ว (เข้าสู่ระบบเพื่อซิงก์ออนไลน์)'
                : 'บันทึกในเครื่องแล้ว (ยังไม่ได้เชื่อมต่อ Supabase)'
            );
          }
          return;
        }

        if (lastRemoteSyncedAt.current === gift.updatedAt && !hasPendingInlineImages(gift)) {
          if (version === saveVersion.current) {
            setStatus('saved');
            setSavedReason('');
          }
          return;
        }

        try {
          let synced: Gift;
          if (hasPendingInlineImages(gift)) {
            synced = await syncPendingInlineImages(gift);
            if (version !== saveVersion.current) return;
            lastRemoteSyncedAt.current = synced.updatedAt;
            giftRef.current = synced;
            setGift(synced);
            await localSave(synced);
          } else {
            synced = await saveGift(gift);
            if (version !== saveVersion.current) return;
            if (synced.slug && synced.slug !== giftRef.current.slug) {
              const merged = { ...giftRef.current, slug: synced.slug };
              lastRemoteSyncedAt.current = merged.updatedAt;
              giftRef.current = merged;
              setGift(merged);
              await localSave(merged);
            } else {
              lastRemoteSyncedAt.current = gift.updatedAt;
            }
          }
          setStatus('saved');
          setSavedReason('');
        } catch (e) {
          if (version === saveVersion.current) {
            setStatus('local');
            setSavedReason(e instanceof Error ? e.message : 'ออฟไลน์');
          }
        }
      } catch {
        setStatus('error');
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [gift, user, authConfigured]);

  useEffect(
    () => () => {
      if (skipUnmountSaveRef?.current || (initialUserIdRef.current && !userRef.current)) return;
      const latest = giftRef.current;
      void localSave(latest)
        .then(() => {
          if (
            userRef.current &&
            authConfiguredRef.current &&
            !hasPendingInlineImages(latest)
          ) {
            return saveGift(latest);
          }
          return undefined;
        })
        .catch(() => {});
    },
    []
  );

  function update(fn: (g: Gift) => Gift) {
    const current = giftRef.current;
    const next = { ...fn(current), updatedAt: new Date().toISOString() };
    giftRef.current = next;
    setHistory((h) => [...h.slice(-9), structuredClone(current)]);
    setGift(next);
    setError('');
  }

  function field(key: keyof Gift, value: string) {
    update((g) => ({ ...g, [key]: value }));
  }

  function editBlock(patch: Partial<Block>) {
    update((g) => ({
      ...g,
      blocks: g.blocks.map((b) => (b.id === selected ? { ...b, ...patch } : b)),
    }));
  }

  function move(id: string, delta: number) {
    const index = gift.blocks.findIndex((b) => b.id === id);
    if (index + delta < 0 || index + delta >= gift.blocks.length) return;
    update((g) => ({ ...g, blocks: arrayMove(g.blocks, index, index + delta) }));
  }

  function drag(e: DragEndEvent) {
    if (e.over && e.active.id !== e.over.id) {
      const a = gift.blocks.findIndex((b) => b.id === e.active.id);
      const b = gift.blocks.findIndex((b) => b.id === e.over!.id);
      update((g) => ({ ...g, blocks: arrayMove(g.blocks, a, b) }));
    }
  }

  function addBlock(type: BlockType) {
    if (gift.blocks.length >= 20) {
      onToast('เพิ่มได้สูงสุด 20 บล็อก');
      return;
    }
    const id = crypto.randomUUID();
    update((g) => ({
      ...g,
      blocks: [
        ...g.blocks,
        {
          id,
          type,
          title: blockNames[type],
          text:
            type === 'game'
              ? 'แตะการ์ดเพื่อหาคู่ความทรงจำของเรา'
              : 'เขียนเรื่องราวของคุณตรงนี้…',
          ...(type === 'timeline' ? { date: new Date().toISOString().slice(0, 10) } : {}),
        },
      ],
    }));
    setSelected(id);
    setAdd(false);
  }

  async function upload(file: File) {
    const target = uploadTarget.current;
    setUploading(true);
    try {
      if (user && authConfigured) {
        try {
          await saveGift(stripPendingDataUrls(giftRef.current));
          const uploaded = await uploadGiftAsset(giftRef.current.id, file);
          if (target === 'cover') {
            update((g) => ({ ...g, cover: uploaded.signedUrl, coverAssetId: uploaded.assetId }));
          } else {
            update((g) => ({
              ...g,
              blocks: g.blocks.map((b) =>
                b.id === target
                  ? { ...b, image: uploaded.signedUrl, imageAssetId: uploaded.assetId }
                  : b
              ),
            }));
          }
          onToast('อัปโหลดรูปเข้าคลังส่วนตัวเรียบร้อย ♡');
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status !== 503 && err.status < 500) {
            throw err;
          }
          // Fall back to local IndexedDB encoding when offline or service unavailable.
        }
      }

      const data = await imageData(file);
      if (JSON.stringify(giftRef.current).length + data.length > 6500000) {
        throw new Error('รูปทั้งหมดเกิน 6 MB กรุณาลบบางรูปก่อน');
      }
      if (target === 'cover') {
        update((g) => ({ ...g, cover: data, coverAssetId: undefined }));
      } else {
        update((g) => ({
          ...g,
          blocks: g.blocks.map((b) =>
            b.id === target ? { ...b, image: data, imageAssetId: undefined } : b
          ),
        }));
      }
      onToast(
        user
          ? 'ออฟไลน์: บันทึกรูปในเครื่องชั่วคราวแล้ว ♡'
          : 'บันทึกรูปในฉบับร่างเครื่องนี้แล้ว ♡'
      );
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function publish() {
    if (publicationBusy.current) return;
    if (!user) {
      onRequireAuth();
      return;
    }

    publicationBusy.current = true;
    setError('');
    try {
      validateGift(giftRef.current);
      const usingExistingPass = Boolean(
        protectedGift && !password && keepExistingPassword && giftRef.current.passwordProtected
      );
      if (protectedGift && !usingExistingPass && password.length < 4) {
        throw new Error('กรุณาตั้งรหัสอย่างน้อย 4 ตัวอักษร');
      }

      setPublishing(true);
      const synced = hasPendingInlineImages(giftRef.current)
        ? await syncPendingInlineImages(giftRef.current)
        : await saveGift(giftRef.current);

      lastRemoteSyncedAt.current = synced.updatedAt;
      giftRef.current = synced;
      setGift(synced);
      await localSave(synced);

      const result = await api<{ gift: Gift; slug: string; url: string }>(
        '/gifts/' + synced.id + '/publish',
        'POST',
        {
          password: protectedGift ? password : '',
          hint,
          keepExistingPassword: usingExistingPass,
        }
      );

      const next: Gift = {
        ...giftRef.current,
        slug: result.slug || result.gift.slug || giftRef.current.slug,
        publishedAt: result.gift.publishedAt,
        passwordProtected: result.gift.passwordProtected,
        hint: result.gift.hint,
      };
      lastRemoteSyncedAt.current = next.updatedAt;
      giftRef.current = next;
      setGift(next);
      setPassword('');
      setKeepExistingPassword(Boolean(next.passwordProtected));
      await localSave(next);
      setPublished(true);
      onToast('ของขวัญพร้อมส่งแล้ว ♡');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เผยแพร่ไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setPublishing(false);
      publicationBusy.current = false;
    }
  }

  async function unpublish() {
    if (publicationBusy.current) return;
    publicationBusy.current = true;
    setPublishing(true);
    try {
      await api('/gifts/' + gift.id + '/publish', 'DELETE');
      const next: Gift = {
        ...giftRef.current,
        publishedAt: undefined,
        passwordProtected: false,
      };
      lastRemoteSyncedAt.current = next.updatedAt;
      giftRef.current = next;
      setGift(next);
      setKeepExistingPassword(false);
      await localSave(next);
      setPublished(false);
      onToast('ยกเลิกเผยแพร่แล้ว ลิงก์จะไม่เปิดเนื้อหาใหม่');
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ');
    } finally {
      setPublishing(false);
      publicationBusy.current = false;
    }
  }

  const block = gift.blocks.find((b) => b.id === selected);
  const sharePath = gift.slug ? '/g/' + gift.slug : '/?gift=' + gift.id;
  const url = typeof window === 'undefined' ? '' : location.origin + sharePath;
  const stepNames = ['เริ่มด้วยคนพิเศษ', 'เติมความทรงจำ', 'แต่งให้เป็นคุณ', 'พร้อมส่งแล้ว'];

  return (
    <main className="editor-page">
      <div className="editor-top">
        <button
          className="text-link"
          onClick={async () => {
            try {
              await localSave(gift);
              onExit();
            } catch {
              onToast('บันทึกในเครื่องไม่สำเร็จ กรุณาดาวน์โหลดไฟล์สำรองก่อนออก');
            }
          }}
        >
          <ArrowLeft size={17} />
          <span>ของขวัญของฉัน</span>
        </button>
        <div className="editor-document-name">
          <Heart size={15} />
          <span>{gift.title}</span>
        </div>
        <span className={`save-state ${status}`} title={savedReason}>
          {status === 'saving' ? (
            <>
              <LoaderCircle className="spin" size={13} /> กำลังบันทึก
            </>
          ) : status === 'saved' ? (
            <>
              <Check size={13} /> บันทึกออนไลน์แล้ว
            </>
          ) : status === 'local' ? (
            <>
              <CloudOff size={13} /> บันทึกในเครื่อง
            </>
          ) : (
            <>
              <CloudOff size={13} /> บันทึกไม่สำเร็จ
            </>
          )}
        </span>
        <button
          className="icon-button"
          disabled={!history.length}
          onClick={() => {
            const prev = { ...history[history.length - 1], updatedAt: new Date().toISOString() };
            giftRef.current = prev;
            setGift(prev);
            setHistory((h) => h.slice(0, -1));
          }}
          title="ย้อนกลับ"
          aria-label="ย้อนกลับการแก้ไข"
        >
          <Undo2 size={18} />
        </button>
        <Button kind="secondary" onClick={() => setPreview(true)}>
          <Eye size={16} />
          <span>ลองเป็นผู้รับ</span>
        </Button>
      </div>

      <div className="editor-steps" aria-label="ขั้นตอนสร้างของขวัญ">
        {stepNames.map((name, i) => (
          <button
            key={name}
            disabled={publishing}
            onClick={() => {
              setStep(i);
              setMobileTab('edit');
            }}
            className={step === i ? 'active' : i < step ? 'done' : ''}
          >
            <span>{i < step ? <Check size={13} /> : i + 1}</span>
            <strong>{name}</strong>
          </button>
        ))}
      </div>

      <div className="editor-mobile-tabs">
        <button
          className={mobileTab === 'edit' ? 'active' : ''}
          onClick={() => setMobileTab('edit')}
        >
          แก้ไขของขวัญ
        </button>
        <button
          className={mobileTab === 'preview' ? 'active' : ''}
          onClick={() => setMobileTab('preview')}
        >
          <Smartphone size={15} /> พรีวิว
        </button>
      </div>

      <div className={`editor-workspace mobile-${mobileTab}`}>
        <section className="edit-panel">
          <StepScene key={step}>
            <div className="edit-panel-heading">
              <span className="small-label">ขั้นตอน {step + 1} / 4</span>
              <h1>{stepNames[step]}</h1>
              <p>
                {
                  [
                    'เริ่มจากชื่อของคนที่ทำให้คุณยิ้มได้',
                    'เลือกบล็อก แล้วเล่าเรื่องราวในแบบคุณ',
                    'เลือกสีและรูปหน้าปก ให้เป็นความรู้สึกของคุณ',
                    'ลองดูอีกครั้ง แล้วส่งให้คนที่คุณนึกถึง',
                  ][step]
                }
              </p>
            </div>

            {step === 0 && (
              <div className="form-stack">
                <div className="field-row">
                  <label>
                    ทำให้ใครดี?{' '}
                    <input
                      value={gift.recipient}
                      maxLength={100}
                      onChange={(e) => field('recipient', e.target.value)}
                      placeholder="ชื่อคนพิเศษ"
                    />
                  </label>
                  <label>
                    จากใคร?{' '}
                    <input
                      value={gift.sender}
                      maxLength={100}
                      onChange={(e) => field('sender', e.target.value)}
                      placeholder="ชื่อของคุณ"
                    />
                  </label>
                </div>
                <label>
                  ชื่อของขวัญ
                  <input
                    value={gift.title}
                    maxLength={120}
                    onChange={(e) => field('title', e.target.value)}
                    placeholder="เช่น 365 วัน ที่มีเธออยู่ข้าง ๆ"
                  />
                </label>
                <label>
                  ข้อความสั้น ๆ บนหน้าปก
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={gift.subtitle}
                    onChange={(e) => field('subtitle', e.target.value)}
                    placeholder="มีอะไรอยากบอกเขาก่อนเปิดของขวัญไหม?"
                  />
                </label>
                <div className="gentle-note">
                  <Heart size={19} />
                  <p>
                    ไม่ต้องเขียนให้เพอร์เฟกต์
                    <br />
                    <strong>แค่เป็นคำของคุณ ก็มีความหมายแล้ว</strong>
                  </p>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="content-editor">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={drag}
                >
                  <SortableContext
                    items={gift.blocks.map((b) => b.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="block-list">
                      {gift.blocks.map((b, i) => (
                        <BlockRow
                          key={b.id}
                          block={b}
                          selected={selected === b.id}
                          onSelect={() => setSelected(b.id)}
                          onMove={(n) => move(b.id, n)}
                          first={i === 0}
                          last={i === gift.blocks.length - 1}
                          onRemove={() => {
                            if (gift.blocks.length === 1) {
                              onToast('เก็บบล็อกไว้อย่างน้อย 1 บล็อกนะ');
                              return;
                            }
                            update((g) => ({
                              ...g,
                              blocks: g.blocks.filter((x) => x.id !== b.id),
                            }));
                            if (selected === b.id) {
                              setSelected(gift.blocks.find((x) => x.id !== b.id)!.id);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <Button kind="secondary" className="full" onClick={() => setAdd(true)}>
                  <Plus size={16} /> เพิ่มเรื่องราวอีกบล็อก
                </Button>

                {block && (
                  <div className="selected-block-form">
                    <div className="block-form-title">
                      {(() => {
                        const Icon = icons[block.type];
                        return <Icon size={18} />;
                      })()}
                      <strong>{blockNames[block.type]}</strong>
                    </div>
                    <label>
                      หัวข้อ
                      <input
                        value={block.title}
                        maxLength={150}
                        onChange={(e) => editBlock({ title: e.target.value })}
                      />
                    </label>
                    {block.type === 'timeline' && (
                      <label>
                        วันที่สำคัญ
                        <input
                          type="date"
                          value={block.date || ''}
                          onChange={(e) => editBlock({ date: e.target.value })}
                        />
                      </label>
                    )}
                    <label>
                      {block.type === 'letter'
                        ? 'ข้อความจากใจ'
                        : block.type === 'game'
                          ? 'คำชวนเล่น'
                          : 'ข้อความใต้ภาพ / เรื่องราว'}
                      <textarea
                        rows={block.type === 'letter' ? 8 : 3}
                        value={block.text}
                        maxLength={10000}
                        onChange={(e) => editBlock({ text: e.target.value })}
                      />
                    </label>
                    {['photo', 'timeline'].includes(block.type) && (
                      <div className="upload-box">
                        {block.image && <img src={block.image} alt="รูปในบล็อก" />}
                        <Button
                          kind="secondary"
                          busy={uploading}
                          onClick={() => {
                            uploadTarget.current = block.id;
                            input.current?.click();
                          }}
                        >
                          <Upload size={16} /> {block.image ? 'เปลี่ยนรูป' : 'เพิ่มรูปความทรงจำ'}
                        </Button>
                      </div>
                    )}
                    {block.type === 'game' && (
                      <div className="gentle-note">
                        <Gamepad2 size={22} />
                        <p>
                          เกมจับคู่ 3 คู่ พร้อมเล่นทันที
                          <br />
                          ไม่มีจับเวลา ผู้รับเลือกข้ามได้
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="form-stack">
                <label>เลือกสีของเรื่องราว</label>
                <div className="theme-options">
                  {[
                    ['rose', 'Rose', 'ชมพูอบอุ่น'],
                    ['sage', 'Sage', 'เขียวสบายใจ'],
                    ['lilac', 'Lilac', 'ม่วงละมุน'],
                  ].map(([id, name, desc]) => (
                    <button
                      key={id}
                      className={`theme-option ${id} ${gift.color === id ? 'selected' : ''}`}
                      onClick={() => field('color', id)}
                    >
                      <span>{gift.color === id && <Check size={16} />}</span>
                      <strong>{name}</strong>
                      <small>{desc}</small>
                    </button>
                  ))}
                </div>
                <label>รูปหน้าปกของเรา</label>
                <div className="cover-upload">
                  <img
                    src={gift.cover || '/images/couple.jpg'}
                    alt="รูปหน้าปกปัจจุบัน"
                  />
                  <Button
                    kind="secondary"
                    busy={uploading}
                    onClick={() => {
                      uploadTarget.current = 'cover';
                      input.current?.click();
                    }}
                  >
                    <Upload size={16} /> เปลี่ยนรูปหน้าปก
                  </Button>
                </div>
                <p className="field-help">
                  รองรับ JPG, PNG, WebP ไม่เกิน 10 MB ต่อรูป
                  <br />
                  ระบบย่อรูปให้อัตโนมัติ และเก็บรูปในคลังส่วนตัวเมื่อเข้าสู่ระบบ
                </p>
                <div className="gentle-note">
                  <Palette size={20} />
                  <p>
                    เทมเพลต{' '}
                    {gift.template === 'anniversary'
                      ? 'Our little story'
                      : gift.template === 'birthday'
                        ? 'Make a little wish'
                        : 'A letter, just for you'}
                    <br />
                    สีและรูปของคุณทำให้ทุกแบบไม่เหมือนใคร
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="form-stack">
                <div className="publish-checks">
                  <span>
                    <Check size={16} /> มีชื่อคนพิเศษและข้อความแล้ว
                  </span>
                  <span>
                    <Check size={16} /> {gift.blocks.length} บล็อกความทรงจำ
                  </span>
                  <button onClick={() => setPreview(true)}>
                    <Eye size={16} /> ลองเปิดเป็นผู้รับอีกครั้ง →
                  </button>
                </div>

                {!user && (
                  <div className="auth-banner compact">
                    <div>
                      <LogIn size={17} />
                      <span>
                        <strong>เข้าสู่ระบบก่อนเผยแพร่และสร้างลิงก์</strong>
                        <small>
                          {authConfigured
                            ? 'ฉบับร่างของคุณถูกบันทึกไว้ในเครื่องนี้แล้ว หลังเข้าสู่ระบบสามารถกดเผยแพร่ได้ทันที'
                            : 'ตั้งค่า Supabase ใน .env.local ก่อนจึงจะเผยแพร่ออนไลน์ได้ (ตอนนี้สามารถดาวน์โหลดสำรองเก็บไว้ได้)'}
                        </small>
                      </span>
                    </div>
                    {authConfigured && (
                      <Button kind="secondary" onClick={onRequireAuth}>
                        เข้าสู่ระบบ
                      </Button>
                    )}
                  </div>
                )}

                <div className="password-setting">
                  <div>
                    <LockKeyhole size={19} />
                    <span>
                      <strong>รหัสลับของเรา</strong>
                      <small>ให้เรื่องราวนี้มีแค่เราที่รู้</small>
                    </span>
                    <button
                      role="switch"
                      aria-label="เปิดใช้รหัสผ่าน"
                      aria-checked={protectedGift}
                      className={`toggle ${protectedGift ? 'on' : ''}`}
                      onClick={() => {
                        const next = !protectedGift;
                        setProtectedGift(next);
                        if (!next) setKeepExistingPassword(false);
                        else if (gift.passwordProtected) setKeepExistingPassword(true);
                      }}
                    >
                      <span />
                    </button>
                  </div>
                  {protectedGift && (
                    <div className="form-stack">
                      {gift.passwordProtected && (
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={keepExistingPassword && !password}
                            onChange={(e) => {
                              setKeepExistingPassword(e.target.checked);
                              if (e.target.checked) setPassword('');
                            }}
                          />
                          <span>ใช้รหัสผ่านเดิมต่อ (หรือพิมพ์รหัสใหม่ด้านล่างเพื่อเปลี่ยน)</span>
                        </label>
                      )}
                      <label>
                        {gift.passwordProtected ? 'รหัสผ่านใหม่ (ไม่บังคับหากใช้รหัสเดิม)' : 'รหัสเปิดของขวัญ'}
                        <input
                          type="password"
                          value={password}
                          minLength={4}
                          maxLength={128}
                          autoComplete="new-password"
                          placeholder={
                            gift.passwordProtected && keepExistingPassword
                              ? 'เว้นว่างไว้เพื่อใช้รหัสเดิม'
                              : 'อย่างน้อย 4 ตัวอักษร'
                          }
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (e.target.value) setKeepExistingPassword(false);
                          }}
                        />
                      </label>
                      <label>
                        คำใบ้เล็ก ๆ
                        <input
                          value={hint}
                          maxLength={300}
                          placeholder="เช่น วันที่เราเจอกันครั้งแรก"
                          onChange={(e) => setHint(e.target.value)}
                        />
                      </label>
                      <p className="field-help">
                        รหัสผ่านถูกเข้ารหัสแบบทางเดียวบนเซิร์ฟเวอร์ ไม่สามารถดูรหัสเดิมย้อนหลังได้
                      </p>
                    </div>
                  )}
                </div>

                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}

                <Button
                  busy={publishing}
                  className="full publish-button"
                  onClick={publish}
                  disabled={!authConfigured}
                >
                  <Heart size={17} />{' '}
                  {!user
                    ? 'เข้าสู่ระบบเพื่อเผยแพร่'
                    : gift.publishedAt
                      ? 'เผยแพร่เวอร์ชันใหม่'
                      : 'เผยแพร่และสร้างลิงก์'}{' '}
                  <ArrowRight size={17} />
                </Button>

                <p className="field-help">
                  ฉบับร่างแยกจากสิ่งที่เผยแพร่
                  <br />
                  ผู้รับจะเห็นการแก้ไขเมื่อคุณกดเผยแพร่ใหม่เท่านั้น
                </p>

                {gift.publishedAt && (
                  <div className="published-box">
                    <span>
                      <Globe size={15} /> ของขวัญนี้เผยแพร่แล้ว
                    </span>
                    <label className="sr-only" htmlFor="gift-link">
                      ลิงก์ของขวัญ
                    </label>
                    <input
                      id="gift-link"
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                    />
                    <div className="button-row">
                      <Button
                        kind="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(url);
                            onToast('คัดลอกลิงก์แล้ว พร้อมส่งให้คนพิเศษ ♡');
                          } catch {
                            onToast('แตะช่องลิงก์เพื่อเลือกและคัดลอก');
                          }
                        }}
                      >
                        <Copy size={15} /> คัดลอกลิงก์
                      </Button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="button ghost"
                      >
                        <ExternalLink size={15} /> เปิดดู
                      </a>
                    </div>
                    <button className="text-link danger" onClick={unpublish}>
                      ยกเลิกเผยแพร่
                    </button>
                  </div>
                )}

                <button className="text-link" onClick={() => downloadGift(gift)}>
                  <Download size={15} /> ดาวน์โหลดไฟล์สำรองของขวัญ
                </button>
              </div>
            )}

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              ref={input}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />

            <div className="editor-step-footer">
              {step > 0 ? (
                <Button kind="ghost" onClick={() => setStep(step - 1)}>
                  <ArrowLeft size={16} /> ย้อนกลับ
                </Button>
              ) : (
                <span />
              )}
              {step < 3 && (
                <Button
                  onClick={() => {
                    setStep(step + 1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  {['ถัดไป: เติมความทรงจำ', 'ถัดไป: เลือกสีและรูป', 'ถัดไป: เตรียมส่ง'][step]}{' '}
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          </StepScene>
        </section>

        <aside className="live-preview">
          <div className="live-preview-heading">
            <span>
              <Smartphone size={16} /> พรีวิวของคนพิเศษ
            </span>
            <small>
              <i /> เปลี่ยนตามที่คุณแก้
            </small>
          </div>
          <div className="preview-phone">
            <div className="phone-notch" />
            <div className="preview-scroll">
              <GiftView gift={gift} compact />
            </div>
          </div>
          <span className="preview-footnote">แตะ “ลองเป็นผู้รับ” เพื่อดูเต็มหน้าจอ</span>
        </aside>
      </div>

      {preview && (
        <Modal title="ลองเปิดเป็นคนพิเศษของคุณ" onClose={() => setPreview(false)}>
          <GiftView gift={gift} />
        </Modal>
      )}

      {add && (
        <Modal title="อยากเพิ่มเรื่องราวแบบไหน?" onClose={() => setAdd(false)}>
          <div className="add-block-grid">
            {(['letter', 'photo', 'timeline', 'game'] as BlockType[]).map((t) => {
              const Icon = icons[t];
              return (
                <button key={t} onClick={() => addBlock(t)}>
                  <Icon size={26} />
                  <strong>{blockNames[t]}</strong>
                  <span>
                    {t === 'letter'
                      ? 'คำที่อยากบอกเขา'
                      : t === 'photo'
                        ? 'ภาพที่อยากกลับไปดู'
                        : t === 'timeline'
                          ? 'วันที่อยากจำ'
                          : 'กิจกรรมน่ารัก ๆ ของเรา'}
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {published && (
        <Modal title="ของขวัญพร้อมส่งแล้ว ♡" onClose={() => setPublished(false)}>
          <div className="publish-success">
            <span className="success-heart">
              <MagicBurst className="celebration-burst" />
              <Heart size={39} fill="currentColor" />
            </span>
            <h2>
              ส่งความรู้สึกดี ๆ
              <br />
              ให้ {gift.recipient} กัน
            </h2>
            <p>คัดลอกลิงก์นี้ แล้วส่งให้คนพิเศษของคุณ</p>
            <input
              readOnly
              value={url}
              aria-label="ลิงก์ของขวัญที่เผยแพร่"
              onFocus={(e) => e.target.select()}
            />
            <Button
              className="full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  onToast('คัดลอกลิงก์แล้ว ♡');
                } catch {
                  onToast('แตะช่องลิงก์เพื่อเลือกและคัดลอก');
                }
              }}
            >
              <Copy size={17} /> คัดลอกลิงก์ของขวัญ
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className="text-link centered">
              ลองเปิดจากลิงก์จริง <ExternalLink size={14} />
            </a>
            <small>ผู้รับเปิดลิงก์จากเครื่องอื่นได้ทันทีโดยไม่ต้องสมัครสมาชิก</small>
          </div>
        </Modal>
      )}
    </main>
  );
}
