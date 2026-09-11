import Link from 'next/link';
import { AppShell, Score } from '@/components/app-shell';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await db.from('opportunities').select('id,name,description,score,metadata,problems(title,target_customer,demand_score,pain_score,payment_score,opportunity_score)').order('score', { ascending: false }).limit(100);
  const rows = (data || []).filter((o: any) => o.metadata?.gate === 'qualified'); const top: any = rows[0];
  return <AppShell active="Opportunities"><div className="content">
    <div className="eyebrow">Opportunity intelligence</div><h1>What could become a product?</h1>
    <p className="lead">Only opportunities that passed the evidence gate are shown. Each result has a concrete problem, supporting conversations, source trail, payment signals and competitive research.</p>
    {top && <div className="hero-card"><div className="hero-grid"><div><div className="small">Highest-scoring opportunity</div><h2 style={{ margin: '7px 0 8px', fontSize: 24 }}>{top.name}</h2><div className="muted">{top.problems?.title}</div><div className="tag-row">{String(top.problems?.target_customer || '').split(',').filter(Boolean).map((s: string) => <span className="tag" key={s}>{s.trim()}</span>)}</div></div><div><div className="small">Worth building</div><div className="hero-score">{Math.round(Number(top.score || 0))}</div></div></div><div className="scores" style={{ marginTop: 20 }}><Score value={top.problems?.pain_score} label="Pain"/><Score value={top.problems?.demand_score} label="Demand"/><Score value={top.problems?.payment_score} label="Willingness to pay"/><Score value={top.score} label="Opportunity"/></div></div>}
    <div className="card"><div className="section-head"><h2>Ranked opportunities</h2><span className="note">{rows.length} qualified</span></div>{rows.length ? <div>{rows.map((o: any) => { const q = o.metadata?.quality_gate || {}; return <Link className="trend" href={`/opportunities/${o.id}`} key={o.id}><div><div className="title-cell">{o.name}</div><div className="small">{o.problems?.target_customer || 'Customer segment'} · {q.evidence_count || 0} signals · {q.source_count || 0} sources · {q.paid_evidence_count || 0} payment signals</div></div><Score value={o.score} label="Opportunity"/></Link>; })}</div> : <div className="empty">No qualified opportunities yet. Run one discovery mission from Overview.</div>}</div>
  </div></AppShell>;
}
