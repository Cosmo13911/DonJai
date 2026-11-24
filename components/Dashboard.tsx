'use client';
import { useState, useRef } from 'react';
import {
  Plus,
  ArrowUpRight,
  Heart,
  Download,
  Trash2,
  Copy,
  Globe,
  FileHeart,
  Upload,
  Clock,
  PenLine,
  LogIn,
  CloudOff,
} from 'lucide-react';
import type { Gift } from '../lib/domain';
import type { AuthUser } from '../lib/client';
import { Button, Empty, Modal, SectionLabel } from './ui';

export function downloadGift(g: Gift) {
  const blob = new Blob([JSON.stringify(g, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `donjai-${g.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function Dashboard({
  gifts,
  user,
  authConfigured,
  onCreate,
  onEdit,
  onDelete,
  onImport,
  onToast,
  onRequireAuth,
}: {
  gifts: Gift[];
  user: AuthUser | null;
  authConfigured: boolean;
  onCreate: () => void;
  onEdit: (g: Gift) => void;
  onDelete: (g: Gift) => void;
  onImport: (f: File) => void;
  onToast: (s: string) => void;
  onRequireAuth: () => void;
}) {
  const [remove, setRemove] = useState<Gift | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (authConfigured && !user) {
    return (
      <main className="workspace section-shell">
        <div className="workspace-heading">
          <div>
            <SectionLabel>YOUR LITTLE CORNER OF LOVE</SectionLabel>
            <h1>
              ของขวัญ<span className="serif-accent">ของคุณ</span>
            </h1>
            <p>เข้าสู่ระบบเพื่อดูและจัดการของขวัญที่บันทึกไว้ในบัญชีของคุณ</p>
          </div>
        </div>
        <Empty>
          <h2>กรุณาเข้าสู่ระบบก่อนดูของขวัญของคุณ</h2>
          <p>เพื่อความเป็นส่วนตัว รายการของขวัญจะแสดงเฉพาะเมื่อเข้าสู่ระบบแล้วเท่านั้น</p>
          <Button onClick={onRequireAuth}>
            <LogIn size={16} /> เข้าสู่ระบบ / สมัครสมาชิก
          </Button>
        </Empty>
      </main>
    );
  }

  return (
    <main className="workspace section-shell">
      <div className="workspace-heading">
        <div>
          <SectionLabel>YOUR LITTLE CORNER OF LOVE</SectionLabel>
          <h1>
            ของขวัญ<span className="serif-accent">ของคุณ</span>
          </h1>
          <p>ทุกชิ้น มีใครบางคนอยู่ในใจ</p>
        </div>
        <div className="heading-actions">
          <Button kind="secondary" onClick={() => input.current?.click()}>
            <Upload size={16} /> นำเข้าไฟล์สำรอง
          </Button>
          <Button onClick={onCreate}>
            <Plus size={18} /> สร้างของขวัญ
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) onImport(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {!user && (
        <div className="auth-banner">
          <div>
            <CloudOff size={18} />
            <span>
              <strong>
                {authConfigured
                  ? 'ฉบับร่างตอนนี้บันทึกไว้เฉพาะในเบราว์เซอร์นี้'
                  : 'กำลังทำงานในโหมดทดสอบในเครื่อง'}
              </strong>
              <small>
                {authConfigured
                  ? 'เข้าสู่ระบบด้วยอีเมลหรือ Google เพื่อซิงก์ข้ามอุปกรณ์ อัปโหลดรูปขึ้นคลังส่วนตัว และเผยแพร่ลิงก์ให้ผู้รับเปิดได้จริง'
                  : 'ยังไม่ได้ตั้งค่าคีย์ Supabase ใน .env.local ฉบับร่างจะบันทึกในเบราว์เซอร์นี้และสำรองเป็นไฟล์ JSON ได้'}
              </small>
            </span>
          </div>
          {authConfigured && (
            <Button kind="secondary" onClick={onRequireAuth}>
              <LogIn size={15} /> เข้าสู่ระบบ / สมัครสมาชิก
            </Button>
          )}
        </div>
      )}

      <div className="dashboard-summary">
        <span>
          <FileHeart size={16} />
          {gifts.length} ความตั้งใจ
        </span>
        <span>
          <Globe size={16} />
          {gifts.filter((g) => g.publishedAt).length} ของขวัญที่เผยแพร่
        </span>
        <small>
          {user
            ? `ซิงก์กับบัญชี ${user.displayName} และบันทึกในเบราว์เซอร์อัตโนมัติ`
            : 'ฉบับร่างบันทึกอัตโนมัติในเบราว์เซอร์นี้'}
        </small>
      </div>

      {gifts.length === 0 ? (
        <Empty>
          <h2>ของขวัญชิ้นแรก กำลังรอคุณอยู่</h2>
          <p>เริ่มจากรูปหนึ่งรูป กับใครสักคนที่คุณนึกถึง</p>
          <Button onClick={onCreate}>
            เริ่มสร้างของขวัญ <ArrowUpRight size={17} />
          </Button>
        </Empty>
      ) : (
        <div className="dashboard-grid">
          {gifts.map((g) => {
            const sharePath = g.slug ? '/g/' + g.slug : '/?gift=' + g.id;
            return (
              <article key={g.id} className="saved-gift-card">
                <button className="saved-cover" onClick={() => onEdit(g)}>
                  <img src={g.cover || '/images/couple.jpg'} alt={g.title} />
                  <span className={`status-pill ${g.publishedAt ? 'published' : ''}`}>
                    {g.publishedAt ? (
                      <>
                        <Globe size={11} /> เผยแพร่แล้ว
                      </>
                    ) : (
                      <>
                        <PenLine size={11} /> ฉบับร่าง
                      </>
                    )}
                  </span>
                </button>
                <div className="saved-info">
                  <span className="small-label">ถึง {g.recipient} ♡</span>
                  <h3>{g.title}</h3>
                  <p>
                    <Clock size={12} /> แก้ไข{' '}
                    {new Date(g.updatedAt).toLocaleDateString('th-TH', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                  <div className="saved-actions">
                    <Button kind="secondary" onClick={() => onEdit(g)}>
                      แก้ไขของขวัญ <ArrowUpRight size={15} />
                    </Button>
                    <button
                      className="icon-button"
                      onClick={() => {
                        downloadGift(g);
                        onToast('ดาวน์โหลดไฟล์สำรองแล้ว');
                      }}
                      aria-label={`สำรอง ${g.title}`}
                      title="ดาวน์โหลดไฟล์สำรอง"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => setRemove(g)}
                      aria-label={`ลบ ${g.title}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {g.publishedAt && (
                    <button
                      className="published-link"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(location.origin + sharePath);
                          onToast('คัดลอกลิงก์ของขวัญแล้ว ♡');
                        } catch {
                          onToast('คัดลอกไม่ได้ เปิดหน้าตั้งค่าเพื่อเลือกลิงก์ด้วยตัวเอง');
                        }
                      }}
                    >
                      <Copy size={13} /> คัดลอกลิงก์ของขวัญ
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <button className="new-gift-card" onClick={onCreate}>
            <span>
              <Plus size={28} />
            </span>
            <strong>อีกหนึ่งความรู้สึกดี ๆ</strong>
            <small>สร้างของขวัญชิ้นใหม่</small>
          </button>
        </div>
      )}

      {remove && (
        <Modal title="ลบของขวัญชิ้นนี้?" onClose={() => setRemove(null)}>
          <div className="confirm-body">
            <Heart size={30} />
            <h3>{remove.title}</h3>
            <p>
              ฉบับร่างและลิงก์ของขวัญจะถูกลบ
              <br />
              ดาวน์โหลดไฟล์สำรองเก็บไว้ก่อนได้นะ
            </p>
            <div className="button-row">
              <Button kind="secondary" onClick={() => setRemove(null)}>
                เก็บไว้ก่อน
              </Button>
              <Button
                onClick={() => {
                  onDelete(remove);
                  setRemove(null);
                }}
              >
                ยืนยันการลบ
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
