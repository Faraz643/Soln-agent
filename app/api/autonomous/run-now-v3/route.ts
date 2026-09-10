import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function auth() {
  try {
    const cs = await cookies();
    const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } });
    return !!(await c.auth.getUser()).data.user;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const secret = process.env.INGEST_SECRET;
  if (!secret) return NextResponse.json({ error: 'INGEST_SECRET is not configured' }, { status: 500 });
  const r = await fetch(`${new URL(req.url).origin}/api/autonomous/job-start`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return NextResponse.json(j, { status: r.status });
}
