# Soln-Agent

Product Demand Intelligence platform.

Soln-Agent collects public demand signals, extracts the underlying customer problem, measures pain/demand/willingness-to-pay/evidence, and ranks product opportunities. It is **not** a bounty hunter: GitHub is a demand-signal source, not a requirement for monetary rewards.

## Current architecture

```text
GitHub demand signals
        ↓
      n8n
        ↓
/api/ingest → Supabase raw_documents
        ↓
/api/analyze → Gemini evidence-first analysis
        ↓
document_analyses
        ↓
Dashboard: Overview / Problems / Opportunities / Trends / Sources
```

## Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INGEST_SECRET`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (recommended: `gemini-3.1-flash-lite`)
- `N8N_INGEST_URL`
- `N8N_BASE_URL` is optional until n8n is hosted publicly.

Never commit real secrets.

## Supabase migrations

Apply in order:

1. `supabase/migrations/0001_phase1.sql`
2. `supabase/migrations/0002_phase2_ingestion.sql`
3. `supabase/migrations/0003_phase3_analysis.sql`
4. `supabase/migrations/202609100001_product_demand_intelligence.sql`

The final migration adds pain, demand, willingness-to-pay, evidence quality, urgency, competition, workaround and customer-segment fields.

## n8n

Import:

- `n8n/soln-agent-phase2.json` — GitHub demand collection every 6 hours.
- `n8n/soln-agent-phase3.json` — AI demand analysis every 6 hours.

Replace `REPLACE_WITH_INGEST_SECRET` in the n8n HTTP nodes with the same `INGEST_SECRET` stored in Vercel.

Reddit is intentionally not part of the initial active pipeline. It can be added later as a separate source.

## Intelligence model

Each signal is evaluated on:

- Problem reality
- Pain
- Demand
- Willingness to pay
- Current workarounds
- Urgency
- Competition
- Evidence quality
- Customer segment
- Product opportunity
- Confidence

Payment evidence is **one demand signal**. It does not turn a GitHub issue into a bounty and its absence does not automatically reject a problem.

## Roadmap

1. Foundation — complete
2. Source ingestion — GitHub initial source
3. AI signal analysis — Gemini
4. Problem clustering — semantic grouping
5. Opportunity intelligence — product recommendations
6. Trends — demand acceleration and emerging themes
7. Intelligence dashboard — live decision workspace
8. More sources — Reddit, web, reviews, communities
9. Validation engine — cross-source evidence and confidence
10. Product-discovery agent — answer high-level market questions from accumulated evidence
