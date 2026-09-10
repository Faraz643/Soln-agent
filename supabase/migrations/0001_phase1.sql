create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('reddit','github','web','social','reviews','other')),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.raw_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  external_id text,
  url text,
  title text,
  content text,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(source_id, external_id)
);

create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  target_customer text,
  category text,
  pain_score numeric(5,2),
  demand_score numeric(5,2),
  payment_score numeric(5,2),
  opportunity_score numeric(5,2),
  mention_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.problems(id) on delete set null,
  name text not null,
  description text,
  score numeric(5,2),
  status text not null default 'new' check (status in ('new','reviewing','validated','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.problems(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  raw_document_id uuid references public.raw_documents(id) on delete cascade,
  signal_type text not null,
  strength numeric(5,2),
  excerpt text,
  created_at timestamptz not null default now()
);

insert into public.sources (name, type, enabled) values
  ('Reddit', 'reddit', false),
  ('GitHub', 'github', false),
  ('Web Search', 'web', false)
on conflict (name) do nothing;

alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.raw_documents enable row level security;
alter table public.problems enable row level security;
alter table public.opportunities enable row level security;
alter table public.evidence enable row level security;

create policy "users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users can update own profile" on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
