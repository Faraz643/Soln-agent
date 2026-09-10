import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markTopic } from '@/lib/autonomous-discovery';
import { isApiAuthorized } from '@/lib/api-auth';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const meta = (value: any) => value && typeof value === 'object' ? value : {};

async function internalPost(req: NextRequest, path: string, body: Record<string, unknown>) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) throw new Error('INGEST_SECRET is not configured');
  const r = await fetch(`${new URL(req.url).origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} failed (${r.status})`);
  return j;
}

export async function POST(request: NextRequest) {
  if (!(await isApiAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.agent_run_id === 'string' ? body.agent_run_id : null;
  if (!id) return NextResponse.json({ error: 'agent_run_id is required' }, { status: 400 });

  const c = db();
  const { data: current, error: loadError } = await c.from('agent_runs').select('*').eq('id', id).single();
  if (loadError || !current) return NextResponse.json({ error: loadError?.message || 'Agent run not found' }, { status: 404 });
  if (current.status === 'completed' || current.status === 'error') return NextResponse.json({ ok: current.status === 'completed', done: true, phase: meta(current.metadata).phase || current.status, run: current });
  if (current.status === 'processing') return NextResponse.json({ ok: true, busy: true, done: false, phase: meta(current.metadata).phase || 'working' });

  const claimed = await c.from('agent_runs').update({ status: 'processing' }).eq('id', id).eq('status', 'running').select('id').maybeSingle();
  if (!claimed.data) return NextResponse.json({ ok: true, busy: true, done: false });

  try {
    const m = meta(current.metadata);
    const topic = String(current.topic || '');
    const masterId = String(m.master_discovery_run_id || '');
    const sources: string[] = Array.isArray(m.sources) ? m.sources : ['reddit', 'web', 'github'];

    if (m.phase === 'discover') {
      const index = Number(m.source_index || 0);
      if (index >= sources.length) {
        await c.from('discovery_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', masterId);
        await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'analyze', source_index: 0 } }).eq('id', id);
        return NextResponse.json({ ok: true, done: false, phase: 'analyze', message: 'All sources collected. Starting evidence analysis.' });
      }

      const source = sources[index];
      const discovery = await internalPost(request, '/api/discover', { query: topic, sources: [source] });
      const childId = String(discovery.run_id || '');
      if (!childId) throw new Error(`Discovery did not return a run id for ${source}`);
      const { data: links, error: linksError } = await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id', childId);
      if (linksError) throw linksError;
      if (links?.length) {
        const copied = await c.from('discovery_run_documents').upsert(links.map((x: any) => ({ discovery_run_id: masterId, raw_document_id: x.raw_document_id })), { onConflict: 'discovery_run_id,raw_document_id', ignoreDuplicates: true });
        if (copied.error) throw copied.error;
      }
      const childRuns = Array.isArray(m.child_runs) ? m.child_runs : [];
      childRuns.push({ source, run_id: childId, signals: Number(discovery.signals_collected || 0) });
      const totalSignals = Number(current.signals_collected || 0) + Number(discovery.signals_collected || 0);
      await c.from('agent_runs').update({ status: 'running', signals_collected: totalSignals, metadata: { ...m, source_index: index + 1, child_runs: childRuns, phase: index + 1 >= sources.length ? 'analyze' : 'discover' } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: index + 1 >= sources.length ? 'analyze' : 'discover', source, signals_collected: discovery.signals_collected || 0 });
    }

    if (m.phase === 'analyze') {
      const { data: links, error: linkError } = await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id', masterId).limit(500);
      if (linkError) throw linkError;
      const ids = [...new Set((links || []).map((x: any) => x.raw_document_id).filter(Boolean))];
      if (!ids.length) throw new Error('No evidence was collected from enabled sources');
      const { data: doneRows, error: doneError } = await c.from('document_analyses').select('raw_document_id').in('raw_document_id', ids);
      if (doneError) throw doneError;
      const doneSet = new Set((doneRows || []).map((x: any) => x.raw_document_id));
      const pending = ids.filter((x: string) => !doneSet.has(x)).slice(0, 2);
      if (pending.length) {
        const result = await internalPost(request, '/api/analyze', { raw_document_ids: pending });
        const analyzedCount = Number(current.signals_analyzed || 0) + Number(result.analyzed || pending.length);
        await c.from('agent_runs').update({ status: 'running', signals_analyzed: analyzedCount, metadata: { ...m, analyzed_count: analyzedCount } }).eq('id', id);
        return NextResponse.json({ ok: true, done: false, phase: 'analyze', analyzed: result.analyzed || pending.length, analyzed_count: analyzedCount, remaining_estimate: Math.max(0, ids.length - doneSet.size - pending.length) });
      }
      await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'cluster' } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: 'cluster', message: 'Evidence analysis complete. Ranking problems and opportunities.' });
    }

    if (m.phase === 'cluster') {
      const cluster = await internalPost(request, '/api/cluster', { run_id: masterId, limit: 500 });
      await c.from('agent_runs').update({ status: 'running', problems_found: Number(cluster.problems || 0), opportunities_found: Number(cluster.opportunities || 0), metadata: { ...m, phase: 'finish', clustered: true, opportunity_ids: cluster.opportunity_ids || [] } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: 'finish', problems: cluster.problems || 0, opportunities: cluster.opportunities || 0 });
    }

    if (m.phase === 'finish') {
      await c.from('agent_runs').update({ status: 'completed', completed_at: new Date().toISOString(), metadata: { ...m, phase: 'completed' } }).eq('id', id);
      if (m.topic_id) await markTopic(String(m.topic_id), true);
      return NextResponse.json({ ok: true, done: true, phase: 'completed' });
    }

    throw new Error(`Unknown autonomous phase: ${String(m.phase)}`);
  } catch (e: any) {
    const message = e?.message || 'Autonomous step failed';
    await c.from('agent_runs').update({ status: 'error', error: message, completed_at: new Date().toISOString() }).eq('id', id);
    const topicId = meta(current.metadata).topic_id;
    if (topicId) await markTopic(String(topicId), false);
    return NextResponse.json({ error: message, agent_run_id: id }, { status: 500 });
  }
}
