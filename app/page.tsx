import Link from 'next/link';

const stats = [
  ['Data sources', '0', 'Connect in Phase 2'],
  ['Problems found', '0', 'AI pipeline not connected yet'],
  ['Opportunities', '0', 'No analysis data yet'],
  ['Pipeline', 'Ready', 'Foundation complete'],
];

export default function Home() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Soln Agent</div>
        <nav className="nav">
          <Link className="active" href="/">Overview</Link>
          <Link href="/opportunities">Opportunities</Link>
          <Link href="/problems">Problems</Link>
          <Link href="/trends">Trends</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </aside>

      <main className="main">
        <header className="header">
          <strong>Product Demand Intelligence</strong>
          <span className="badge">Phase 1 · Foundation</span>
        </header>

        <section className="content">
          <div className="eyebrow">Soln Agent</div>
          <h1>Find problems worth building for.</h1>
          <p className="lead">
            The workspace for turning public demand signals into evidence-backed product opportunities.
            Phase 1 establishes the application, database integration points, authentication structure, and automation boundary.
          </p>

          <div className="grid">
            {stats.map(([label, value, note]) => (
              <div className="card" key={label}>
                <div className="muted">{label}</div>
                <div className="metric">{value}</div>
                <div className="muted">{note}</div>
              </div>
            ))}
          </div>

          <div className="section">
            <div className="card status">
              <div>
                <h2>System status</h2>
                <div className="muted"><span className="status-dot" />Application foundation is ready for source ingestion.</div>
              </div>
              <span className="badge">Next: Data Collection</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
