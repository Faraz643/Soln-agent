import Link from 'next/link';
import { AppShell, Score } from '@/components/app-shell';
import { createClient } from '@supabase/supabase-js';

async function data(id: string) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: o } = await db.from('opportunities').select('*,problems(*)').eq('id', id).maybeSingle();
  if (!o) return null;
  const [c, v, e] = await Promise.all([
    db.from('competitors').select('*').eq('opportunity_id', o.id).order('confidence', { ascending: false }),
    db.from('validation_experiments').select('*').eq('opportunity_id', o.id).order('created_at', { ascending: false }).limit(1),
    db.from('evidence').select('*,raw_documents(url,title,metadata,sources(type,name))').eq('opportunity_id', o.id).order('strength', { ascending: false }).limit(40),
  ]);
  return { o, competitors: c.data || [], validation: v.data?.[0], evidence: e.data || [] };
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const d = await data(id);
  if (!d) return <AppShell active="Opportunities"><div className="content"><div className="empty">Opportunity not found.</div></div></AppShell>;
  const { o, competitors, validation, evidence } = d; const p = o.problems || {}; const meta = o.metadata || {}; const gate = meta.quality_gate || {};
  const sourceUrls = Array.isArray(meta.source_urls) ? meta.source_urls : [];
  return <AppShell active="Opportunities"><div className="content">
    <Link href="/opportunities" className="link">← Opportunities</Link>
    <div className="hero-card" style={{ marginTop: 14 }}><div className="hero-grid"><div><div className="small">Product opportunity</div><h1 style={{ fontSize: 32 }}>{o.name}</h1><p>{o.description || 'A focused product direction derived from observed customer pain.'}</p><div className="tag-row">{String(p.target_customer || '').split(',').filter(Boolean).map((x: string) => <span className="tag" key={x}>{x.trim()}</span>)}</div></div><div><div className="small">Worth building</div><div className="hero-score">{Math.round(Number(o.score || 0))}</div><div className="small">/100 evidence score</div></div></div></div>

    <div className="grid section"><div className="card"><div className="muted">People / signals</div><div className="metric">{Number(meta.participant_count || meta.evidence_count || evidence.length || 0)}</div><div className="muted">distinct participants where identifiable</div></div><div className="card"><div className="muted">Conversations</div><div className="metric">{Number(meta.evidence_count || evidence.length || 0)}</div><div className="muted">supporting evidence signals</div></div><div className="card"><div className="muted">Sources</div><div className="metric">{Number(meta.source_count || 0)}</div><div className="muted">independent source types</div></div><div className="card"><div className="muted">Payment evidence</div><div className="metric">{Number(meta.paid_evidence_count || 0)}</div><div className="muted">explicit or strong payment signals</div></div></div>

    <div className="card"><h2>Why this is interesting</h2><div className="scores"><Score value={p.demand_score} label="Demand"/><Score value={p.pain_score} label="Pain"/><Score value={p.payment_score} label="Willingness to pay"/><Score value={p.opportunity_score} label="Opportunity"/></div><div className="section two-col"><div><strong>Evidence quality</strong><p className="muted">{gate.evidence ?? '—'}/100 · confidence {gate.confidence ?? '—'}/100</p></div><div><strong>Recurring problem</strong><p className="muted">{gate.recurring ? 'Yes — repeated evidence was found.' : 'Not yet established.'} {gate.cross_source ? 'Evidence crosses multiple source types.' : ''}</p></div></div></div>

    <div className="card"><div className="section-head"><h2>What could be built</h2><span className="small">Derived from the problem, not invented from a trend</span></div><p>{o.description || 'The agent found a focused workflow that can be improved with a dedicated product.'}</p></div>

    <div className="card"><div className="section-head"><h2>Evidence from the internet</h2><span className="small">Every result links back to its source</span></div>{evidence.length ? evidence.slice(0, 20).map((x: any) => { const raw = x.raw_documents || {}; const source = raw.sources?.name || x.signal_type || 'Source'; return <div className="trend" key={x.id}><div><div className="title-cell">{x.excerpt || 'Evidence signal'}</div><div className="small">{source} · strength {Math.round(Number(x.strength || 0))}</div>{raw.url && <a className="link" href={raw.url} target="_blank" rel="noreferrer">Open original →</a>}</div><Score value={x.strength} label="Evidence"/></div>; }) : <div className="empty">No evidence linked yet.</div>}</div>

    {sourceUrls.length > 0 && <div className="card"><h2>Source trail</h2>{sourceUrls.slice(0, 20).map((s: any, i: number) => <div className="trend" key={`${s.url}-${i}`}><div><div className="small">{s.source}</div><a className="link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></div></div>)}</div>}

    <div className="section two-col"><div className="card"><h2>Existing solutions</h2>{competitors.length ? competitors.map((c: any) => <div className="trend" key={c.id}><div><div className="title-cell">{c.name}</div><div className="small">{c.description}</div>{c.url && <a className="link" href={c.url} target="_blank" rel="noreferrer">Visit →</a>}</div><Score value={c.confidence} label="Confidence"/></div>) : <div className="empty">No reliable competitor evidence found yet.</div>}</div><div className="card"><h2>Validation direction</h2>{validation ? <><div className="title-cell">{validation.concept_name}</div><p className="muted">{validation.value_proposition}</p></> : <div className="empty">The opportunity is ready for human validation. Start by interviewing the affected customer segment and testing willingness to pay.</div>}</div></div>
  </div></AppShell>;
}
