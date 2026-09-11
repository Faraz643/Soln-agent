import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markTopic } from '@/lib/autonomous-discovery';
import { isApiAuthorized } from '@/lib/api-auth';

export const maxDuration = 55;
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
  if (current.status === 'processing') {
    const age = Date.now() - new Date(current.updated_at || current.started_at).getTime();
    if (age < 120000) return NextResponse.json({ ok: true, busy: true, done: false, phase: meta(current.metadata).phase || 'working' });
    await c.from('agent_runs').update({ status: 'running' }).eq('id', id).eq('status', 'processing');
  }
  const claimed = await c.from('agent_runs').update({ status: 'processing' }).eq('id', id).eq('status', 'running').select('id').maybeSingle();
  if (!claimed.data) return NextResponse.json({ ok: true, busy: true, done: false });

  try {
    const m = meta(current.metadata);
    const masterId = String(m.master_discovery_run_id || '');
    const sources: string[] = Array.isArray(m.sources) ? m.sources : ['reddit', 'x', 'web', 'github'];
    const queries: string[] = Array.isArray(m.research_queries) ? m.research_queries : [];
    const analysisCap = Math.min(Math.max(Number(m.analysis_cap || 48), 12), 60);

    if (m.phase === 'discover') {
      if (!masterId) throw new Error('Master discovery run is missing');
      if (!queries.length) throw new Error('Open-mind research plan is empty');
      let queryIndex = Number(m.query_index || 0);
      let sourceIndex = Number(m.source_index || 0);
      if (queryIndex >= queries.length) {
        await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'analyze' } }).eq('id', id);
        await c.from('discovery_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', masterId);
        return NextResponse.json({ ok: true, done: false, phase: 'analyze', message: 'Open-mind collection complete. Starting evidence analysis.', research_lenses: queries.length });
      }
      if (sourceIndex >= sources.length) {
        queryIndex += 1;
        sourceIndex = 0;
        if (queryIndex >= queries.length) {
          await c.from('agent_runs').update({ status: 'running', metadata: { ...m, query_index: queryIndex, source_index: 0, phase: 'analyze' } }).eq('id', id);
          await c.from('discovery_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', masterId);
          return NextResponse.json({ ok: true, done: false, phase: 'analyze', message: 'Open-mind collection complete. Starting evidence analysis.', research_lenses: queries.length });
        }
      }
      const researchQuery = queries[queryIndex];
      const source = sources[sourceIndex];
      const discovery = await internalPost(request, '/api/discover', { query: researchQuery, sources: [source] });
      const childId = String(discovery.run_id || '');
      if (!childId) throw new Error(`Discovery did not return a run id for ${source}`);
      const { data: links, error: linksError } = await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id', childId);
      if (linksError) throw linksError;
      if (links?.length) {
        const copied = await c.from('discovery_run_documents').upsert(links.map((x: any) => ({ discovery_run_id: masterId, raw_document_id: x.raw_document_id })), { onConflict: 'discovery_run_id,raw_document_id', ignoreDuplicates: true });
        if (copied.error) throw copied.error;
      }
      const totalSignals = Number(current.signals_collected || 0) + Number(discovery.signals_collected || 0);
      const progress = { ...(meta(m.source_progress)), [`${queryIndex}:${source}`]: Number(discovery.signals_collected || 0) };
      const nextSource = sourceIndex + 1;
      await c.from('agent_runs').update({ status: 'running', signals_collected: totalSignals, metadata: { ...m, query_index: queryIndex, source_index: nextSource, source_progress: progress, current_lens: researchQuery, current_source: source } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: 'discover', source, lens: researchQuery, lens_index: queryIndex + 1, lenses_total: queries.length, signals_collected: discovery.signals_collected || 0 });
    }

    if (m.phase === 'analyze') {
      const { data: links, error: linkError } = await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id', masterId).limit(1000);
      if (linkError) throw linkError;
      const ids = [...new Set((links || []).map((x: any) => x.raw_document_id).filter(Boolean))];
      if (!ids.length) throw new Error('No public evidence was collected');
      const { data: doneRows, error: doneError } = await c.from('document_analyses').select('raw_document_id,status').in('raw_document_id', ids).in('status', ['rejected', 'candidate', 'verified']);
      if (doneError) throw doneError;
      const doneSet = new Set((doneRows || []).map((x: any) => x.raw_document_id));
      if (doneSet.size >= analysisCap) {
        await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'cluster' } }).eq('id', id);
        return NextResponse.json({ ok: true, done: false, phase: 'cluster', message: `Evidence analysis cap of ${analysisCap} reached.` });
      }
      const batchSize = Math.min(4, analysisCap - doneSet.size);
      const pending = ids.filter((x: string) => !doneSet.has(x)).slice(0, batchSize);
      if (pending.length) {
        const result = await internalPost(request, '/api/analyze', { raw_document_ids: pending, limit: pending.length });
        const analyzedCount = Number(current.signals_analyzed || 0) + Number(result.analyzed || pending.length);
        await c.from('agent_runs').update({ status: 'running', signals_analyzed: analyzedCount, metadata: { ...m, analyzed_count: analyzedCount } }).eq('id', id);
        return NextResponse.json({ ok: true, done: false, phase: 'analyze', analyzed: result.analyzed || pending.length, analyzed_count: analyzedCount, remaining_estimate: Math.max(0, ids.length - doneSet.size - pending.length) });
      }
      await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'cluster' } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: 'cluster', message: 'Evidence analysis complete.' });
    }

    if (m.phase === 'cluster') {
      const cluster = await internalPost(request, '/api/cluster', { run_id: masterId, limit: 1000 });
      const opportunityIds = Array.isArray(cluster.opportunity_ids) ? cluster.opportunity_ids : [];
      await c.from('agent_runs').update({ status: 'running', problems_found: Number(cluster.problems || 0), opportunities_found: Number(cluster.opportunities || 0), metadata: { ...m, phase: opportunityIds.length ? 'competition' : 'finish', clustered: true, opportunity_ids: opportunityIds, competition_index: 0, rejected_groups: Number(cluster.rejected_groups || 0) } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: opportunityIds.length ? 'competition' : 'finish', problems: cluster.problems || 0, opportunities: cluster.opportunities || 0, rejected_groups: cluster.rejected_groups || 0 });
    }

    if (m.phase === 'competition') {
      const opportunityIds: string[] = Array.isArray(m.opportunity_ids) ? m.opportunity_ids : [];
      const index = Number(m.competition_index || 0);
      if (index >= opportunityIds.length) {
        await c.from('agent_runs').update({ status: 'running', metadata: { ...m, phase: 'finish', competition_complete: true } }).eq('id', id);
        return NextResponse.json({ ok: true, done: false, phase: 'finish' });
      }
      const opportunityId = opportunityIds[index];
      const result = await internalPost(request, '/api/competition', { opportunity_id: opportunityId });
      await c.from('agent_runs').update({ status: 'running', metadata: { ...m, competition_index: index + 1, competition_results: [...(Array.isArray(m.competition_results) ? m.competition_results : []), { opportunity_id: opportunityId, found: Number(result.found || 0) }] } }).eq('id', id);
      return NextResponse.json({ ok: true, done: false, phase: index + 1 >= opportunityIds.length ? 'finish' : 'competition', competition: { opportunity_id: opportunityId, found: result.found || 0 }, progress: index + 1, total: opportunityIds.length });
    }

    if (m.phase === 'finish') {
      await c.from('agent_runs').update({ status: 'completed', completed_at: new Date().toISOString(), metadata: { ...m, phase: 'completed' } }).eq('id', id);
      return NextResponse.json({ ok: true, done: true, phase: 'completed' });
    }
    throw new Error(`Unknown autonomous phase: ${String(m.phase)}`);
  } catch (e: any) {
    const message = e?.message || 'Autonomous step failed';
    await c.from('agent_runs').update({ status: 'error', error: message, completed_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ error: message, agent_run_id: id }, { status: 500 });
  }
}
