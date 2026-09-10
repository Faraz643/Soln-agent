import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pickTopic, markTopic } from '@/lib/autonomous-discovery';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
function authorized(req: NextRequest) { const s = process.env.INGEST_SECRET; return !!s && req.headers.get('authorization') === `Bearer ${s}`; }
async function call(path: string, body: Record<string, unknown>, origin: string) {
  const r = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INGEST_SECRET}` }, body: JSON.stringify(body), cache: 'no-store' });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${path} failed`); return j;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db(); const topic = await pickTopic();
  if (!topic) return NextResponse.json({ error: 'No discovery topic available' }, { status: 503 });
  const { data: run, error } = await c.from('agent_runs').insert({ kind: 'discovery_cycle', status: 'running', topic: topic.topic, metadata: { topic_id: topic.id, version: 4, autonomous: true } }).select('id').single();
  if (error || !run) return NextResponse.json({ error: error?.message || 'Could not create agent run' }, { status: 500 });
  try {
    const origin = new URL(req.url).origin;
    const discovery = await call('/api/discover', { query: topic.topic, sources: ['reddit', 'web', 'github', 'x'] }, origin);
    const analysis = await call('/api/analyze', { run_id: discovery.run_id, limit: 12 }, origin);
    const cluster = await call('/api/cluster', { run_id: discovery.run_id, limit: 200 }, origin);
    const ids: string[] = Array.isArray(cluster.opportunity_ids) ? cluster.opportunity_ids.slice(0, 2) : [];
    const enriched: any[] = [];
    for (const opportunity_id of ids) {
      const item: any = { opportunity_id };
      try { const competition = await call('/api/competition', { opportunity_id }, origin); item.competitors = competition.found || 0; } catch (e: any) { item.competition_error = e?.message || 'Competition analysis failed'; }
      try { const validation = await call('/api/validate', { opportunity_id }, origin); item.validation_id = validation.validation?.id || null; item.validation_generated = !!validation.ok; } catch (e: any) { item.validation_error = e?.message || 'Validation plan failed'; }
      try { const mvp = await call('/api/mvp', { opportunity_id }, origin); item.mvp_generated = !!mvp.ok; item.mvp = mvp.mvp_specification || null; } catch (e: any) { item.mvp_error = e?.message || 'MVP generation failed'; }
      enriched.push(item);
    }
    const analyzed = Number(analysis.analyzed || 0), problems = Number(cluster.problems || 0), opportunities = Number(cluster.opportunities || 0);
    await c.from('agent_runs').update({ status: 'completed', signals_collected: Number(discovery.signals_collected || 0), signals_analyzed: analyzed, problems_found: problems, opportunities_found: opportunities, metadata: { version: 4, discovery_run_id: discovery.run_id, x_enabled: discovery.x_enabled, enriched }, completed_at: new Date().toISOString() }).eq('id', run.id);
    await markTopic(topic.id, true);
    return NextResponse.json({ ok: true, agent_run_id: run.id, topic: topic.topic, discovery, analysis: { analyzed, problems, opportunities }, cluster, enriched });
  } catch (e: any) {
    await c.from('agent_runs').update({ status: 'error', error: e?.message || 'Autonomous cycle failed', completed_at: new Date().toISOString() }).eq('id', run.id);
    await markTopic(topic.id, false);
    return NextResponse.json({ error: e?.message || 'Autonomous cycle failed', agent_run_id: run.id, topic: topic.topic }, { status: 500 });
  }
}
