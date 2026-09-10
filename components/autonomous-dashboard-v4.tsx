'use client';

import { useEffect, useMemo, useState } from 'react';

type Run = { id: string; status: string; topic: string | null; signals_collected: number; signals_analyzed: number; problems_found: number; opportunities_found: number; started_at: string; completed_at?: string | null; error?: string | null };
type Topic = { id: string; topic: string; priority: number; times_researched: number; last_researched_at?: string | null };
type Opportunity = { id: string; name: string; description?: string | null; score: number; problem_id?: string; problem?: { title?: string; target_customer?: string; demand_score?: number; pain_score?: number; payment_score?: number } | null; competitor_count?: number; validation_count?: number };
type Props = { initialRuns: Run[]; initialTopics: Topic[] };

const SOURCES = ['Reddit', 'X', 'Web', 'GitHub'];

export function AutonomousDashboard({ initialRuns, initialTopics }: Props) {
  const [runs, setRuns] = useState(initialRuns); const [topics, setTopics] = useState(initialTopics); const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [sourceState, setSourceState] = useState<Record<string, boolean>>({ Reddit: true, X: false, Web: true, GitHub: true });
  const [busy, setBusy] = useState(false); const [stage, setStage] = useState('Ready to discover'); const [error, setError] = useState(''); const [progress, setProgress] = useState(0); const [activeJob, setActiveJob] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch('/api/autonomous/status', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json();
      setRuns(j.runs || []); setTopics(j.topics || []); setOpportunities(j.opportunities || []);
      if (j.sources) setSourceState({ Reddit: !!j.sources.reddit, X: !!j.sources.x, Web: !!j.sources.web, GitHub: !!j.sources.github });
    } catch {}
  }
  useEffect(() => { refresh(); }, []);
  const totals = useMemo(() => runs.reduce((a, r) => ({ signals: a.signals + Number(r.signals_analyzed || 0), problems: a.problems + Number(r.problems_found || 0), opportunities: a.opportunities + Number(r.opportunities_found || 0) }), { signals: 0, problems: 0, opportunities: 0 }), [runs]);

  async function runStep(jobId: string): Promise<boolean> {
    const r = await fetch('/api/autonomous/job-step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_run_id: jobId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Discovery step failed');
    if (j.busy) { await new Promise(resolve => setTimeout(resolve, 900)); return false; }
    const phase = String(j.phase || '');
    if (phase === 'discover') { setStage(j.source ? `Searching ${j.source} for real customer problems…` : 'Collecting evidence…'); setProgress(p => Math.min(42, p + 7)); }
    else if (phase === 'analyze') { setStage('Reading evidence and rejecting irrelevant noise…'); setProgress(p => Math.min(72, p + 3)); }
    else if (phase === 'cluster') { setStage('Grouping recurring problems and applying the opportunity quality gate…'); setProgress(82); }
    else if (phase === 'competition') { setStage(`Checking existing solutions and competitors… ${j.progress && j.total ? `${j.progress}/${j.total}` : ''}`); setProgress(j.total ? Math.min(96, 84 + Math.round((j.progress / j.total) * 12)) : 90); }
    else if (phase === 'finish') { setStage('Finalizing only the opportunities that passed the evidence gates…'); setProgress(98); }
    else if (phase === 'completed' || j.done) { setProgress(100); return true; }
    await refresh();
    return !!j.done;
  }

  async function discover() {
    if (busy) return; setBusy(true); setError(''); setProgress(3); setStage('Choosing a fresh customer/workflow research direction…');
    try {
      const start = await fetch('/api/autonomous/job-start', { method: 'POST' }); const j = await start.json().catch(() => ({}));
      if (!start.ok) throw new Error(j.error || 'Could not start discovery');
      const jobId = String(j.agent_run_id || ''); if (!jobId) throw new Error('Discovery did not return a job id');
      setActiveJob(jobId);
      let done = false; let guard = 0;
      while (!done && guard < 300) { done = await runStep(jobId); guard += 1; if (!done) await new Promise(resolve => setTimeout(resolve, 350)); }
      if (!done) throw new Error('Discovery took too long and was stopped safely. Refresh to resume the saved run.');
      await refresh(); setStage('Discovery complete — only qualified opportunities are shown.'); setProgress(100);
    } catch (e: any) { setError(e?.message || 'Discovery failed'); setStage('Discovery stopped safely'); await refresh(); }
    finally { setBusy(false); setActiveJob(null); }
  }

  return <section className="agent-panel">
    <div className="agent-hero"><div><div className="eyebrow">Autonomous opportunity engine</div><h2>Find product opportunities without choosing the topic.</h2><p>One click makes Soln-Agent choose a specific customer/workflow direction, search public conversations, reject irrelevant noise, verify recurring pain and rank only evidence-backed product opportunities.</p></div><button className="discover-button" onClick={discover} disabled={busy}><span className="button-dot" />{busy ? 'Discovering…' : 'Discover opportunities'}</button></div>
    <div className="source-strip"><span className="small">Sources</span>{SOURCES.map(source => <span className={`source-chip ${sourceState[source] ? '' : 'disabled'}`} key={source}><i />{source}{!sourceState[source] && <b>off</b>}</span>)}</div>
    {busy && <div className="run-progress"><div className="progress-head"><strong>{stage}</strong><span>{progress}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.max(4, progress)}%` }} /></div><div className="progress-steps"><span className="active">Discover</span><span>Evidence</span><span>Problems</span><span>Demand</span><span>Competition</span><span>Opportunities</span></div></div>}
    {error && <div className="error-note">{error}{activeJob && ' You can click Discover again to resume the saved run.'}</div>}{!busy && stage !== 'Ready to discover' && !error && <div className="success-note">{stage}</div>}
    <div className="agent-metrics"><div><span>Evidence analyzed</span><strong>{totals.signals}</strong></div><div><span>Real problems</span><strong>{totals.problems}</strong></div><div><span>Qualified opportunities</span><strong>{opportunities.length}</strong></div><div><span>Research directions</span><strong>{topics.length}</strong></div></div>
    <div className="opportunity-layout"><div className="glass-card opportunity-card"><div className="section-head"><div><div className="eyebrow">Output</div><h3>Product opportunities</h3></div><a className="link" href="/opportunities">View all →</a></div>{opportunities.length ? opportunities.slice(0, 6).map(o => <a className="opportunity-row" href={`/opportunities/${o.id}`} key={o.id}><div className="opp-rank">{Math.round(Number(o.score || 0))}</div><div className="opp-copy"><strong>{o.name}</strong><span>{o.problem?.target_customer || 'Customer segment being validated'}</span><small>{o.problem?.demand_score != null ? `Demand ${Math.round(o.problem.demand_score)}` : 'Demand analysis'} · {o.competitor_count ?? 0} competitors · {o.validation_count ?? 0} validation plans</small></div><span className="arrow">↗</span></a>) : <div className="empty-state"><div className="empty-orb">✦</div><strong>No qualified opportunities yet</strong><span>This is intentional. The agent will show an opportunity only after it passes the evidence, recurrence, demand and quality gates.</span></div>}</div>
      <div className="glass-card activity-card"><div className="section-head"><div><div className="eyebrow">Agent memory</div><h3>Research directions</h3></div></div>{topics.slice(0, 8).map(t => <div className="direction-row" key={t.id}><div><strong>{t.topic}</strong><span>Priority {t.priority} · researched {t.times_researched}×</span></div><em>{t.last_researched_at ? new Date(t.last_researched_at).toLocaleDateString() : 'Ready'}</em></div>)}{!topics.length && <div className="empty-state compact"><strong>Waiting for the first discovery pass.</strong></div>}</div></div>
    <div className="glass-card recent-card"><div className="section-head"><div><div className="eyebrow">Trace</div><h3>What the agent did</h3></div><span className="small">Latest first</span></div>{runs.slice(0, 5).map(r => <div className="run-row" key={r.id}><span className={`run-status ${r.status}`}>{r.status}</span><div><strong>{r.topic || 'Autonomous discovery'}</strong><span>{r.signals_analyzed || 0} analyzed · {r.problems_found || 0} problems · {r.opportunities_found || 0} qualified opportunities</span></div><time>{new Date(r.started_at).toLocaleString()}</time></div>)}{!runs.length && <div className="empty-state compact"><strong>No discovery runs yet.</strong></div>}</div>
  </section>;
}
