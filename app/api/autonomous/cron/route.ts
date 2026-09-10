import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const ingestSecret = process.env.INGEST_SECRET;
  const auth = request.headers.get('authorization');
  if (!cronSecret && !ingestSecret) return NextResponse.json({ error: 'No cron authentication secret configured' }, { status: 500 });
  if ((cronSecret && auth !== `Bearer ${cronSecret}`) && (ingestSecret && auth !== `Bearer ${ingestSecret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const origin = new URL(request.url).origin;
  const r = await fetch(`${origin}/api/autonomous/cycle`, { method: 'POST', headers: { Authorization: `Bearer ${ingestSecret}` }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return NextResponse.json(j, { status: r.status });
}
