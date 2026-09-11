import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildOpenResearchPlan } from '@/lib/open-discovery';
import { isApiAuthorized } from '@/lib/api-auth';

export const maxDuration = 20;
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export async function POST(request: NextRequest) {
  if (!(await isApiAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db();
  const { data: active } = await c.from('agent_runs').select('id,status,topic,metadata,started_at').in('status', ['running', 'processing']).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (active) return NextResponse.json({ ok: true, resumed: true, agent_run_id: active.id, topic: active.topic, status: active.status, metadata: active.metadata || {} });

  let plan: string[];
  try { plan = await buildOpenResearchPlan(); } catch (e: any) { return NextResponse.json({ error: e?.message || 'Could not build the discovery plan' }, { status: 503 }); }
  if (!plan.length) return NextResponse.json({ error: 'No discovery lenses are available.' }, { status: 503 });

  // One click creates a saved research mission. There is no cron dependency.
  // The plan is deliberately open-ended: the agent searches for pain patterns rather
  // than asking the user to supply a market/topic.
  const sources = ['reddit', 'x', 'web', 'github'];
  const metadata = {
    version: 8,
    autonomous: true,
    mode: 'open_mind',
    phase: 'discover',
    source_index: 0,
    query_index: 0,
    sources,
    research_queries: plan,
    analyzed_count: 0,
    analysis_cap: 48,
    clustered: false,
    source_progress: {},
  };
  const missionName = 'Open-mind discovery';
  const { data: run, error } = await c.from('agent_runs').insert({ kind: 'discovery_cycle', status: 'running', topic: missionName, metadata }).select('id').single();
  if (error || !run) return NextResponse.json({ error: error?.message || 'Could not create agent run' }, { status: 500 });

  const { data: master, error: masterError } = await c.from('discovery_runs').insert({ query: missionName, status: 'running', sources, metadata: { autonomous_agent_run_id: run.id, version: 8, mode: 'open_mind', research_queries: plan } }).select('id').single();
  if (masterError || !master) {
    await c.from('agent_runs').update({ status: 'error', error: masterError?.message || 'Could not create research run', completed_at: new Date().toISOString() }).eq('id', run.id);
    return NextResponse.json({ error: masterError?.message || 'Could not create research run' }, { status: 500 });
  }

  await c.from('agent_runs').update({ metadata: { ...metadata, master_discovery_run_id: master.id } }).eq('id', run.id);
  return NextResponse.json({ ok: true, resumed: false, agent_run_id: run.id, topic: missionName, status: 'running', phase: 'discover', sources, research_lenses: plan.length });
}
