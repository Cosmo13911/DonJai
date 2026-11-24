-- DonJai initial schema migration (Supabase Auth + PostgreSQL + RLS + Private Storage)
-- Run this file in Supabase SQL Editor or via `supabase db push`.

create extension if not exists pgcrypto;

-- 1. Profiles (linked 1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_avatar text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'ผู้สร้างของขวัญ'
  );
  v_avatar := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
    ''
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, left(v_name, 120), left(v_avatar, 500))
  on conflict (id) do update
    set display_name = case
      when public.profiles.display_name = '' then excluded.display_name
      else public.profiles.display_name
    end,
    avatar_url = case
      when public.profiles.avatar_url = '' then excluded.avatar_url
      else public.profiles.avatar_url
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Templates (seedable, read-only for clients)
create table if not exists public.templates (
  id text primary key,
  name_en text not null,
  name_th text not null,
  description text not null default '',
  tag text not null default '',
  category text not null default 'occasion',
  accent_color text not null default '#E8EBDD',
  preview_asset text not null default '',
  default_theme jsonb not null default '{}'::jsonb,
  default_blocks jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.templates (id, name_en, name_th, description, tag, category, accent_color, preview_asset, default_theme, default_blocks, is_active, sort_order)
values
  (
    'anniversary',
    'Our little story',
    'วันครบรอบของเรา',
    'เก็บวันแรก และทุกวันของเรา',
    'รูปคู่ · ไทม์ไลน์ · จดหมาย',
    'anniversary',
    '#E8EBDD',
    '/images/couple.jpg',
    '{"color":"sage","cover":"/images/couple.jpg"}'::jsonb,
    '[{"type":"letter","title":"ถึงคนที่ทำให้วันธรรมดาพิเศษขึ้น"},{"type":"photo","title":"ที่โปรด กับคนโปรด","image":"/images/memory.jpg"},{"type":"timeline","title":"วันที่เราเจอกัน","date":"2025-02-14"},{"type":"game","title":"คู่กัน เหมือนเรา"}]'::jsonb,
    true,
    1
  ),
  (
    'birthday',
    'Make a little wish',
    'วันเกิดของคนโปรด',
    'คำอวยพรเล็ก ๆ กับเซอร์ไพรส์ใหญ่ ๆ',
    'เค้ก · คำอวยพร · เกมจับคู่',
    'birthday',
    '#FAEBC0',
    '/images/cake.jpg',
    '{"color":"rose","cover":"/images/cake.jpg"}'::jsonb,
    '[{"type":"letter","title":"ถึงคนที่ทำให้วันธรรมดาพิเศษขึ้น"},{"type":"photo","title":"ที่โปรด กับคนโปรด","image":"/images/memory.jpg"},{"type":"timeline","title":"วันที่เราเจอกัน","date":"2025-02-14"},{"type":"game","title":"คู่กัน เหมือนเรา"}]'::jsonb,
    true,
    2
  ),
  (
    'letter',
    'A letter, just for you',
    'จดหมายถึงเธอ',
    'บางคำพูด อยากเก็บไว้ให้คนเดียว',
    'จดหมาย · ภาพถ่าย · ความในใจ',
    'letter',
    '#EFDBDE',
    '/images/memory.jpg',
    '{"color":"rose","cover":"/images/couple.jpg"}'::jsonb,
    '[{"type":"letter","title":"ถึงคนที่ทำให้วันธรรมดาพิเศษขึ้น"},{"type":"photo","title":"ที่โปรด กับคนโปรด","image":"/images/memory.jpg"},{"type":"timeline","title":"วันที่เราเจอกัน","date":"2025-02-14"},{"type":"game","title":"คู่กัน เหมือนเรา"}]'::jsonb,
    true,
    3
  )
on conflict (id) do nothing;

-- 3. Gifts (creator drafts & metadata)
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text unique not null,
  template_id text not null references public.templates(id) default 'anniversary',
  title text not null,
  subtitle text not null default '',
  recipient_name text not null,
  sender_name text not null,
  theme_color text not null default 'rose' check (theme_color in ('rose', 'sage', 'lilac')),
  cover_asset_id uuid,
  cover_preset text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  password_protected boolean not null default false,
  hint text not null default '',
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gifts_owner_updated_idx on public.gifts (owner_id, updated_at desc);
create index if not exists gifts_slug_idx on public.gifts (slug);

-- 4. Gift Assets (private storage metadata)
create table if not exists public.gift_assets (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text unique not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now()
);

create index if not exists gift_assets_gift_idx on public.gift_assets (gift_id);
create index if not exists gift_assets_owner_idx on public.gift_assets (owner_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gifts_cover_asset_fkey'
  ) then
    alter table public.gifts
      add constraint gifts_cover_asset_fkey
      foreign key (cover_asset_id) references public.gift_assets(id) on delete set null;
  end if;
end $$;

-- 5. Gift Blocks (ordered draft blocks)
create table if not exists public.gift_blocks (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts(id) on delete cascade,
  type text not null check (type in ('letter', 'photo', 'timeline', 'game')),
  position int not null check (position >= 0),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists gift_blocks_gift_pos_idx on public.gift_blocks (gift_id, position);

-- 6. Gift Publications (immutable published snapshots, server-only)
create table if not exists public.gift_publications (
  gift_id uuid primary key references public.gifts(id) on delete cascade,
  snapshot jsonb not null,
  password_protected boolean not null default false,
  password_hash text,
  hint text not null default '',
  version int not null default 1,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Gift Unlock Attempts (server-only rate limit tracking)
create table if not exists public.gift_unlock_attempts (
  gift_id uuid not null references public.gifts(id) on delete cascade,
  ip_hash text not null,
  attempt_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (gift_id, ip_hash)
);

-- 8. Atomic RPC functions
create or replace function public.save_gift_blocks(p_gift_id uuid, p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  select exists (
    select 1
    from public.gifts g
    where g.id = p_gift_id
      and (g.owner_id = auth.uid() or coalesce(auth.role(), '') = 'service_role')
  ) into v_allowed;

  if not v_allowed then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'p_blocks must be a JSON array' using errcode = '22023';
  end if;

  delete from public.gift_blocks where gift_id = p_gift_id;

  insert into public.gift_blocks (id, gift_id, type, position, content, updated_at)
  select
    coalesce((elem ->> 'id')::uuid, gen_random_uuid()),
    p_gift_id,
    elem ->> 'type',
    (ord - 1)::int,
    coalesce(elem -> 'content', '{}'::jsonb),
    now()
  from jsonb_array_elements(p_blocks) with ordinality as t(elem, ord);
end;
$$;

create or replace function public.record_unlock_attempt(
  p_gift_id uuid,
  p_ip_hash text,
  p_max_attempts int default 5,
  p_window_seconds int default 600
)
returns table(allowed boolean, attempt_count int, locked_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count int;
  v_locked_until timestamptz;
begin
  insert into public.gift_unlock_attempts (gift_id, ip_hash, attempt_count, locked_until, updated_at)
  values (p_gift_id, p_ip_hash, 0, null, v_now)
  on conflict (gift_id, ip_hash) do nothing;

  select u.attempt_count, u.locked_until
  into v_count, v_locked_until
  from public.gift_unlock_attempts u
  where u.gift_id = p_gift_id and u.ip_hash = p_ip_hash
  for update;

  if v_locked_until is not null and v_locked_until > v_now and v_count >= p_max_attempts then
    return query select false, v_count, v_locked_until;
    return;
  end if;

  if v_locked_until is null or v_locked_until <= v_now then
    v_count := 1;
    v_locked_until := v_now + make_interval(secs => p_window_seconds);
  else
    v_count := v_count + 1;
  end if;

  update public.gift_unlock_attempts
  set attempt_count = v_count,
      locked_until = v_locked_until,
      updated_at = v_now
  where gift_id = p_gift_id and ip_hash = p_ip_hash;

  return query select true, v_count, v_locked_until;
end;
$$;

-- 9. Row Level Security & Privileges
alter table public.profiles enable row level security;
alter table public.templates enable row level security;
alter table public.gifts enable row level security;
alter table public.gift_assets enable row level security;
alter table public.gift_blocks enable row level security;
alter table public.gift_publications enable row level security;
alter table public.gift_unlock_attempts enable row level security;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists templates_public_read on public.templates;
create policy templates_public_read on public.templates
  for select to anon, authenticated using (is_active = true);

drop policy if exists gifts_owner_all on public.gifts;
create policy gifts_owner_all on public.gifts
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists gift_assets_owner_all on public.gift_assets;
create policy gift_assets_owner_all on public.gift_assets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists gift_blocks_owner_all on public.gift_blocks;
create policy gift_blocks_owner_all on public.gift_blocks
  for all to authenticated
  using (
    exists (
      select 1 from public.gifts g
      where g.id = gift_blocks.gift_id and g.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.gifts g
      where g.id = gift_blocks.gift_id and g.owner_id = auth.uid()
    )
  );

-- Lock down server-only tables and RPC permissions
revoke all on public.gift_publications, public.gift_unlock_attempts from anon, authenticated;
grant all on public.gift_publications, public.gift_unlock_attempts to service_role;

revoke all on function public.save_gift_blocks(uuid, jsonb) from public;
grant execute on function public.save_gift_blocks(uuid, jsonb) to authenticated, service_role;

revoke all on function public.record_unlock_attempt(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.record_unlock_attempt(uuid, text, int, int) to service_role;

-- 10. Private Storage Bucket & Policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gift-assets',
  'gift-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists gift_assets_storage_select on storage.objects;
create policy gift_assets_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'gift-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists gift_assets_storage_insert on storage.objects;
create policy gift_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gift-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists gift_assets_storage_update on storage.objects;
create policy gift_assets_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gift-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'gift-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists gift_assets_storage_delete on storage.objects;
create policy gift_assets_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gift-assets' and (storage.foldername(name))[1] = auth.uid()::text);
