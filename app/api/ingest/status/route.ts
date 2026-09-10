import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ configured: false, sources: [], documents: 0 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: sources }, { count: documents }] = await Promise.all([
    supabase.from('sources').select('name,type,enabled,last_collected_at,last_error,documents_collected').order('name'),
    supabase.from('raw_documents').select('id', { count: 'exact', head: true }),
  ]);
  return NextResponse.json({ configured: true, sources: sources ?? [], documents: documents ?? 0 });
}
