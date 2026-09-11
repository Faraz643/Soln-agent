import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function authorized(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  try { const cs = await cookies(); const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } }); return !!(await c.auth.getUser()).data.user; } catch { return false; }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db();
  const [runs, topics, opps] = await Promise.all([
    c.from('agent_runs').select('id,status,topic,signals_collected,signals_analyzed,problems_found,opportunities_found,started_at,completed_at,error,metadata').order('started_at', { ascending: false }).limit(20),
    c.from('discovery_topics').select('id,topic,priority,last_researched_at,times_researched').eq('status', 'active').order('priority', { ascending: false }).limit(20),
    c.from('opportunities').select('id,name,description,score,problem_id,metadata,problems(title,target_customer,demand_score,pain_score,payment_score)').order('score', { ascending: false }).limit(50),
  ]);
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  if (opps.error) return NextResponse.json({ error: opps.error.message }, { status: 500 });

  const qualified = (opps.data || []).filter((o: any) => o?.metadata?.gate === 'qualified');
  const ids = qualified.map((o: any) => o.id);
  const competitorCounts: Record<string, number> = {}; const validationCounts: Record<string, number> = {}; const evidenceCounts: Record<string, number> = {}; const paidCounts: Record<string, number> = {};
  if (ids.length) {
    const [competitors, validations, evidence] = await Promise.all([
      c.from('competitors').select('opportunity_id').in('opportunity_id', ids),
      c.from('validation_experiments').select('opportunity_id').in('opportunity_id', ids),
      c.from('evidence').select('opportunity_id,raw_document_id').in('opportunity_id', ids),
    ]);
    for (const row of competitors.data || []) competitorCounts[row.opportunity_id] = (competitorCounts[row.opportunity_id] || 0) + 1;
    for (const row of validations.data || []) validationCounts[row.opportunity_id] = (validationCounts[row.opportunity_id] || 0) + 1;
    for (const row of evidence.data || []) evidenceCounts[row.opportunity_id] = (evidenceCounts[row.opportunity_id] || 0) + 1;
    const rawIds = [...new Set((evidence.data || []).map((r: any) => r.raw_document_id).filter(Boolean))];
    if (rawIds.length) {
      const analyses = await c.from('document_analyses').select('raw_document_id,is_paid').in('raw_document_id', rawIds);
      const paidSet = new Set((analyses.data || []).filter((r: any) => r.is_paid).map((r: any) => r.raw_document_id));
      for (const row of evidence.data || []) if (paidSet.has(row.raw_document_id)) paidCounts[row.opportunity_id] = (paidCounts[row.opportunity_id] || 0) + 1;
    }
  }
  const opportunities = qualified.map((o: any) => {
    const problem = Array.isArray(o.problems) ? o.problems[0] || null : o.problems || null;
    const q = o.metadata?.quality_gate || {};
    return { id: o.id, name: o.name, description: o.description, score: o.score, problem_id: o.problem_id, problem, competitor_count: competitorCounts[o.id] || 0, validation_count: validationCounts[o.id] || 0, evidence_count: evidenceCounts[o.id] || Number(q.evidence_count || 0), paid_evidence_count: paidCounts[o.id] || Number(q.paid_evidence_count || 0), source_count: Number(q.source_count || 0), quality_gate: q };
  });
  return NextResponse.json({ ok: true, runs: runs.data || [], topics: topics.data || [], opportunities, sources: { reddit: true, web: true, github: true, x: true, x_collection: process.env.X_BEARER_TOKEN ? 'x-api' : 'public-search' } });
}
