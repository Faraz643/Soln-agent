create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'discovery_cycle',
  status text not null default 'running',
  topic text,
  signals_collected integer not null default 0,
  signals_analyzed integer not null default 0,
  problems_found integer not null default 0,
  opportunities_found integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.discovery_topics (
  id uuid primary key default gen_random_uuid(),
  topic text not null unique,
  source text not null default 'agent',
  status text not null default 'active',
  priority integer not null default 50,
  last_researched_at timestamptz,
  next_research_at timestamptz,
  times_researched integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discovery_topics_next_idx on public.discovery_topics(status, next_research_at, priority desc);
create index if not exists agent_runs_started_idx on public.agent_runs(started_at desc);

alter table public.sources add column if not exists last_error text;

insert into public.discovery_topics(topic, source, priority)
values
 ('AI software development workflows', 'seed', 70),
 ('small business operations and customer management', 'seed', 70),
 ('freelancer and independent professional workflows', 'seed', 70),
 ('creator economy and audience monetization', 'seed', 65),
 ('sales, lead generation and follow-up workflows', 'seed', 65),
 ('personal productivity and knowledge work', 'seed', 60),
 ('ecommerce operations and merchant pain points', 'seed', 60),
 ('education and student workflows', 'seed', 55)
on conflict (topic) do nothing;
