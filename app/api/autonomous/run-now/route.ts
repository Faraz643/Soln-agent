import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function authorized() {
  try {
    const cs = await cookies();
    const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } });
    return !!(await client.auth.getUser()).data.user;
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!(await authorized())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const secret = process.env.INGEST_SECRET;
  if (!secret) return NextResponse.json({ error: 'INGEST_SECRET is not configured' }, { status: 500 });
  const origin = new URL(request.url).origin;
  const r = await fetch(`${origin}/api/autonomous/cycle`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return NextResponse.json(j, { status: r.status });
}
