'use client';

import { useEffect, useState } from 'react';

type Source = { name: string; type: string; enabled: boolean; last_collected_at: string | null; last_error: string | null; documents_collected: number };

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [documents, setDocuments] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ingest/status').then(r => r.json()).then(data => { setSources(data.sources ?? []); setDocuments(data.documents ?? 0); }).finally(() => setLoading(false));
  }, []);

  return <div className="content"><div className="eyebrow">Data Collection</div><h1>Sources</h1><p className="lead">Live ingestion status for the Phase 2 collectors.</p><div className="grid">{sources.map(s => <div className="card" key={s.name}><h2>{s.name}</h2><div className="muted">{s.type}</div><div style={{marginTop:16}} className="badge">{s.enabled ? 'Connected' : 'Not connected'}</div><div style={{marginTop:12}} className="muted">{s.documents_collected.toLocaleString()} documents</div><div className="muted">{s.last_collected_at ? `Last collected ${new Date(s.last_collected_at).toLocaleString()}` : 'Waiting for first run'}</div>{s.last_error && <div style={{marginTop:10}} className="muted">Error: {s.last_error}</div>}</div>)}{!loading && sources.length === 0 && <div className="card"><h2>No sources yet</h2><div className="muted">Apply the Supabase Phase 2 migration, then run the n8n workflow.</div></div>}</div><div className="section"><div className="card status"><div><h2>Total collected</h2><div className="metric">{documents.toLocaleString()}</div></div><span className="badge">Phase 2</span></div></div></div>;
}
