# Soln-Agent

Product Demand Intelligence platform. Soln-Agent starts from a market/topic query, collects public demand signals, extracts real customer problems, clusters repeated evidence, measures demand/pain/urgency/willingness-to-pay, researches competition, ranks opportunities and generates validation/MVP plans.

## End-to-end architecture

```text
Topic / market query
        ↓
Discovery engine
        ↓
Reddit + GitHub + Web search
        ↓
research run → run-specific raw signals
        ↓
Gemini signal analysis
        ↓
document_analyses
        ↓
Problem clustering for that research run
        ↓
problems + evidence + trend_snapshots
        ↓
Opportunity engine
        ↓
opportunities
        ↓
Competition intelligence
        ↓
competitors
        ↓
Validation agent
        ↓
landing page + pricing hypothesis + experiment
        ↓
MVP specification agent
```

## APIs

- `POST /api/discover` — collect Reddit, GitHub and public web signals for a topic and attach every signal to a unique research run.
- `POST /api/ingest` — persist normalized raw signals (used by n8n and integrations).
- `POST /api/analyze` — analyze signals for a supplied `run_id`; if no run is supplied, it safely analyzes the latest research run rather than an unrelated global backlog.
- `POST /api/cluster` — consolidate only the selected research run into recurring problems and opportunities and create evidence/trend snapshots.
- `POST /api/competition` — research public competitor/alternative results for an opportunity.
- `POST /api/validate` — generate a product concept, landing-page draft, pricing hypothesis and validation experiment.
- `POST /api/mvp` — generate a grounded MVP specification and engineering plan.

All machine-to-machine endpoints require `Authorization: Bearer $INGEST_SECRET`.

## Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INGEST_SECRET`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (recommended: `gemini-3.1-flash-lite`)
- `N8N_INGEST_URL` (optional integration URL)
- `N8N_BASE_URL` (optional)

Never commit real secrets.

## Supabase migrations

Apply in this order:

1. `supabase/migrations/0001_phase1.sql`
2. `supabase/migrations/0002_phase2_ingestion.sql`
3. `supabase/migrations/0003_phase3_analysis.sql`
4. `supabase/migrations/0004_intelligence_platform.sql`
5. `supabase/migrations/202609100001_product_demand_intelligence.sql`
6. `supabase/migrations/202609100002_research_run_scoping.sql`

**Important:** `202609100002_research_run_scoping.sql` is required before using the new run-scoped discovery/analyze/cluster flow. It creates the `discovery_run_documents` relationship that prevents one research query from accidentally analyzing or displaying another query's signals.

## n8n

- `n8n/soln-agent-phase2.json` — legacy GitHub collection workflow.
- `n8n/soln-agent-phase3.json` — scheduled analysis workflow; it now analyzes the latest research run when no run ID is supplied.
- `n8n/soln-agent-autonomous.json` — topic-driven Reddit + GitHub + web discovery followed by analysis and clustering every 6 hours.
- `n8n/soln-agent-phase9.json` — autonomous multi-topic pipeline; each topic now carries its own `run_id` through analysis and clustering so topics cannot contaminate one another.

Replace `REPLACE_WITH_INGEST_SECRET` in imported workflows with the same secret stored in Vercel. Keep the autonomous workflow inactive until its topics and credentials are reviewed.

## Intelligence model

Payment means willingness-to-pay/economic evidence around a problem, not a GitHub bounty. Absence of payment evidence does not reject a problem. The system separates observed evidence from inference and stores source/lifecycle context.

## Phase 1–9 coverage

1. Foundation — Next.js, Supabase, n8n, authentication-ready architecture.
2. Data Collection — Reddit, GitHub, web search, scheduled n8n workflow, raw storage.
3. Problem Detection — AI extraction, duplicate consolidation, clustering, evidence history.
4. Demand Intelligence — demand, growth snapshots, pain, urgency, solution intent/workarounds, willingness-to-pay.
5. Competition Intelligence — public alternatives, pricing/review/complaint research surface.
6. Opportunity Engine — scored and ranked opportunities with evidence.
7. Dashboard — overview, problems, opportunities, trends, sources and detailed opportunity views.
8. Validation Agent — product concept, landing page draft, pricing hypothesis and validation experiment.
9. Autonomous Product Discovery — scheduled discovery/analyze/cluster pipeline plus validation/MVP agents and machine-readable results for notification/agent workflows.
