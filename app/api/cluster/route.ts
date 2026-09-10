import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isApiAuthorized } from '@/lib/api-auth';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !['problem','problems','users','user','people','need','needs','want','using','tool','tools','system','customer','customers'].includes(w)).slice(0, 12).sort().join(' ');
const avg = (list: any[], field: string) => Math.round(list.reduce((s: number, x: any) => s + Number(x[field] || 0), 0) / Math.max(1, list.length));
const uniqueSources = (list: any[]) => new Set(list.map((x: any) => String(x.evidence?.source || 'unknown'))).size;

function opportunityScore(list: any[]) {
  const pain = avg(list, 'pain_score');
  const demand = avg(list, 'demand_score');
  const payment = avg(list, 'payment_score');
  const evidence = avg(list, 'evidence_quality');
  const urgency = avg(list, 'urgency_score');
  const workaround = avg(list, 'workaround_score');
  const competition = avg(list, 'competition_score');
  return Math.round(pain * .25 + demand * .25 + payment * .10 + evidence * .15 + urgency * .10 + workaround * .10 + (100 - competition) * .05);
}

export async function POST(req: NextRequest) {
  if (!(await isApiAuthorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const runId = typeof b.run_id === 'string' ? b.run_id : null;
  if (!runId) return NextResponse.json({ error: 'run_id is required' }, { status: 400 });
  const limit = Math.min(Math.max(Number(b.limit) || 300, 1), 500);
  const c = db();
  const run = await c.from('discovery_runs').select('id,query').eq('id', runId).single();
  if (run.error || !run.data) return NextResponse.json({ error: run.error?.message || 'Research run not found' }, { status: 404 });
  const links = await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id', runId).limit(limit);
  if (links.error) return NextResponse.json({ error: links.error.message }, { status: 500 });
  const ids = (links.data || []).map((x: any) => x.raw_document_id);
  if (!ids.length) return NextResponse.json({ ok: true, run_id: runId, query: run.data.query, groups: 0, problems: 0, opportunities: 0, evidence: 0, opportunity_ids: [], rejected_groups: 0 });

  const analyzed = await c.from('document_analyses').select('*,raw_documents(id,url,title,published_at,collected_at,metadata)').in('raw_document_id', ids).eq('is_problem', true).in('status', ['candidate', 'verified']).order('analyzed_at', { ascending: false });
  if (analyzed.error) return NextResponse.json({ error: analyzed.error.message }, { status: 500 });

  const groups = new Map<string, any[]>();
  for (const r of analyzed.data || []) {
    if (Number(r.evidence_quality || 0) < 45 || Number(r.topic_relevance_score || r.evidence?.topic_relevance?.score || 0) < 60) continue;
    const k = key(r.problem_summary || r.opportunity_summary || '');
    if (!k) continue;
    const a = groups.get(k) || []; a.push(r); groups.set(k, a);
  }

  let problems = 0, opportunities = 0, evidence = 0, rejectedGroups = 0;
  const opportunity_ids: string[] = [];

  for (const [k, list] of groups) {
    const sourceCount = uniqueSources(list);
    const recentCount = list.filter((x: any) => !x.is_stale).length;
    const pain = avg(list, 'pain_score');
    const demand = avg(list, 'demand_score');
    const payment = avg(list, 'payment_score');
    const evidenceQuality = avg(list, 'evidence_quality');
    const confidence = avg(list, 'confidence_score');
    const relevance = Math.round(list.reduce((s: number, x: any) => s + Number(x.evidence?.topic_relevance?.score || x.topic_relevance_score || 0), 0) / Math.max(1, list.length));
    const urgency = avg(list, 'urgency_score');
    const workaround = avg(list, 'workaround_score');
    const competition = avg(list, 'competition_score');
    const score = opportunityScore(list);

    // A problem can be surfaced from one strong signal. A product opportunity needs
    // corroboration: repeated evidence, cross-source evidence, or unusually explicit
    // payment/workflow evidence. The thresholds are intentionally strict enough to
    // suppress keyword noise but practical enough that normal source fragmentation does
    // not make the product-output page permanently empty.
    const recurring = list.length >= 2;
    const crossSource = sourceCount >= 2;
    const strongPaid = payment >= 75 && evidenceQuality >= 60;
    const strongSingleSignal = list.length === 1 && payment >= 85 && pain >= 75 && demand >= 70 && evidenceQuality >= 75 && confidence >= 70;
    const qualifiesProblem = relevance >= 70 && confidence >= 55 && evidenceQuality >= 50 && pain >= 45;
    const qualifiesOpportunity = qualifiesProblem && recentCount > 0 && score >= 68 && pain >= 55 && demand >= 55 && evidenceQuality >= 55 && confidence >= 55 && (crossSource || recurring || strongPaid || strongSingleSignal);
    if (!qualifiesProblem) { rejectedGroups++; continue; }

    const best = [...list].sort((a: any, b: any) => (Number(b.evidence_quality || 0) + Number(b.demand_score || 0) + Number(b.pain_score || 0)) - (Number(a.evidence_quality || 0) + Number(a.demand_score || 0) + Number(a.pain_score || 0)))[0];
    const title = String(best.problem_summary || 'Unspecified customer problem').replace(/\s+/g, ' ').trim().slice(0, 240);
    const seg = [...new Set(list.flatMap((x: any) => Array.isArray(x.customer_segments) ? x.customer_segments : []))] as string[];
    const target = seg.join(', ') || 'Customer segment requires validation';
    const metadata = {
      cluster_key: k,
      segments: seg,
      source_count: sourceCount,
      evidence_count: list.length,
      recent_evidence_count: recentCount,
      last_research_run_id: runId,
      research_query: run.data.query,
      quality_gate: { relevance, confidence, evidence: evidenceQuality, pain, demand, payment, urgency, workaround, competition, opportunity_score: score, recurring, cross_source: crossSource, strong_paid: strongPaid },
    };

    const existing = await c.from('problems').select('id').eq('title', title).limit(1).maybeSingle();
    let pid = existing.data?.id;
    const payload = { title, summary: title, target_customer: target, category: (best.technologies || [])[0] || 'General', pain_score: pain, demand_score: demand, payment_score: payment, opportunity_score: score, mention_count: list.length, last_seen_at: new Date().toISOString(), metadata };
    if (pid) { const upd = await c.from('problems').update(payload).eq('id', pid); if (upd.error) continue; }
    else { const ins = await c.from('problems').insert(payload).select('id').single(); if (ins.error) continue; pid = ins.data?.id; }
    if (!pid) continue;
    problems++;

    let oid: string | null = null;
    if (qualifiesOpportunity) {
      const oppName = String(best.opportunity_summary || title).replace(/\s+/g, ' ').trim().slice(0, 180);
      const oe = await c.from('opportunities').select('id').eq('problem_id', pid).limit(1).maybeSingle();
      oid = oe.data?.id || null;
      const oppPayload = {
        name: oppName,
        description: best.opportunity_summary || null,
        score,
        updated_at: new Date().toISOString(),
        metadata: { ...metadata, gate: 'qualified', source_count: sourceCount, evidence_count: list.length },
      };
      if (oid) { const upd = await c.from('opportunities').update(oppPayload).eq('id', oid); if (upd.error) oid = null; }
      else { const ins = await c.from('opportunities').insert({ problem_id: pid, ...oppPayload }).select('id').single(); if (!ins.error) oid = ins.data?.id || null; }
      if (oid) { opportunities++; opportunity_ids.push(oid); }
    } else {
      rejectedGroups++;
    }

    for (const r of list.slice(0, 50)) {
      await c.from('problem_signals').upsert({ problem_id: pid, raw_document_id: r.raw_document_id, relevance: Math.round((Number(r.opportunity_score || 0) + Number(r.evidence_quality || 0)) / 2), evidence_quality: r.evidence_quality }, { onConflict: 'problem_id,raw_document_id' });
      if (oid) {
        await c.from('evidence').insert({ problem_id: pid, opportunity_id: oid, raw_document_id: r.raw_document_id, signal_type: String(r.evidence?.source || 'signal'), strength: r.evidence_quality, excerpt: String(r.evidence?.ai_evidence?.description || r.problem_summary || '').slice(0, 500) });
      }
      evidence++;
    }

    const end = new Date(); const start = new Date(end.getTime() - 30 * 86400000); const prior = new Date(start.getTime() - 30 * 86400000);
    const old = await c.from('trend_snapshots').select('mentions').eq('problem_id', pid).gte('period_start', prior.toISOString()).lt('period_end', start.toISOString()).order('period_end', { ascending: false }).limit(1).maybeSingle();
    const growth = old.data?.mentions ? ((list.length - Number(old.data.mentions)) / Number(old.data.mentions)) * 100 : null;
    await c.from('trend_snapshots').upsert({ problem_id: pid, period_start: start.toISOString(), period_end: end.toISOString(), mentions: list.length, demand_score: demand, pain_score: pain, growth_rate: growth }, { onConflict: 'problem_id,period_start,period_end' });
  }

  await c.from('discovery_runs').update({ problems_found: problems, opportunities_found: opportunities }).eq('id', runId);
  return NextResponse.json({ ok: true, run_id: runId, query: run.data.query, groups: groups.size, problems, opportunities, evidence, opportunity_ids, rejected_groups: rejectedGroups });
}
