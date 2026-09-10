import Link from 'next/link';

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  const links = [['Overview','/'],['Opportunities','/opportunities'],['Problems','/problems'],['Trends','/trends'],['Sources','/sources'],['Settings','/settings']];
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/" className="brand">Soln<span>·</span>Agent</Link>
      <div className="brand-sub">Product Demand Intelligence</div>
      <nav className="nav">{links.map(([label, href]) => <Link key={href} className={active === label ? 'active' : ''} href={href}>{label}</Link>)}</nav>
      <div className="sidebar-foot"><span className="status-dot"/> Intelligence engine online</div>
    </aside>
    <main className="main"><header className="header"><strong>{active}</strong><span className="badge">Demand Intelligence</span></header>{children}</main>
  </div>;
}

export function Score({ value, label }: { value: number | null | undefined; label?: string }) {
  const n = Math.round(Number(value || 0));
  return <div className="score"><div className="score-top"><span>{label}</span><strong>{n}</strong></div><div className="bar"><i style={{ width: `${n}%` }}/></div></div>;
}
