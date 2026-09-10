export default function SettingsPage() {
  return <div className="content"><div className="eyebrow">Configuration</div><h1>Settings</h1><p className="lead">Environment and service configuration is prepared through `.env.local`. Supabase and n8n credentials are intentionally kept out of source control.</p><div className="card"><h2>Phase 1 integrations</h2><div className="muted" style={{lineHeight:1.8}}>Supabase client: configured in code<br/>Supabase schema: migration included<br/>n8n: environment boundary reserved<br/>Authentication: Supabase-compatible foundation</div></div></div>;
}
