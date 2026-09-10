import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type IngestDocument = {
  source: 'reddit' | 'github' | 'web' | 'social' | 'reviews' | 'other';
  external_id: string;
  url?: string | null;
  title?: string | null;
  content?: string | null;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
};

const allowedSources = new Set(['reddit', 'github', 'web', 'social', 'reviews', 'other']);

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INGEST_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: 'INGEST_SECRET is not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const documents: IngestDocument[] = Array.isArray(body) ? body : body?.documents;
  if (!Array.isArray(documents) || documents.length === 0 || documents.length > 500) {
    return NextResponse.json({ error: 'documents must contain 1-500 items' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'Supabase server credentials are not configured' }, { status: 503 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sourceNames: Record<string, string> = { reddit: 'Reddit', github: 'GitHub', web: 'Web Search', social: 'Social Media', reviews: 'Reviews', other: 'Other' };
  const grouped = new Map<string, IngestDocument[]>();

  for (const doc of documents) {
    if (!doc || !allowedSources.has(doc.source) || !doc.external_id) {
      return NextResponse.json({ error: 'Every document requires a valid source and external_id' }, { status: 400 });
    }
    const list = grouped.get(doc.source) ?? [];
    list.push(doc);
    grouped.set(doc.source, list);
  }

  let inserted = 0;
  for (const [sourceType, docs] of grouped) {
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .upsert({ name: sourceNames[sourceType], type: sourceType, enabled: true }, { onConflict: 'name' })
      .select('id')
      .single();
    if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });

    const rows = docs.map((doc) => ({
      source_id: source.id,
      external_id: doc.external_id,
      url: doc.url ?? null,
      title: doc.title ?? null,
      content: doc.content ?? null,
      published_at: doc.published_at ?? null,
      metadata: doc.metadata ?? {},
    }));

    const { data, error } = await supabase.from('raw_documents').upsert(rows, { onConflict: 'source_id,external_id', ignoreDuplicates: true }).select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted += data?.length ?? 0;

    const { error: statusError } = await supabase.from('sources').update({
      enabled: true,
      last_collected_at: new Date().toISOString(),
      last_error: null,
      documents_collected: (await supabase.from('raw_documents').select('id', { count: 'exact', head: true }).eq('source_id', source.id)).count ?? 0,
    }).eq('id', source.id);
    if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, received: documents.length, inserted });
}
