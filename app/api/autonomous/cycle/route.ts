import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pickTopic, markTopic } from '@/lib/autonomous-discovery';

export const maxDuration = 60;
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

function authorized(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function call(path: string, body: Record<string, unknown>, origin: string) {
  const secret = process.env.INGEST_SECRET;
  const r = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} failed`);
  return j;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db(); const topic = await pickTopic();
  if (!topic) return NextResponse.json({ error: 'No autonomous discovery topic available' }, { status: 503 });
  const { data: run, error } = await c.from('agent_runs').insert({ kind: 'discovery_cycle', status: 'running', topic: topic.topic, metadata: { topic_id: topic.id } }).select('id').single();
  if (error || !run) return NextResponse.json({ error: error?.message || 'Could not create agent run' }, { status: 500 });

  try {
    const origin = new URL(request.url).origin;
    const discovery = await call('/api/discover', { query: topic.topic, sources: ['reddit', 'web', 'github', 'x'] }, origin);
    const analysis = await call('/api/analyze', { run_id: discovery.run_id, limit: 12 }, origin);
    let cluster: any = {};
    try { cluster = await call('/api/cluster', { run_id: discovery.run_id, limit: 100 }, origin); } catch (e: any) { cluster = { error: e?.message || 'Cluster failed' }; }
    const analyzed = Number(analysis.analyzed || 0); const problems = Number(cluster.problems || analysis.results?.filter((x: any) => x.is_problem && x.status !== 'rejected').length || 0); const opportunities = Number(cluster.opportunities || analysis.results?.filter((x: any) => x.is_problem && Number(x.opportunity_score || 0) >= 75).length || 0);
    await c.from('agent_runs').update({ status: 'completed', signals_collected: Number(discovery.signals_collected || 0), signals_analyzed: analyzed, problems_found: problems, opportunities_found: opportunities, metadata: { discovery_run_id: discovery.run_id, x_enabled: discovery.x_enabled, cluster }, completed_at: new Date().toISOString() }).eq('id', run.id);
    await markTopic(topic.id, true);
    return NextResponse.json({ ok: true, agent_run_id: run.id, topic: topic.topic, discovery, analysis: { analyzed, problems, opportunities }, cluster });
  } catch (e: any) {
    await c.from('agent_runs').update({ status: 'error', error: e?.message || 'Autonomous cycle failed', completed_at: new Date().toISOString() }).eq('id', run.id);
    await markTopic(topic.id, false);
    return NextResponse.json({ error: e?.message || 'Autonomous cycle failed', agent_run_id: run.id, topic: topic.topic }, { status: 500 });
  }
}
