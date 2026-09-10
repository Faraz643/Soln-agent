'use client';
import { useState } from 'react';

export function DiscoveryForm() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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
    try {
      setMsg('Researching Reddit, GitHub and the public web…');
      const discovery = await post('/api/discover', { query, sources: ['reddit', 'github', 'web'] });
      if (!discovery.run_id) throw new Error('Discovery completed without a research run id');

      setMsg(`Found ${discovery.signals_collected} signals. AI is checking which ones contain real customer problems…`);
      const analysis = await post('/api/analyze', { run_id: discovery.run_id, limit: 50 });
      const analyzed = Number(analysis.analyzed || 0);
      const problems = (analysis.results || []).filter((x: any) => x.status !== 'rejected' && x.status !== 'error').length;

      setMsg(`Analyzed ${analyzed} signals. Grouping recurring problems and measuring demand…`);
      const clustered = await post('/api/cluster', { run_id: discovery.run_id, limit: 500 });
      setMsg(`Research complete: ${analyzed} signals analyzed, ${clustered.problems || problems} recurring problems found, ${clustered.opportunities || 0} product opportunities identified.`);
      window.location.reload();
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
  </div>;
}
