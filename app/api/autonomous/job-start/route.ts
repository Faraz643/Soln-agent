import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pickTopic } from '@/lib/autonomous-discovery';
import { isApiAuthorized } from '@/lib/api-auth';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export async function POST(request: NextRequest) {
  if (!(await isApiAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db();
  const { data: active } = await c.from('agent_runs').select('id,status,topic,metadata,started_at').in('status', ['running', 'processing']).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (active) return NextResponse.json({ ok: true, resumed: true, agent_run_id: active.id, topic: active.topic, status: active.status, metadata: active.metadata || {} });

  let topic: any;
  try { topic = await pickTopic(); } catch (e: any) { return NextResponse.json({ error: e?.message || 'Could not choose a research topic' }, { status: 503 }); }
  if (!topic?.topic) return NextResponse.json({ error: 'No research topic available' }, { status: 503 });

  const sources = ['reddit', 'web', 'github', ...(process.env.X_BEARER_TOKEN ? ['x'] : [])];
  const metadata = { version: 5, autonomous: true, phase: 'discover', source_index: 0, sources, topic_id: topic.id, analyzed_count: 0, analysis_cap: 12, clustered: false, enriched: [] };
  const { data: run, error } = await c.from('agent_runs').insert({ kind: 'discovery_cycle', status: 'running', topic: topic.topic, metadata }).select('id').single();
  if (error || !run) return NextResponse.json({ error: error?.message || 'Could not create agent run' }, { status: 500 });

  const { data: master, error: masterError } = await c.from('discovery_runs').insert({ query: topic.topic, status: 'running', sources, metadata: { autonomous_agent_run_id: run.id, version: 5 } }).select('id').single();
  if (masterError || !master) {
    await c.from('agent_runs').update({ status: 'error', error: masterError?.message || 'Could not create research run', completed_at: new Date().toISOString() }).eq('id', run.id);
    return NextResponse.json({ error: masterError?.message || 'Could not create research run' }, { status: 500 });
  }

  await c.from('agent_runs').update({ metadata: { ...metadata, master_discovery_run_id: master.id } }).eq('id', run.id);
  return NextResponse.json({ ok: true, resumed: false, agent_run_id: run.id, topic: topic.topic, status: 'running', phase: 'discover', sources });
}
