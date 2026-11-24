'use client';
import { useEffect, useState } from 'react';
import { Accessibility, Heart, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import type { Gift } from '../lib/domain';
import { api } from '../lib/client';
import { Button, Logo, SectionLabel } from './ui';
import Envelope from './Envelope';
import GiftView from './GiftView';

interface OpenState {
  id: string;
  giftId?: string;
  gift?: Gift;
  locked?: boolean;
  hint?: string;
  error?: string;
}

export default function RecipientExperience({
  giftSlugOrId,
  reduced,
  onToggleReduced,
  onGoHome,
}: {
  giftSlugOrId: string;
  reduced: boolean;
  onToggleReduced: () => void;
  onGoHome: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [recipient, setRecipient] = useState<OpenState | null>(null);
  const [code, setCode] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOpened(false);
    setCode('');
    setUnlockError('');
    setUnlocking(false);
    setRecipient(null);

    void api('/open/' + encodeURIComponent(giftSlugOrId))
      .then((data) => {
        if (active) setRecipient({ id: giftSlugOrId, ...data });
      })
      .catch((err) => {
        if (active) {
          setRecipient({
            id: giftSlugOrId,
            error: err instanceof Error ? err.message : 'ไม่พบของขวัญนี้',
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [giftSlugOrId]);

  async function unlock() {
    if (!recipient) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      const data = await api<{ gift: Gift; giftId?: string }>(
        '/open/' + encodeURIComponent(giftSlugOrId),
        'POST',
        { password: code }
      );
      setRecipient({
        ...recipient,
        giftId: data.giftId || recipient.giftId,
        gift: data.gift,
        locked: false,
      });
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="recipient-page">
      <div className="recipient-top">
        <Logo onClick={onGoHome} />
        <button className="motion-toggle" onClick={onToggleReduced} aria-pressed={reduced}>
          <Accessibility size={16} />
          <span>{reduced ? 'ลดแอนิเมชันอยู่' : 'ลดแอนิเมชัน'}</span>
        </button>
      </div>

      {loading ? (
        <div className="loading-screen">
          <LoaderCircle size={27} className="spin" />
          <p>กำลังเปิดความรู้สึกดี ๆ…</p>
        </div>
      ) : recipient?.error ? (
        <div className="gift-unavailable">
          <Heart size={41} />
          <h1>ของขวัญนี้ยังเปิดไม่ได้</h1>
          <p>{recipient.error}</p>
          <Button kind="secondary" onClick={onGoHome}>
            ไปหน้า DonJai
          </Button>
        </div>
      ) : recipient?.locked ? (
        <div className="lock-screen">
          <div className="lock-envelope-icon">
            <MailIcon />
          </div>
          <SectionLabel>SOMEONE SENT YOU A LITTLE LOVE.</SectionLabel>
          <h1>
            มีของขวัญ
            <br />
            รอเธออยู่ตรงนี้ ♡
          </h1>
          <p>
            เรื่องราวนี้มีแค่เราที่รู้
            <br />
            ลองใส่รหัส แล้วเปิดด้วยกันนะ
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <label>
              รหัสเปิดของขวัญ
              <input
                type="password"
                value={code}
                autoComplete="off"
                onChange={(e) => setCode(e.target.value)}
                placeholder="รหัสลับของเรา"
                required
                maxLength={128}
              />
            </label>
            {recipient.hint && (
              <div className="hint">
                <Sparkles size={15} />
                <span>คำใบ้: {recipient.hint}</span>
              </div>
            )}
            {unlockError && (
              <p role="alert" className="form-error">
                {unlockError}
              </p>
            )}
            <Button type="submit" className="full" busy={unlocking}>
              เปิดของขวัญ <Heart size={16} />
            </Button>
          </form>
          <small>
            <LockKeyhole size={12} /> ไม่ต้องสมัครสมาชิกในตัวแอป
          </small>
        </div>
      ) : recipient?.gift ? (
        !opened ? (
          <div className="recipient-envelope">
            <SectionLabel>MADE WITH LOVE, JUST FOR YOU.</SectionLabel>
            <h1>
              {recipient.gift.recipient}
              <br />
              มีอะไรอยากให้เธอดู ♡
            </h1>
            <Envelope
              replayKey={recipient.giftId || recipient.id}
              recipient={recipient.gift.recipient}
              compact
              reduced={reduced}
              onOpen={() => setOpened(true)}
            />
          </div>
        ) : (
          <GiftView gift={recipient.gift} />
        )
      ) : null}
    </div>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 100 80" fill="none">
      <rect x="8" y="15" width="84" height="58" rx="7" fill="#ECC3CF" />
      <path d="M8 20 50 53 92 20" fill="#F6DDE5" />
      <path d="m8 73 29-28m55 28L63 45" stroke="#C78DA0" />
      <circle cx="50" cy="51" r="12" fill="#702B43" />
      <path d="m50 56-6-5c-5-6 3-10 6-4 3-6 11-2 6 4Z" fill="#FFF9ED" />
    </svg>
  );
}
