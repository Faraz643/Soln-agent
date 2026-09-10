import { AppShell, Score } from '@/components/app-shell';
import { getAnalyses, groupProblems } from '@/lib/intelligence-data';

export default async function ProblemsPage() {
  const analyses = await getAnalyses(200);
  const groups = groupProblems(analyses);
  return <AppShell active="Problems"><div className="content"><div className="eyebrow">Problem intelligence</div><h1>What are people struggling with?</h1><p className="lead">Related signals are grouped into problem themes so repeated demand is easier to see than individual posts.</p><div className="card">{groups.length ? <table className="table"><thead><tr><th>Problem</th><th>Mentions</th><th>Pain</th><th>Demand</th><th>Payment</th><th>Opportunity</th></tr></thead><tbody>{groups.map(g => <tr key={g.key}><td><div className="title-cell">{g.title}</div><div className="small">{g.segments.slice(0,3).join(' · ') || 'Customer segment unclear'} · {g.sources.join(', ')}</div></td><td><strong>{g.mentions}</strong></td><td><Score value={g.pain}/></td><td><Score value={g.demand}/></td><td><Score value={g.payment}/></td><td><strong>{g.opportunity}</strong></td></tr>)}</tbody></table> : <div className="empty">No problem signals yet. Ingest a source and run analysis first.</div>}</div></div></AppShell>;
}
