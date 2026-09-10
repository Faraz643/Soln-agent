import Link from 'next/link';
import { AppShell, Score } from '@/components/app-shell';
import { getAnalyses } from '@/lib/intelligence-data';

export default async function OpportunitiesPage() {
  const rows = (await getAnalyses(100)).filter(a => a.is_problem).sort((a,b) => Number(b.opportunity_score||0)-Number(a.opportunity_score||0));
  const top = rows[0];
  return <AppShell active="Opportunities"><div className="content">
    <div className="eyebrow">Opportunity intelligence</div><h1>What could become a product?</h1>
    <p className="lead">Ranked by pain, demand, willingness to pay, evidence quality, urgency, workarounds and competitive pressure.</p>
    {top && <div className="hero-card"><div className="hero-grid"><div><div className="small">Highest-scoring opportunity</div><h2 style={{margin:'7px 0 8px',fontSize:24}}>{top.opportunity_summary || top.problem_summary}</h2><div className="muted">{top.problem_summary}</div><div className="tag-row">{(top.customer_segments || []).map(s => <span className="tag" key={s}>{s}</span>)}</div></div><div><div className="small">Opportunity</div><div className="hero-score">{Math.round(Number(top.opportunity_score||0))}</div></div></div><div className="scores" style={{marginTop:20}}><Score value={top.pain_score} label="Pain"/><Score value={top.demand_score} label="Demand"/><Score value={top.payment_score} label="Willingness to pay"/><Score value={top.evidence_quality} label="Evidence"/></div></div>}
    <div className="card"><div className="section-head"><h2>Ranked opportunities</h2><span className="note">{rows.length} signals</span></div>{rows.length ? <table className="table"><thead><tr><th>Problem / opportunity</th><th>Demand</th><th>Pain</th><th>Pay</th><th>Score</th><th>Confidence</th></tr></thead><tbody>{rows.map(a => <tr key={a.id}><td><Link className="title-cell link" href={`/opportunities/${a.raw_document_id}`}>{a.opportunity_summary || a.problem_summary}</Link><div className="small">{a.problem_summary}</div></td><td>{Math.round(Number(a.demand_score||0))}</td><td>{Math.round(Number(a.pain_score||0))}</td><td>{Math.round(Number(a.payment_score||0))}</td><td><strong>{Math.round(Number(a.opportunity_score||0))}</strong></td><td>{Math.round(Number(a.confidence_score||0))}%</td></tr>)}</tbody></table> : <div className="empty">No problem signals have been analyzed yet.</div>}</div>
  </div></AppShell>;
}
