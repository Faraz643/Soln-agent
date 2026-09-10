export default function SourcesPage() {
  const sources = [
    ['Reddit', 'Community discussions', 'Not connected'],
    ['GitHub', 'Issues and discussions', 'Not connected'],
    ['Web Search', 'Public web signals', 'Not connected'],
  ];

  return <div className="content"><div className="eyebrow">Configuration</div><h1>Sources</h1><p className="lead">Phase 1 defines the source registry. Connections and ingestion arrive in Phase 2.</p><div className="grid">{sources.map(([name, desc, status]) => <div className="card" key={name}><h2>{name}</h2><div className="muted">{desc}</div><div style={{marginTop:16}} className="badge">{status}</div></div>)}</div></div>;
}
