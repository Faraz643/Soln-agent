-- Soln-Agent discovery source registry.
-- All sources are enabled by default; the application still records per-source failures.
insert into public.sources (name, type, enabled, last_error)
values
  ('Reddit', 'reddit', true, null),
  ('X', 'social', true, null),
  ('Web Search', 'web', true, null),
  ('GitHub', 'github', true, null),
  ('Hacker News', 'web', true, null),
  ('Indie Hackers', 'web', true, null),
  ('Product Hunt', 'web', true, null),
  ('Stack Overflow', 'web', true, null),
  ('Quora', 'web', true, null),
  ('Trustpilot', 'web', true, null),
  ('Google Maps Reviews', 'web', true, null),
  ('GitHub Discussions', 'web', true, null),
  ('Y Combinator Discussions', 'web', true, null),
  ('Google Trends', 'web', true, null)
on conflict (name) do update set enabled = true, last_error = null;

create index if not exists idx_sources_enabled on public.sources(enabled);
create index if not exists idx_raw_documents_source_collected on public.raw_documents(source_id, collected_at desc);
