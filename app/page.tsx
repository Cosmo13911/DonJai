'use client';
import { useState, useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Heart,
  Accessibility,
  Check,
  X,
  LoaderCircle,
  FolderHeart,
  Menu,
  LogIn,
  LogOut,
  User,
} from 'lucide-react';
import type { Gift, Template } from '../lib/domain';
import { validateGift } from '../lib/domain';
import { newGift, templateInfo } from '../lib/templates';
import {
  api,
  fetchAuthMe,
  localClear,
  localGifts,
  localSave,
  localDelete,
  logoutAuth,
  type AuthUser,
} from '../lib/client';
import { createSupabaseBrowserClient } from '../lib/supabase/client';
import { Logo, Button, Modal, SectionLabel } from '../components/ui';
import Landing from '../components/Landing';
import TemplateCard from '../components/TemplateCard';
import Editor from '../components/Editor';
import Dashboard from '../components/Dashboard';
import GiftView from '../components/GiftView';
import AuthView from '../components/AuthView';
import RecipientExperience from '../components/RecipientExperience';
import { MotionProvider, PageScene } from '../components/Motion';

type View = 'landing' | 'templates' | 'dashboard' | 'editor' | 'recipient' | 'login';

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [editing, setEditing] = useState<Gift | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [sample, setSample] = useState<Gift | null>(null);
  const [reduced, setReduced] = useState(false);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [menu, setMenu] = useState(false);
  const [recipientKey, setRecipientKey] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authErrorParam, setAuthErrorParam] = useState('');

  const pendingSection = useRef<string | null>(null);
  const returnAfterAuth = useRef<{ view: View; gift?: Gift } | null>(null);
  const routeVersion = useRef(0);
  const deletedIds = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  const authConfiguredRef = useRef(false);
  authConfiguredRef.current = authConfigured;
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const skipEditorUnmountSave = useRef(false);

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }

  async function refreshAuth(): Promise<{ user: AuthUser | null; authConfigured: boolean }> {
    const res = await fetchAuthMe();
    authConfiguredRef.current = res.authConfigured;
    userRef.current = res.user;
    setAuthConfigured(res.authConfigured);
    setUser(res.user);

    if (res.authConfigured) {
      try {
        const lastUserId = localStorage.getItem('donjai-last-user-id');
        if (res.user) {
          if (lastUserId && lastUserId !== res.user.id) {
            await localClear().catch(() => {});
          }
          localStorage.setItem('donjai-last-user-id', res.user.id);
        } else if (lastUserId) {
          await localClear().catch(() => {});
          localStorage.removeItem('donjai-last-user-id');
        }
      } catch {
        // Ignore storage errors in private browsing modes.
      }
    }

    return res;
  }

  async function loadGifts(signedInUser?: AuthUser | null, configuredOverride?: boolean) {
    const isAuthConfigured =
      configuredOverride !== undefined ? configuredOverride : authConfiguredRef.current;
    const activeUser = signedInUser !== undefined ? signedInUser : userRef.current;

    if (isAuthConfigured && !activeUser) {
      setGifts([]);
      return;
    }

    let local: Gift[] = [];
    try {
      local = await localGifts();
      setGifts(local);
    } catch {
      notify('เบราว์เซอร์ไม่อนุญาตให้บันทึกในเครื่อง');
    }

    if (!activeUser) return;

    try {
      const result = await api<{ gifts: Gift[] }>('/gifts');
      const latest = await localGifts();
      const combined = new Map(latest.map((g) => [g.id, g]));
      for (const g of result.gifts) {
        if (deletedIds.current.has(g.id)) continue;
        const prev = combined.get(g.id);
        const merged =
          !prev || g.updatedAt >= prev.updatedAt
            ? g
            : {
                ...prev,
                slug: g.slug || prev.slug,
                publishedAt: g.publishedAt,
                passwordProtected: g.passwordProtected,
                hint: g.hint,
              };
        combined.set(g.id, merged);
        await localSave(merged);
      }
      setGifts(
        [...combined.values()]
          .filter((g) => !deletedIds.current.has(g.id))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
    } catch {
      // Local drafts remain available when offline or server unavailable.
    }
  }

  function navigate(next: View, g?: Gift) {
    if (next === 'dashboard' && authConfiguredRef.current && !userRef.current) {
      requestAuth({ view: 'dashboard' });
      return;
    }
    pendingSection.current = null;
    routeVersion.current++;
    setLoading(false);
    setMenu(false);
    const params =
      next === 'landing'
        ? ''
        : next === 'editor'
          ? '?edit=' + g!.id
          : '?view=' + next;
    history.pushState({}, '', '/' + params);
    if (next === 'editor') {
      skipEditorUnmountSave.current = false;
    }
    if (g) setEditing(g);
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (next === 'dashboard') void loadGifts();
  }

  function requestAuth(returnTarget?: { view: View; gift?: Gift }) {
    returnAfterAuth.current = returnTarget || { view, gift: editing || undefined };
    navigate('login');
  }

  async function route() {
    const version = ++routeVersion.current;
    const p = new URLSearchParams(location.search);
    setAuthErrorParam(p.get('authError') || '');

    if (p.has('gift')) {
      setRecipientKey(p.get('gift')!);
      setView('recipient');
      setLoading(false);
      return;
    }

    if (p.has('edit')) {
      setLoading(true);
      try {
        const editId = p.get('edit')!;
        const local = (await localGifts()).find((g) => g.id === editId);
        let g = local;
        const { user: me } = await refreshAuth();
        if (me) {
          try {
            const remote = await api('/gifts/' + encodeURIComponent(editId));
            if (!g || remote.gift.updatedAt > g.updatedAt) g = remote.gift;
          } catch {
            // Keep local draft when offline or gift hasn't synced yet.
          }
        }
        if (version !== routeVersion.current) return;
        if (!g) throw new Error('ไม่พบฉบับร่างนี้');
        skipEditorUnmountSave.current = false;
        setEditing(g);
        setView('editor');
      } catch (e) {
        if (version !== routeVersion.current) return;
        notify(e instanceof Error ? e.message : 'เปิดไม่สำเร็จ');
        navigate('dashboard');
      } finally {
        if (version !== routeVersion.current) return;
        setLoading(false);
      }
      return;
    }

    const v = p.get('view');
    const nextView: View =
      v === 'templates'
        ? 'templates'
        : v === 'dashboard'
          ? 'dashboard'
          : v === 'login'
            ? 'login'
            : 'landing';

    if (nextView === 'dashboard') {
      setLoading(true);
      const { user: me, authConfigured: configured } = await refreshAuth();
      if (version !== routeVersion.current) return;
      setLoading(false);
      if (configured && !me) {
        setGifts([]);
        returnAfterAuth.current = { view: 'dashboard' };
        history.replaceState({}, '', '/?view=login');
        setView('login');
        return;
      }
      setView('dashboard');
      void loadGifts(me, configured);
      return;
    }

    setLoading(false);
    setView(nextView);
    await refreshAuth();
  }

  useEffect(() => {
    setReduced(
      localStorage.getItem('donjai-reduced') === 'true' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    void route();

    const back = () => void route();
    window.addEventListener('popstate', back);

    const supabase = createSupabaseBrowserClient();
    const authSub = supabase?.auth.onAuthStateChange((event, session) => {
      if (!session) {
        userRef.current = null;
        setUser(null);
        if (event === 'SIGNED_OUT') {
          skipEditorUnmountSave.current = true;
          setGifts([]);
          setEditing(null);
          deletedIds.current.clear();
          try {
            localStorage.removeItem('donjai-last-user-id');
          } catch {
            // Ignore storage errors.
          }
          void localClear().catch(() => {});
          if (viewRef.current === 'dashboard' || viewRef.current === 'editor') {
            navigate('landing');
          }
        }
      } else {
        void refreshAuth().then(({ user: me, authConfigured: configured }) => {
          if (me && viewRef.current === 'dashboard') {
            void loadGifts(me, configured);
          }
        });
      }
    });

    return () => {
      window.removeEventListener('popstate', back);
      authSub?.data.subscription.unsubscribe();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced);
  }, [reduced]);

  function toggleReduced() {
    setReduced((r) => {
      localStorage.setItem('donjai-reduced', String(!r));
      return !r;
    });
  }

  async function create(template: Template, blank = false) {
    const g = newGift(template, blank);
    try {
      await localSave(g);
      setSample(null);
      navigate('editor', g);
    } catch {
      notify('บันทึกในเบราว์เซอร์ไม่ได้ กรุณาอนุญาตพื้นที่เก็บข้อมูลก่อน');
    }
  }

  async function remove(g: Gift) {
    if (user && authConfigured) {
      try {
        await api('/gifts/' + g.id, 'DELETE');
        await localDelete(g.id);
        deletedIds.current.add(g.id);
        setGifts((gs) => gs.filter((x) => x.id !== g.id));
        notify('ลบของขวัญแล้ว');
        return;
      } catch (e) {
        if (!g.publishedAt) {
          await localDelete(g.id);
          deletedIds.current.add(g.id);
          setGifts((gs) => gs.filter((x) => x.id !== g.id));
          notify('ลบฉบับร่างในเครื่องแล้ว');
          return;
        }
        notify(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
        return;
      }
    }

    if (!g.publishedAt) {
      await localDelete(g.id);
      deletedIds.current.add(g.id);
      setGifts((gs) => gs.filter((x) => x.id !== g.id));
      notify('ลบฉบับร่างในเครื่องแล้ว');
    } else {
      notify('กรุณาเข้าสู่ระบบเพื่อลบของขวัญที่เผยแพร่แล้ว');
    }
  }

  async function importGift(f: File) {
    try {
      if (f.size > 6500000) throw new Error('ไฟล์ใหญ่เกิน 6 MB');
      const g = validateGift(JSON.parse(await f.text()));
      const copy: Gift = {
        ...g,
        id: crypto.randomUUID(),
        slug: undefined,
        coverAssetId: undefined,
        blocks: g.blocks.map((b) => ({
          ...b,
          id: crypto.randomUUID(),
          imageAssetId: undefined,
        })),
        publishedAt: undefined,
        passwordProtected: false,
        updatedAt: new Date().toISOString(),
      };
      await localSave(copy);
      navigate('editor', copy);
      notify('นำเข้าของขวัญเป็นฉบับร่างใหม่แล้ว');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'ไฟล์สำรองไม่ถูกต้อง');
    }
  }

  async function handleLogout() {
    setMenu(false);
    try {
      skipEditorUnmountSave.current = true;
      userRef.current = null;
      setUser(null);
      setGifts([]);
      setEditing(null);
      deletedIds.current.clear();
      if (view === 'dashboard' || view === 'editor') {
        navigate('landing');
      }

      const supabase = createSupabaseBrowserClient();
      if (supabase) await supabase.auth.signOut();
      await logoutAuth();
      try {
        localStorage.removeItem('donjai-last-user-id');
      } catch {
        // Ignore storage errors.
      }
      await localClear().catch(() => {});
      notify('ออกจากระบบและล้างข้อมูลในเครื่องแล้ว');
    } catch {
      notify('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      skipEditorUnmountSave.current = false;
    }
  }

  async function handleAuthSuccess() {
    const { user: me, authConfigured: configured } = await refreshAuth();
    const target = returnAfterAuth.current;
    returnAfterAuth.current = null;
    if (target && target.view !== 'login') {
      navigate(target.view, target.gift);
      if (target.view === 'dashboard') {
        void loadGifts(me, configured);
      }
    } else {
      navigate('dashboard');
      void loadGifts(me, configured);
    }
  }

  function onPageReady() {
    const id = pendingSection.current;
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
      pendingSection.current = null;
      target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' });
    }
  }

  function scrollTo(id: string) {
    if (view !== 'landing') {
      navigate('landing');
      pendingSection.current = id;
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' });
    }
    setMenu(false);
  }

  return (
    <MotionProvider reduced={reduced}>
      <div className={`app view-${view}`}>
        {view !== 'recipient' && (
          <header className="site-header">
            <div className="nav-shell">
              <Logo onClick={() => navigate('landing')} />
              <nav className="desktop-nav" aria-label="เมนูหลัก">
                <button
                  className={view === 'landing' ? 'nav-active' : ''}
                  onClick={() => scrollTo('examples')}
                >
                  ตัวอย่างของขวัญ
                </button>
                <button onClick={() => scrollTo('how')}>ทำง่ายแค่ไหน</button>
                <button
                  className={view === 'templates' ? 'nav-active' : ''}
                  onClick={() => navigate('templates')}
                >
                  เทมเพลต
                </button>
              </nav>
              <div className="nav-right">
                <button
                  className="motion-toggle"
                  onClick={toggleReduced}
                  aria-pressed={reduced}
                  title={reduced ? 'เปิดแอนิเมชัน' : 'ลดแอนิเมชัน'}
                  aria-label="ลดแอนิเมชัน"
                >
                  <Accessibility size={17} />
                  {reduced && <Check size={10} />}
                </button>
                <button className="my-gifts" onClick={() => navigate('dashboard')}>
                  <FolderHeart size={16} />
                  <span>ของขวัญของฉัน</span>
                </button>
                {user ? (
                  <div className="user-pill">
                    <span title={user.email}>
                      <User size={14} />
                      <span>{user.displayName}</span>
                    </span>
                    <button
                      onClick={() => void handleLogout()}
                      title="ออกจากระบบ"
                      aria-label="ออกจากระบบ"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="my-gifts auth-trigger"
                    onClick={() => requestAuth()}
                  >
                    <LogIn size={16} />
                    <span>เข้าสู่ระบบ</span>
                  </button>
                )}
                <Button onClick={() => navigate('templates')} className="nav-create">
                  เริ่มสร้าง <ArrowUpRight size={16} />
                </Button>
                <button
                  className="mobile-menu icon-button"
                  onClick={() => setMenu(!menu)}
                  aria-label="เปิดเมนู"
                  aria-expanded={menu}
                >
                  {menu ? <X size={21} /> : <Menu size={21} />}
                </button>
              </div>
            </div>
            {menu && (
              <nav className="mobile-nav">
                <button onClick={() => scrollTo('examples')}>ตัวอย่างของขวัญ</button>
                <button onClick={() => scrollTo('how')}>ทำง่ายแค่ไหน</button>
                <button onClick={() => navigate('templates')}>เลือกเทมเพลต</button>
                <button onClick={() => navigate('dashboard')}>ของขวัญของฉัน</button>
                {user ? (
                  <button onClick={() => void handleLogout()}>
                    ออกจากระบบ ({user.displayName})
                  </button>
                ) : (
                  <button onClick={() => requestAuth()}>เข้าสู่ระบบ / สมัครสมาชิก</button>
                )}
                <button onClick={toggleReduced}>
                  {reduced ? '✓ ลดแอนิเมชันอยู่' : 'ลดแอนิเมชัน'}
                </button>
              </nav>
            )}
          </header>
        )}

        <PageScene
          onReady={onPageReady}
          sceneKey={
            loading
              ? 'loading'
              : view === 'editor'
                ? 'editor:' + editing?.id
                : view === 'recipient'
                  ? 'recipient:' + recipientKey
                  : view
          }
        >
          {loading ? (
            <div className="loading-screen">
              <LoaderCircle size={27} className="spin" />
              <p>กำลังเปิดความรู้สึกดี ๆ…</p>
            </div>
          ) : (
            <>
              {view === 'landing' && (
                <Landing
                  reduced={reduced}
                  onStart={() => navigate('templates')}
                  onUse={(t) => void create(t)}
                  onSample={(t) => setSample(newGift(t))}
                />
              )}

              {view === 'templates' && (
                <main className="template-picker section-shell">
                  <button
                    className="text-link back-link"
                    onClick={() => navigate('landing')}
                  >
                    <ArrowLeft size={16} /> กลับหน้าหลัก
                  </button>
                  <div className="picker-heading">
                    <SectionLabel>LET’S MAKE SOMEONE SMILE.</SectionLabel>
                    <h1>
                      เริ่มจากแบบ<span className="serif-accent">ที่ใช่</span>
                    </h1>
                    <p>ทุกแบบเป็นแค่จุดเริ่มต้น เรื่องราวข้างในเป็นของคุณ</p>
                  </div>
                  <div className="filter-tabs">
                    {[
                      ['all', 'ทุกโอกาส'],
                      ['anniversary', 'วันครบรอบ'],
                      ['birthday', 'วันเกิด'],
                      ['letter', 'บอกรัก / คิดถึง'],
                    ].map(([id, name]) => (
                      <button
                        key={id}
                        className={filter === id ? 'active' : ''}
                        onClick={() => setFilter(id)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="template-grid">
                    {templateInfo
                      .filter((t) => filter === 'all' || t.id === filter)
                      .map((t) => (
                        <TemplateCard
                          key={t.id}
                          id={t.id}
                          onPreview={(id) => setSample(newGift(id))}
                          onUse={(id) => void create(id)}
                        />
                      ))}
                  </div>
                  <div className="blank-template">
                    <div>
                      <Plus size={28} />
                      <span>
                        <strong>มีไอเดียของตัวเองแล้ว?</strong>
                        <small>เริ่มหน้าว่าง เลือกบล็อก แล้วจัดเรื่องราวได้ตามใจ</small>
                      </span>
                    </div>
                    <Button
                      kind="secondary"
                      onClick={() => void create('anniversary', true)}
                    >
                      เริ่มจากหน้าว่าง <ArrowUpRight size={17} />
                    </Button>
                  </div>
                  <div className="picker-footnote">
                    <Heart size={14} /> เริ่มแต่งได้เลย ฉบับร่างบันทึกในเบราว์เซอร์นี้อัตโนมัติ
                  </div>
                </main>
              )}

              {view === 'dashboard' && (
                <Dashboard
                  gifts={gifts}
                  user={user}
                  authConfigured={authConfigured}
                  onCreate={() => navigate('templates')}
                  onEdit={(g) => navigate('editor', g)}
                  onDelete={(g) => void remove(g)}
                  onImport={(f) => void importGift(f)}
                  onToast={notify}
                  onRequireAuth={() => requestAuth({ view: 'dashboard' })}
                />
              )}

              {view === 'editor' && editing && (
                <Editor
                  key={editing.id}
                  initial={editing}
                  user={user}
                  authConfigured={authConfigured}
                  skipUnmountSaveRef={skipEditorUnmountSave}
                  onExit={() => navigate('dashboard')}
                  onToast={notify}
                  onRequireAuth={() => requestAuth({ view: 'editor', gift: editing })}
                />
              )}

              {view === 'login' && (
                <AuthView
                  authConfigured={authConfigured}
                  initialError={authErrorParam}
                  nextPath={
                    returnAfterAuth.current?.view === 'editor' && returnAfterAuth.current.gift
                      ? `/?edit=${encodeURIComponent(returnAfterAuth.current.gift.id)}`
                      : '/?view=dashboard'
                  }
                  onSuccess={() => void handleAuthSuccess()}
                  onBack={() => navigate('landing')}
                  onToast={notify}
                />
              )}

              {view === 'recipient' && recipientKey && (
                <RecipientExperience
                  giftSlugOrId={recipientKey}
                  reduced={reduced}
                  onToggleReduced={toggleReduced}
                  onGoHome={() => navigate('landing')}
                />
              )}
            </>
          )}
        </PageScene>

        {sample && (
          <Modal title="ลองเป็นคนรับสักครั้ง ♡" onClose={() => setSample(null)}>
            <GiftView
              gift={sample}
              sample
              onCreate={() => void create(sample.template)}
            />
          </Modal>
        )}

        {toast && (
          <div role="status" className="toast">
            <Check size={17} />
            <span>{toast}</span>
            <button onClick={() => setToast('')} aria-label="ปิดการแจ้งเตือน">
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </MotionProvider>
  );
}
