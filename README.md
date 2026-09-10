# Soln Agent

Product Demand Intelligence platform.

## Phase 1

The repository now contains the Phase 1 foundation:

- Next.js + TypeScript application shell
- Dashboard navigation and overview screen
- Supabase browser/server client integration points
- Initial Supabase/Postgres schema for users, sources, raw documents, problems, opportunities, and evidence
- pgvector extension enabled for future semantic clustering
- Environment variable template
- n8n integration boundary reserved for the data-collection/automation phase

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add the Supabase variables to `.env.local` before using database/auth features.

## Supabase

Apply `supabase/migrations/0001_phase1.sql` to the project's Supabase database.

## Next phase

Phase 2 will connect source collectors through n8n and start ingesting Reddit, GitHub, and web data.
