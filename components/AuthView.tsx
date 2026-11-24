'use client';
import { useState } from 'react';
import { ArrowLeft, Heart, LockKeyhole, Mail, Sparkles, UserCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '../lib/supabase/client';
import { Button, SectionLabel } from './ui';

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง ลองตรวจสอบอีกครั้งนะ';
  }
  if (lower.includes('user already registered')) {
    return 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาสลับไปหน้าเข้าสู่ระบบ';
  }
  if (lower.includes('password should be at least')) {
    return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  }
  if (lower.includes('email not confirmed')) {
    return 'กรุณายืนยันอีเมลจากกล่องจดหมายก่อนเข้าสู่ระบบ';
  }
  if (lower.includes('unable to validate email')) {
    return 'รูปแบบอีเมลไม่ถูกต้อง';
  }
  if (lower.includes('rate limit')) {
    return 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
  }
  return message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
}

function safeNextPath(nextPath?: string): string {
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return '/?view=dashboard';
  }
  return nextPath;
}

export default function AuthView({
  authConfigured,
  nextPath,
  initialMode = 'signin',
  initialError = '',
  backHref = '/',
  onSuccess,
  onBack,
  onToast,
}: {
  authConfigured: boolean;
  nextPath?: string;
  initialMode?: 'signin' | 'signup';
  initialError?: string;
  backHref?: string;
  onSuccess?: () => void;
  onBack?: () => void;
  onToast?: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState(initialError ? mapAuthError(initialError) : '');
  const [notice, setNotice] = useState('');

  const targetNext = safeNextPath(nextPath);

  async function handleGoogle() {
    setError('');
    setNotice('');
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError('ยังไม่ได้ตั้งค่า Supabase ในไฟล์ .env.local');
      return;
    }

    setGoogleBusy(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(targetNext)}`;
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (oauthErr) {
        setError(mapAuthError(oauthErr.message));
        setGoogleBusy(false);
      }
    } catch (e) {
      setError(mapAuthError(e instanceof Error ? e.message : ''));
      setGoogleBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError('ยังไม่ได้ตั้งค่า Supabase ในไฟล์ .env.local');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) {
          setError(mapAuthError(signInErr.message));
          return;
        }
        onToast?.('ยินดีต้อนรับกลับมานะ ♡');
        if (onSuccess) onSuccess();
        else window.location.assign(targetNext);
      } else {
        const cleanName = displayName.trim() || email.trim().split('@')[0] || 'ผู้สร้างของขวัญ';
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: cleanName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(targetNext)}`,
          },
        });
        if (signUpErr) {
          setError(mapAuthError(signUpErr.message));
          return;
        }
        if (data.session) {
          onToast?.('สร้างบัญชีเรียบร้อย พร้อมทำของขวัญแล้ว ♡');
          if (onSuccess) onSuccess();
          else window.location.assign(targetNext);
        } else {
          setNotice(
            'ส่งลิงก์ยืนยันไปยังอีเมลของคุณแล้ว กรุณากดยืนยันในกล่องจดหมายแล้วกลับมาเข้าสู่ระบบ'
          );
          setMode('signin');
        }
      }
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page section-shell">
      {onBack ? (
        <button className="text-link back-link" onClick={onBack}>
          <ArrowLeft size={16} /> กลับหน้าหลัก
        </button>
      ) : (
        <a className="text-link back-link" href={backHref}>
          <ArrowLeft size={16} /> กลับหน้าหลัก
        </a>
      )}

      <div className="auth-card">
        <SectionLabel>YOUR LITTLE GIFT STUDIO.</SectionLabel>
        <h1>
          {mode === 'signin' ? (
            <>
              เข้าสู่ระบบเพื่อเก็บ<span className="serif-accent">ความทรงจำ</span>
            </>
          ) : (
            <>
              เริ่มบัญชี<span className="serif-accent">ผู้สร้างของขวัญ</span>
            </>
          )}
        </h1>
        <p className="auth-lead">
          บันทึกฉบับร่างออนไลน์ แก้ไขได้จากทุกเครื่อง และสร้างลิงก์ส่งให้คนพิเศษ
        </p>

        {!authConfigured && (
          <div className="auth-warning" role="status">
            <Sparkles size={17} />
            <div>
              <strong>โหมดทดสอบในเครื่อง (ยังไม่ได้ใส่คีย์ Supabase)</strong>
              <p>
                ตั้งค่า <code>.env.local</code> ตามคู่มือใน <code>docs/supabase-setup.md</code>{' '}
                เพื่อเปิดใช้งานบัญชีลูกค้า Google/Email และการเผยแพร่ออนไลน์จริง
                ระหว่างนี้สามารถสร้างและแต่งฉบับร่างในเบราว์เซอร์ได้ทันที
              </p>
              {onBack && (
                <button className="text-link" onClick={onBack}>
                  ทดลองสร้างฉบับร่างในเครื่องต่อ →
                </button>
              )}
            </div>
          </div>
        )}

        <Button
          kind="secondary"
          className="full google-button"
          onClick={() => void handleGoogle()}
          disabled={!authConfigured || busy}
          busy={googleBusy}
        >
          <GoogleMark />
          ดำเนินการต่อด้วย Google
        </Button>

        <div className="auth-divider">
          <span>หรือใช้อีเมล</span>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="เลือกวิธีเข้าสู่ระบบ">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? 'active' : ''}
            onClick={() => {
              setMode('signin');
              setError('');
            }}
          >
            เข้าสู่ระบบ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => {
              setMode('signup');
              setError('');
            }}
          >
            สมัครสมาชิกใหม่
          </button>
        </div>

        <form className="form-stack" onSubmit={(e) => void handleSubmit(e)}>
          {mode === 'signup' && (
            <label>
              ชื่อของคุณ (แสดงในหน้าจัดการ)
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="เช่น ต้น"
                maxLength={80}
                autoComplete="name"
                disabled={!authConfigured}
              />
            </label>
          )}

          <label>
            อีเมล
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              disabled={!authConfigured}
            />
          </label>

          <label>
            รหัสผ่าน
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'อย่างน้อย 6 ตัวอักษร' : 'รหัสผ่านของคุณ'}
              minLength={6}
              maxLength={128}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              disabled={!authConfigured}
            />
          </label>

          {notice && (
            <div className="auth-notice" role="status">
              <UserCheck size={16} />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="full"
            disabled={!authConfigured || googleBusy}
            busy={busy}
          >
            {mode === 'signin' ? (
              <>
                เข้าสู่ระบบ <Mail size={16} />
              </>
            ) : (
              <>
                สมัครสมาชิก <Heart size={16} />
              </>
            )}
          </Button>
        </form>

        <small className="auth-footnote">
          <LockKeyhole size={12} /> ผู้รับของขวัญเปิดลิงก์ได้ทันทีโดยไม่ต้องสมัครสมาชิก
        </small>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-2H12Z"
      />
      <path
        fill="#34A853"
        d="M3.5 7.5 6.7 9.8C7.5 7.7 9.6 6 12 6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4c-3.7 0-6.9 2.1-8.5 5.1Z"
      />
      <path
        fill="#FBBC05"
        d="M12 21.6c2.6 0 4.8-.9 6.4-2.4l-3-2.5c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.4c1.6 3.3 5 5.6 8.8 5.6Z"
      />
      <path
        fill="#4285F4"
        d="M21.2 12.2c0-.6-.1-1.1-.2-2H12v3.9h5.5c-.3 1.4-1.1 2.5-2.1 3.2l3 2.5c1.8-1.6 2.8-4.1 2.8-7.6Z"
      />
    </svg>
  );
}
