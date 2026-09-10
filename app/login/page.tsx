'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      setError('Supabase is not configured for this deployment.');
      setBusy(false);
      return;
    }
    const supabase = createBrowserClient(url, anonKey);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    else window.location.href = '/';
    setBusy(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="eyebrow">Soln-Agent</div>
        <h1>Sign in</h1>
        <p className="lead">Access your Product Demand Intelligence workspace.</p>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: 12, border: '1px solid #ddd', borderRadius: 9 }} />
          <input required type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: 12, border: '1px solid #ddd', borderRadius: 9 }} />
          <button disabled={busy} style={{ padding: 12, border: 0, borderRadius: 9, background: '#17191d', color: '#fff', fontWeight: 700 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </main>
  );
}
