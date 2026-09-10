'use client';

import { useEffect, useMemo, useState } from 'react';

type Run = { id: string; status: string; topic: string | null; signals_collected: number; signals_analyzed: number; problems_found: number; opportunities_found: number; started_at: string; completed_at?: string | null; error?: string | null };
type Topic = { id: string; topic: string; priority: number; times_researched: number; last_researched_at?: string | null };
type Opportunity = { id: string; name: string; description?: string | null; score: number; problem_id?: string; problem?: { title?: string; target_customer?: string; demand_score?: number; pain_score?: number; payment_score?: number } | null; competitor_count?: number; validation_count?: number };
type Props = { initialRuns: Run[]; initialTopics: Topic[] };

const SOURCES = ['Reddit', 'X', 'Web', 'GitHub'];
const CYCLES = 3;

export function AutonomousDashboard({ initialRuns, initialTopics }: Props) {
  const [runs, setRuns] = useState(initialRuns); const [topics, setTopics] = useState(initialTopics); const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [sourceState, setSourceState] = useState<Record<string, boolean>>({ Reddit: true, X: false, Web: true, GitHub: true });
  const [busy, setBusy] = useState(false); const [stage, setStage] = useState('Ready to discover'); const [completed, setCompleted] = useState(0); const [error, setError] = useState('');

  async function refresh() {
    const r = await fetch('/api/autonomous/status', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json();
    setRuns(j.runs || []); setTopics(j.topics || []); setOpportunities(j.opportunities || []);
    if (j.sources) setSourceState({ Reddit: !!j.sources.reddit, X: !!j.sources.x, Web: !!j.sources.web, GitHub: !!j.sources.github });
  }
  useEffect(() => { refresh(); }, []);
  const totals = useMemo(() => runs.reduce((a, r) => ({ signals: a.signals + Number(r.signals_analyzed || 0), problems: a.problems + Number(r.problems_found || 0), opportunities: a.opportunities + Number(r.opportunities_found || 0) }), { signals: 0, problems: 0, opportunities: 0 }), [runs]);

  async function discover() {
    if (busy) return; setBusy(true); setError(''); setCompleted(0);
    try {
      for (let i = 0; i < CYCLES; i += 1) {
        setStage(i === 0 ? 'Finding fresh markets and customer problems…' : `Exploring research direction ${i + 1} of ${CYCLES}…`);
        const r = await fetch('/api/autonomous/run-now-v3', { method: 'POST' }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Discovery cycle ${i + 1} failed`);
        setCompleted(i + 1); await refresh(); setStage(i < CYCLES - 1 ? 'Collecting evidence from Reddit, X, Web and GitHub…' : 'Ranking opportunities and preparing validation plans…');
      }
      await refresh(); setStage('Discovery complete — new opportunities are ready.');
    } catch (e: any) { setError(e?.message || 'Discovery failed'); setStage('Discovery stopped safely'); }
    finally { setBusy(false); }
  }

  return <section className="agent-panel">
    <div className="agent-hero"><div><div className="eyebrow">Autonomous opportunity engine</div><h2>Find product opportunities without choosing the topic.</h2><p>One click makes Soln-Agent choose fresh research directions, search public conversations, detect real problems, measure demand, check competition and turn the strongest signals into product opportunities.</p></div><button className="discover-button" onClick={discover} disabled={busy}><span className="button-dot" />{busy ? 'Discovering…' : 'Discover opportunities'}</button></div>
    <div className="source-strip"><span className="small">Sources</span>{SOURCES.map(source => <span className={`source-chip ${sourceState[source] ? '' : 'disabled'}`} key={source}><i />{source}{!sourceState[source] && <b>off</b>}</span>)}</div>
    {busy && <div className="run-progress"><div className="progress-head"><strong>{stage}</strong><span>{completed}/{CYCLES} research passes</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.max(8, (completed / CYCLES) * 100)}%` }} /></div><div className="progress-steps"><span className="active">Discover</span><span>Evidence</span><span>Problems</span><span>Demand</span><span>Competition</span><span>Opportunities</span></div></div>}
    {error && <div className="error-note">{error}</div>}{!busy && stage !== 'Ready to discover' && <div className="success-note">{stage}</div>}
    <div className="agent-metrics"><div><span>Evidence analyzed</span><strong>{totals.signals}</strong></div><div><span>Real problems</span><strong>{totals.problems}</strong></div><div><span>Opportunities</span><strong>{Math.max(opportunities.length, totals.opportunities)}</strong></div><div><span>Research directions</span><strong>{topics.length}</strong></div></div>
    <div className="opportunity-layout"><div className="glass-card opportunity-card"><div className="section-head"><div><div className="eyebrow">Output</div><h3>Product opportunities</h3></div><a className="link" href="/opportunities">View all →</a></div>{opportunities.length ? opportunities.slice(0, 6).map(o => <a className="opportunity-row" href={`/opportunities/${o.id}`} key={o.id}><div className="opp-rank">{Math.round(Number(o.score || 0))}</div><div className="opp-copy"><strong>{o.name}</strong><span>{o.problem?.target_customer || 'Customer segment being validated'}</span><small>{o.problem?.demand_score != null ? `Demand ${Math.round(o.problem.demand_score)}` : 'Demand analysis'} · {o.competitor_count ?? 0} competitors · {o.validation_count ?? 0} validation plan</small></div><span className="arrow">↗</span></a>) : <div className="empty-state"><div className="empty-orb">✦</div><strong>No opportunities yet</strong><span>Click Discover opportunities. The agent will decide what markets deserve investigation.</span></div>}</div>
      <div className="glass-card activity-card"><div className="section-head"><div><div className="eyebrow">Agent memory</div><h3>Research directions</h3></div></div>{topics.slice(0, 8).map(t => <div className="direction-row" key={t.id}><div><strong>{t.topic}</strong><span>Priority {t.priority} · researched {t.times_researched}×</span></div><em>{t.last_researched_at ? new Date(t.last_researched_at).toLocaleDateString() : 'Ready'}</em></div>)}{!topics.length && <div className="empty-state compact"><strong>Waiting for the first discovery pass.</strong></div>}</div></div>
    <div className="glass-card recent-card"><div className="section-head"><div><div className="eyebrow">Trace</div><h3>What the agent did</h3></div><span className="small">Latest first</span></div>{runs.slice(0, 5).map(r => <div className="run-row" key={r.id}><span className={`run-status ${r.status}`}>{r.status}</span><div><strong>{r.topic || 'Autonomous discovery'}</strong><span>{r.signals_analyzed || 0} analyzed · {r.problems_found || 0} problems · {r.opportunities_found || 0} opportunities</span></div><time>{new Date(r.started_at).toLocaleString()}</time></div>)}{!runs.length && <div className="empty-state compact"><strong>No discovery runs yet.</strong></div>}</div>
  </section>;
}
