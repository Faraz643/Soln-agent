import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function authorized(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  try {
    const cs = await cookies();
    const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } });
    return !!(await c.auth.getUser()).data.user;
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db();
  const [runs, topics, opps] = await Promise.all([
    c.from('agent_runs').select('id,status,topic,signals_collected,signals_analyzed,problems_found,opportunities_found,started_at,completed_at,error').order('started_at', { ascending: false }).limit(20),
    c.from('discovery_topics').select('id,topic,priority,last_researched_at,times_researched').eq('status', 'active').order('priority', { ascending: false }).limit(20),
    c.from('opportunities').select('id,name,description,score,problem_id,problems(title,target_customer,demand_score,pain_score,payment_score)').order('score', { ascending: false }).limit(10),
  ]);
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  if (opps.error) return NextResponse.json({ error: opps.error.message }, { status: 500 });
  const ids = (opps.data || []).map((o: any) => o.id);
  const competitorCounts: Record<string, number> = {}; const validationCounts: Record<string, number> = {};
  if (ids.length) {
    const [competitors, validations] = await Promise.all([
      c.from('competitors').select('opportunity_id').in('opportunity_id', ids),
      c.from('validation_experiments').select('opportunity_id').in('opportunity_id', ids),
    ]);
    for (const row of competitors.data || []) competitorCounts[row.opportunity_id] = (competitorCounts[row.opportunity_id] || 0) + 1;
    for (const row of validations.data || []) validationCounts[row.opportunity_id] = (validationCounts[row.opportunity_id] || 0) + 1;
  }
  const opportunities = (opps.data || []).map((o: any) => {
    const problem = Array.isArray(o.problems) ? o.problems[0] || null : o.problems || null;
    return { id: o.id, name: o.name, description: o.description, score: o.score, problem_id: o.problem_id, problem, competitor_count: competitorCounts[o.id] || 0, validation_count: validationCounts[o.id] || 0 };
  });
  return NextResponse.json({ ok: true, runs: runs.data || [], topics: topics.data || [], opportunities, sources: { reddit: true, web: true, github: true, x: !!process.env.X_BEARER_TOKEN } });
}
