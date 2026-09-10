import Link from 'next/link';
import { AppShell, Score } from '@/components/app-shell';
import { AutonomousDashboard } from '@/components/autonomous-dashboard-v4';
import { getOverview } from '@/lib/intelligence-data';
import { getAutonomousOverview } from '@/lib/autonomous-data';

export default async function Home() {
  const [{ analyses, documents, sources, opportunities, problems, highDemand, avgDemand }, autonomous] = await Promise.all([getOverview(), getAutonomousOverview()]);
  const top = analyses.filter(a => a.is_problem).slice(0, 5);
  const activeSources = sources.filter((s: any) => s.enabled).length;
  return <AppShell active="Overview"><div className="content">
    <div className="eyebrow">Product Demand Intelligence</div><h1>Discover what people need before you decide what to build.</h1>
    <p className="lead">Soln-Agent autonomously chooses research areas, searches public conversations, detects recurring problems, measures demand, researches competition and ranks product opportunities. Click once to run a complete discovery cycle.</p>
    <AutonomousDashboard initialRuns={autonomous.runs as any} initialTopics={autonomous.topics as any} />
    <div className="grid section"><div className="card"><div className="muted">Signals collected</div><div className="metric">{documents.length}</div><div className="muted">Raw demand evidence</div></div><div className="card"><div className="muted">Problems detected</div><div className="metric">{problems}</div><div className="muted">Concrete problem signals</div></div><div className="card"><div className="muted">High-potential opportunities</div><div className="metric">{opportunities}</div><div className="muted">Opportunity score ≥ 75</div></div><div className="card"><div className="muted">Average demand</div><div className="metric">{avgDemand}<span className="small">/100</span></div><div className="muted">Across analyzed evidence</div></div></div>
    <div className="section two-col"><div className="card"><div className="section-head"><h2>Top opportunities</h2><Link className="link" href="/opportunities">View all →</Link></div>{top.length?top.map(a=><div className="trend" key={a.id}><div><div className="title-cell">{a.problem_summary}</div><div className="small">{a.customer_segments?.join(' · ')||'Customer segment not yet clear'}</div></div><Score value={a.opportunity_score} label="Opportunity"/></div>):<div className="empty">No verified opportunities yet. Click <strong>Run discovery now</strong> above to start autonomous research.</div>}</div><div className="card"><h2>Signal health</h2><div className="stat-grid"><div className="stat"><div className="small">Sources</div><strong>{sources.length}</strong></div><div className="stat"><div className="small">Enabled</div><strong>{activeSources}</strong></div><div className="stat"><div className="small">High demand</div><strong>{highDemand}</strong></div></div></div></div>
  </div></AppShell>;
}
