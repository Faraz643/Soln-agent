alter table public.sources
  add column if not exists last_collected_at timestamptz,
  add column if not exists last_error text,
  add column if not exists documents_collected integer not null default 0;

create index if not exists raw_documents_source_published_idx
  on public.raw_documents(source_id, published_at desc);

create index if not exists raw_documents_collected_idx
  on public.raw_documents(collected_at desc);

create index if not exists raw_documents_metadata_gin_idx
  on public.raw_documents using gin(metadata);

create policy "authenticated users can view sources"
  on public.sources for select
  to authenticated
  using (true);

create policy "authenticated users can view raw documents"
  on public.raw_documents for select
  to authenticated
  using (true);

create or replace function public.refresh_source_counts()
returns void
language sql
security definer
set search_path = public
as $$
  update public.sources s
  set documents_collected = (
    select count(*) from public.raw_documents d where d.source_id = s.id
  );
$$;
