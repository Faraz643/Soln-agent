'use client';

import { useEffect, useMemo, useState } from 'react';

type Run = { id: string; status: string; topic: string | null; signals_collected: number; signals_analyzed: number; problems_found: number; opportunities_found: number; started_at: string; completed_at?: string | null; error?: string | null; metadata?: any };
type Opportunity = { id: string; name: string; description?: string | null; score: number; problem_id?: string; problem?: { title?: string; target_customer?: string; demand_score?: number; pain_score?: number; payment_score?: number } | null; competitor_count?: number; validation_count?: number; evidence_count?: number; paid_evidence_count?: number; source_count?: number };
type Props = { initialRuns: Run[]; initialTopics: any[] };

const SOURCES = ['Reddit', 'X', 'Web Search', 'GitHub', 'Hacker News', 'Indie Hackers', 'Product Hunt', 'Stack Overflow', 'Quora', 'Trustpilot', 'Google Maps', 'GitHub Discussions', 'YC Discussions', 'Google Trends'];

export function AutonomousDashboard({ initialRuns }: Props) {
  const [runs, setRuns] = useState(initialRuns); const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [busy, setBusy] = useState(false); const [stage, setStage] = useState('Ready'); const [error, setError] = useState(''); const [progress, setProgress] = useState(0);

  async function refresh() {
    try { const r = await fetch('/api/autonomous/status', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json(); setRuns(j.runs || []); setOpportunities(j.opportunities || []); } catch {}
  }
  useEffect(() => { refresh(); }, []);

  const totals = useMemo(() => runs.reduce((a, r) => ({ collected: a.collected + Number(r.signals_collected || 0), analyzed: a.analyzed + Number(r.signals_analyzed || 0), problems: a.problems + Number(r.problems_found || 0), opportunities: a.opportunities + Number(r.opportunities_found || 0) }), { collected: 0, analyzed: 0, problems: 0, opportunities: 0 }), [runs]);

  async function runStep(jobId: string): Promise<boolean> {
    const r = await fetch('/api/autonomous/job-step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_run_id: jobId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Discovery step failed');
    if (j.busy) { await new Promise(resolve => setTimeout(resolve, 700)); return false; }
    const phase = String(j.phase || '');
    if (phase === 'discover') { setStage(`Searching ${j.source || 'the web'} for real-world pain patterns…`); setProgress(Math.min(58, 5 + Math.round(((Number(j.lens_index || 1) - 1) / Math.max(1, Number(j.lenses_total || 12))) * 50))); }
    else if (phase === 'analyze') { setStage('Reading conversations and rejecting noise, spam and weak evidence…'); setProgress(68); }
    else if (phase === 'cluster') { setStage('Finding repeated problems across different conversations and sources…'); setProgress(82); }
    else if (phase === 'competition') { setStage(`Checking whether existing products already solve each problem… ${j.progress && j.total ? `${j.progress}/${j.total}` : ''}`); setProgress(j.total ? Math.min(96, 84 + Math.round((j.progress / j.total) * 12)) : 90); }
    else if (phase === 'finish') { setStage('Final evidence gate: demand, pain, payment signals, recency and competition…'); setProgress(98); }
    else if (phase === 'completed' || j.done) { setProgress(100); return true; }
    await refresh(); return !!j.done;
  }

  async function discover() {
    if (busy) return; setBusy(true); setError(''); setProgress(2); setStage('Thinking of independent ways to find problems…');
    try {
      const start = await fetch('/api/autonomous/job-start', { method: 'POST' }); const j = await start.json().catch(() => ({})); if (!start.ok) throw new Error(j.error || 'Could not start discovery');
      const jobId = String(j.agent_run_id || ''); if (!jobId) throw new Error('Discovery did not return a job id');
      let done = false; let guard = 0;
      while (!done && guard < 500) { done = await runStep(jobId); guard += 1; if (!done) await new Promise(resolve => setTimeout(resolve, 250)); }
      if (!done) throw new Error('The saved discovery run is still processing. Click Discover again to resume it.');
      await refresh(); setStage('Discovery complete — only evidence-backed opportunities are shown.'); setProgress(100);
    } catch (e: any) { setError(e?.message || 'Discovery failed'); setStage('Discovery stopped safely'); await refresh(); }
    finally { setBusy(false); }
  }

  return <section className="agent-panel">
    <div className="agent-hero"><div><div className="eyebrow">Autonomous product discovery</div><h2>Find something worth building.</h2><p>One click gives the agent an open research mission. It searches public conversations, finds repeated pain patterns, tests whether people care and pay, checks existing solutions, then shows only the strongest product opportunities.</p></div><button className="discover-button" onClick={discover} disabled={busy}><span className="button-dot" />{busy ? 'Discovering…' : 'Discover opportunities'}</button></div>
    <div className="source-strip"><span className="small">Scanning</span>{SOURCES.map(source => <span className="source-chip" key={source}><i />{source}</span>)}</div>
    {busy && <div className="run-progress"><div className="progress-head"><strong>{stage}</strong><span>{progress}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.max(4, progress)}%` }} /></div><div className="progress-steps"><span className="active">Discover</span><span>Understand</span><span>Cluster</span><span>Validate</span><span>Rank</span></div></div>}
    {error && <div className="error-note">{error}</div>}{!busy && stage !== 'Ready' && !error && <div className="success-note">{stage}</div>}
    <div className="agent-metrics"><div><span>Signals found</span><strong>{totals.collected}</strong><small>public evidence</small></div><div><span>Evidence analyzed</span><strong>{totals.analyzed}</strong><small>AI-reviewed</small></div><div><span>Real problems</span><strong>{totals.problems}</strong><small>passed problem gate</small></div><div><span>Opportunities</span><strong>{opportunities.length}</strong><small>passed all gates</small></div></div>
    <div className="glass-card opportunity-card"><div className="section-head"><div><div className="eyebrow">Output</div><h3>What could be worth building</h3></div><a className="link" href="/opportunities">View all →</a></div>{opportunities.length ? opportunities.slice(0, 8).map(o => <a className="opportunity-row" href={`/opportunities/${o.id}`} key={o.id}><div className="opp-rank">{Math.round(Number(o.score || 0))}</div><div className="opp-copy"><strong>{o.name}</strong><span>{o.problem?.target_customer || 'Customer segment being validated'}</span><small>{o.evidence_count || 0} signals · {o.source_count || 0} sources · {o.paid_evidence_count || 0} payment signals · {o.competitor_count || 0} competitors</small></div><span className="arrow">↗</span></a>) : <div className="empty-state"><div className="empty-orb">✦</div><strong>No qualified opportunity yet</strong><span>That is intentional. A result appears only when evidence is strong enough to support a real problem and a plausible product opportunity.</span></div>}</div>
    <div className="glass-card recent-card"><div className="section-head"><div><div className="eyebrow">Trace</div><h3>Discovery history</h3></div><span className="small">Latest first</span></div>{runs.slice(0, 8).map(r => <div className="run-row" key={r.id}><span className={`run-status ${r.status}`}>{r.status}</span><div><strong>{r.topic === 'Open-mind discovery' ? 'Open-mind discovery mission' : r.topic || 'Discovery mission'}</strong><span>{r.signals_collected || 0} found · {r.signals_analyzed || 0} analyzed · {r.opportunities_found || 0} opportunities</span></div><time>{new Date(r.started_at).toLocaleString()}</time></div>)}{!runs.length && <div className="empty-state compact"><strong>Your first discovery run will appear here.</strong></div>}</div>
  </section>;
}
