# Phase 2 n8n setup

1. Start the Next.js app: `npm run dev`.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `INGEST_SECRET`.
3. Apply `supabase/migrations/0001_phase1.sql` and `supabase/migrations/0002_phase2_ingestion.sql` in Supabase SQL Editor.
4. Open n8n and import `n8n/soln-agent-phase2.json`.
5. In both ingestion nodes, replace `REPLACE_WITH_INGEST_SECRET` with the exact `INGEST_SECRET` from `.env.local`.
6. Keep `http://localhost:3000/api/ingest` when n8n runs directly on the host. If n8n runs in Docker, use `http://host.docker.internal:3000/api/ingest` instead.
7. Test each branch manually, then activate the workflow. It runs every 6 hours.

The workflow collects recent open GitHub issues matching problem/feature-intent phrases and recent posts from selected startup/business communities on Reddit. Data is normalized and sent to the protected ingestion API. Duplicate documents are ignored by the `(source_id, external_id)` unique key.

Phase 2 intentionally does not perform AI problem analysis yet; that begins in Phase 3.
