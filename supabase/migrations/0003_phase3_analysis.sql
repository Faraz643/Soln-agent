create table if not exists public.document_analyses (
  id uuid primary key default gen_random_uuid(),
  raw_document_id uuid not null unique references public.raw_documents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','candidate','rejected','verified','error')),
  is_problem boolean not null default false,
  is_paid boolean not null default false,
  reward_amount numeric,
  currency text,
  is_open boolean,
  has_pr boolean not null default false,
  is_solved boolean not null default false,
  is_stale boolean not null default false,
  difficulty text,
  technologies text[] not null default '{}',
  problem_summary text,
  opportunity_summary text,
  opportunity_score numeric(5,2),
  confidence_score numeric(5,2),
  rejection_reason text,
  evidence jsonb not null default '{}'::jsonb,
  model text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_analyses_status_idx on public.document_analyses(status);
create index if not exists document_analyses_score_idx on public.document_analyses(opportunity_score desc);
create index if not exists document_analyses_analyzed_idx on public.document_analyses(analyzed_at desc);

alter table public.document_analyses enable row level security;
create policy "authenticated users can view document analyses"
  on public.document_analyses for select to authenticated using (true);
