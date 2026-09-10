'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type AnalysisResult = {
  id?: string;
  status?: string;
  is_problem?: boolean;
  problem_summary?: string | null;
  opportunity_summary?: string | null;
  opportunity_score?: number | null;
  demand_score?: number | null;
  pain_score?: number | null;
  evidence_quality?: number | null;
  customer_segments?: string[];
  rejection_reason?: string | null;
};

export function DiscoveryForm() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [summary, setSummary] = useState<{ analyzed: number; problems: number; opportunities: number } | null>(null);

  async function post(path: string, body: Record<string, unknown>) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${path} failed`);
    return j;
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setResults([]);
    setSummary(null);
    try {
      setMsg('Researching Reddit, GitHub and the public web…');
      const discovery = await post('/api/discover', { query, sources: ['reddit', 'github', 'web'] });
      if (!discovery.run_id) throw new Error('Discovery completed without a research run id');

      setMsg(`Found ${discovery.signals_collected} signals. AI is analyzing them…`);
      const analysis = await post('/api/analyze', { run_id: discovery.run_id, limit: 50 });
      const analyzedResults: AnalysisResult[] = Array.isArray(analysis.results) ? analysis.results : [];
      const valid = analyzedResults.filter(x => x.status !== 'rejected' && x.status !== 'error' && x.is_problem);
      const highValue = valid.filter(x => Number(x.opportunity_score || 0) >= 75);
      setResults(analyzedResults);
      setSummary({ analyzed: Number(analysis.analyzed || analyzedResults.length), problems: valid.length, opportunities: highValue.length });
      setMsg(`AI analysis complete: ${analyzedResults.length} signals analyzed, ${valid.length} potential problems identified.`);

      try {
        setMsg(`Analyzed ${analyzedResults.length} signals. Grouping recurring problems and measuring demand…`);
        const clustered = await post('/api/cluster', { run_id: discovery.run_id, limit: 500 });
        setSummary({ analyzed: Number(analysis.analyzed || analyzedResults.length), problems: Number(clustered.problems || valid.length), opportunities: Number(clustered.opportunities || highValue.length) });
        setMsg(`Research complete: ${analysis.analyzed || analyzedResults.length} signals analyzed, ${clustered.problems || valid.length} recurring problems found, ${clustered.opportunities || highValue.length} product opportunities identified.`);
        router.refresh();
      } catch (clusterError: any) {
        setMsg(`AI analysis completed, but saving problem clusters failed: ${clusterError?.message || 'Unknown error'}`);
      }
    } catch (e: any) {
      setMsg(e?.message || 'Research failed');
    } finally {
      setBusy(false);
    }
  }

  return <div className="card discovery">
    <div className="eyebrow">New research</div>
    <h2>What market should Soln-Agent investigate?</h2>
    <p className="muted">Enter a topic, customer, technology or market. Soln-Agent searches multiple public sources, analyzes the evidence, groups recurring problems and scores product opportunities.</p>
    <form onSubmit={run}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. problems developers have with AI coding agents" disabled={busy} />
      <button disabled={busy || !q.trim()}>{busy ? 'Researching…' : 'Discover problems'}</button>
    </form>
    {msg && <div className="note">{msg}</div>}
    {summary && <div className="stat-grid" style={{ marginTop: 16 }}>
      <div className="stat"><div className="small">Analyzed</div><strong>{summary.analyzed}</strong></div>
      <div className="stat"><div className="small">Problems</div><strong>{summary.problems}</strong></div>
      <div className="stat"><div className="small">Opportunities</div><strong>{summary.opportunities}</strong></div>
    </div>}
    {results.length > 0 && <div style={{ marginTop: 18 }}>
      <div className="section-head"><h3 style={{ margin: 0 }}>Latest AI findings</h3><span className="small">Showing {results.length} analyzed signals</span></div>
      <div style={{ marginTop: 10 }}>
        {results.map((r, i) => {
          const rejected = r.status === 'rejected' || r.status === 'error' || !r.is_problem;
          return <div className="trend" key={r.id || i}>
            <div style={{ minWidth: 0 }}>
              <div className="title-cell">{rejected ? (r.rejection_reason || 'Signal rejected as not a qualifying customer problem.') : (r.problem_summary || r.opportunity_summary || 'Problem signal')}</div>
              {!rejected && <div className="small">{(r.customer_segments || []).join(' · ') || 'Customer segment not yet clear'} · Demand {Math.round(Number(r.demand_score || 0))} · Pain {Math.round(Number(r.pain_score || 0))} · Evidence {Math.round(Number(r.evidence_quality || 0))}</div>}
            </div>
            {!rejected && <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{Math.round(Number(r.opportunity_score || 0))}</strong><div className="small">Opportunity</div></div>}
          </div>;
        })}
      </div>
    </div>}
  </div>;
}
