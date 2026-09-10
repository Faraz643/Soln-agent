create table if not exists public.discovery_run_documents (
  discovery_run_id uuid not null references public.discovery_runs(id) on delete cascade,
  raw_document_id uuid not null references public.raw_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (discovery_run_id, raw_document_id)
);

create index if not exists discovery_run_documents_run_idx
  on public.discovery_run_documents(discovery_run_id, created_at desc);
create index if not exists discovery_run_documents_document_idx
  on public.discovery_run_documents(raw_document_id);

alter table public.discovery_run_documents enable row level security;
create policy "authenticated users can view discovery run documents"
  on public.discovery_run_documents for select to authenticated using (true);
