create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  status text not null default 'running' check (status in ('running','completed','error')),
  sources text[] not null default '{}',
  signals_collected integer not null default 0,
  problems_found integer not null default 0,
  opportunities_found integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.problem_signals (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.problems(id) on delete cascade,
  raw_document_id uuid references public.raw_documents(id) on delete cascade,
  relevance numeric(5,2),
  evidence_quality numeric(5,2),
  created_at timestamptz not null default now(),
  unique(problem_id, raw_document_id)
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  name text not null,
  url text,
  description text,
  pricing text,
  features text[] not null default '{}',
  complaints text[] not null default '{}',
  strengths text[] not null default '{}',
  weaknesses text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(5,2),
  created_at timestamptz not null default now(),
  unique(opportunity_id, name)
);

create table if not exists public.trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid references public.problems(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  mentions integer not null default 0,
  demand_score numeric(5,2),
  pain_score numeric(5,2),
  growth_rate numeric(8,2),
  created_at timestamptz not null default now(),
  unique(problem_id, period_start, period_end)
);

create table if not exists public.validation_experiments (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  concept_name text,
  target_customer text,
  value_proposition text,
  landing_page_markdown text,
  pricing_hypothesis jsonb not null default '{}'::jsonb,
  experiment_plan jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','running','completed','cancelled')),
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists problem_signals_problem_idx on public.problem_signals(problem_id, created_at desc);
create index if not exists competitors_opportunity_idx on public.competitors(opportunity_id);
create index if not exists trend_snapshots_problem_idx on public.trend_snapshots(problem_id, period_end desc);
create index if not exists validation_opportunity_idx on public.validation_experiments(opportunity_id, created_at desc);

alter table public.discovery_runs enable row level security;
alter table public.problem_signals enable row level security;
alter table public.competitors enable row level security;
alter table public.trend_snapshots enable row level security;
alter table public.validation_experiments enable row level security;

create policy "authenticated users can view discovery runs" on public.discovery_runs for select to authenticated using (true);
create policy "authenticated users can view problem signals" on public.problem_signals for select to authenticated using (true);
create policy "authenticated users can view competitors" on public.competitors for select to authenticated using (true);
create policy "authenticated users can view trends" on public.trend_snapshots for select to authenticated using (true);
create policy "authenticated users can view validations" on public.validation_experiments for select to authenticated using (true);
