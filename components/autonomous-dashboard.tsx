'use client';
import { useEffect, useState } from 'react';

type Run = { id: string; status: string; topic: string | null; signals_collected: number; signals_analyzed: number; problems_found: number; opportunities_found: number; started_at: string; completed_at?: string | null; error?: string | null };

type Topic = { id: string; topic: string; priority: number; last_researched_at?: string | null; times_researched: number };

export function AutonomousDashboard({ initialRuns, initialTopics }: { initialRuns: Run[]; initialTopics: Topic[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [topics, setTopics] = useState(initialTopics);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const r = await fetch('/api/autonomous/status', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json(); setRuns(j.runs || []); setTopics(j.topics || []);
  }
  useEffect(() => { const id = setInterval(refresh, 30000); return () => clearInterval(id); }, []);

  async function runNow() {
    setBusy(true); setMessage('Agent is discovering a new market…');
    try {
      const r = await fetch('/api/autonomous/cycle', { method: 'POST', headers: { Authorization: 'Bearer ' + (window.localStorage.getItem('soln_agent_secret') || '') } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Autonomous cycle failed');
      setMessage(`Completed: ${j.topic}. Found ${j.analysis?.opportunities || 0} opportunities.`); await refresh();
    } catch (e: any) { setMessage(e?.message || 'Autonomous cycle failed. Use the scheduled n8n workflow for server-side execution.'); }
    finally { setBusy(false); }
  }

  const latest = runs[0];
  return <div className="section">
    <div className="card">
      <div className="section-head"><div><div className="eyebrow">Autonomous discovery</div><h2 style={{ margin: 0 }}>Soln-Agent is looking for problems worth building for.</h2></div><button onClick={runNow} disabled={busy}>{busy ? 'Discovering…' : 'Run discovery now'}</button></div>
      <p className="muted">The agent continuously explores Reddit, X, the web and GitHub, finds recurring customer pain, tracks trends and ranks product opportunities. Topic research remains available as an optional deep-dive.</p>
      {message && <div className="note">{message}</div>}
      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat"><div className="small">Agent status</div><strong>{latest?.status === 'running' ? 'Running' : 'Ready'}</strong></div>
        <div className="stat"><div className="small">Signals analyzed</div><strong>{runs.reduce((n, r) => n + Number(r.signals_analyzed || 0), 0)}</strong></div>
        <div className="stat"><div className="small">Problems found</div><strong>{runs.reduce((n, r) => n + Number(r.problems_found || 0), 0)}</strong></div>
        <div className="stat"><div className="small">Opportunities</div><strong>{runs.reduce((n, r) => n + Number(r.opportunities_found || 0), 0)}</strong></div>
      </div>
    </div>
    <div className="two-col" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-head"><h3>Latest agent runs</h3><span className="small">Automatic research history</span></div>{runs.slice(0, 6).map(r => <div className="trend" key={r.id}><div><div className="title-cell">{r.topic || 'Discovery cycle'}</div><div className="small">{r.status} · {r.signals_analyzed} analyzed · {r.problems_found} problems · {r.opportunities_found} opportunities</div></div><div className="small">{new Date(r.started_at).toLocaleString()}</div></div>)}</div>
      <div className="card"><div className="section-head"><h3>Discovery universe</h3><span className="small">Topics the agent rotates through</span></div>{topics.slice(0, 8).map(t => <div className="trend" key={t.id}><div><div className="title-cell">{t.topic}</div><div className="small">Priority {t.priority} · researched {t.times_researched}×</div></div><div className="small">{t.last_researched_at ? new Date(t.last_researched_at).toLocaleDateString() : 'Queued'}</div></div>)}</div>
    </div>
  </div>;
}
