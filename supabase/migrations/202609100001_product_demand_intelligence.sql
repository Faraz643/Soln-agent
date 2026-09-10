alter table public.document_analyses
  add column if not exists evidence_quality numeric(5,2) default 0,
  add column if not exists urgency_score numeric(5,2) default 0,
  add column if not exists competition_score numeric(5,2) default 0,
  add column if not exists workaround_score numeric(5,2) default 0,
  add column if not exists customer_segments text[] not null default '{}';

create index if not exists document_analyses_demand_idx
  on public.document_analyses(demand_score desc);

create index if not exists document_analyses_pain_idx
  on public.document_analyses(pain_score desc);
