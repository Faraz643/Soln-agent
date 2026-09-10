import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function authorized(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  try { const cs = await cookies(); const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } }); return !!(await c.auth.getUser()).data.user; } catch { return false; }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = db();
  const [runs, topics] = await Promise.all([
    c.from('agent_runs').select('id,status,topic,signals_collected,signals_analyzed,problems_found,opportunities_found,started_at,completed_at,error').order('started_at', { ascending: false }).limit(20),
    c.from('discovery_topics').select('id,topic,priority,last_researched_at,times_researched').eq('status', 'active').order('priority', { ascending: false }).limit(20),
  ]);
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, runs: runs.data || [], topics: topics.data || [] });
}
