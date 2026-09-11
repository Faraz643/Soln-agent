import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { buildOpenResearchPlan } from '@/lib/open-discovery';
import {
  DiscoverySource, Signal, collectReddit, collectX, collectWeb, collectGitHub,
  collectHackerNews, collectStackOverflow, collectSite, collectGoogleTrends,
} from '@/lib/source-connectors';

export const maxDuration = 50;

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const clean = (s: string) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 12000);
const topicKey = (q: string) => createHash('sha1').update(q.trim().toLowerCase()).digest('hex').slice(0, 16);

const SOURCES: Array<{ key: DiscoverySource; name: string; type: string }> = [
  { key: 'reddit', name: 'Reddit', type: 'reddit' },
  { key: 'x', name: 'X', type: 'social' },
  { key: 'web', name: 'Web Search', type: 'web' },
  { key: 'github', name: 'GitHub', type: 'github' },
  { key: 'hacker_news', name: 'Hacker News', type: 'web' },
  { key: 'indie_hackers', name: 'Indie Hackers', type: 'web' },
  { key: 'product_hunt', name: 'Product Hunt', type: 'web' },
  { key: 'stackoverflow', name: 'Stack Overflow', type: 'web' },
  { key: 'quora', name: 'Quora', type: 'web' },
  { key: 'trustpilot', name: 'Trustpilot', type: 'web' },
  { key: 'google_maps', name: 'Google Maps Reviews', type: 'web' },
  { key: 'github_discussions', name: 'GitHub Discussions', type: 'web' },
  { key: 'yc_discussions', name: 'Y Combinator Discussions', type: 'web' },
  { key: 'google_trends', name: 'Google Trends', type: 'web' },
];

function auth(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return Promise.resolve(true);
  return (async () => { try { const cs = await cookies(); const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cs.getAll(), setAll: () => {} } }); return !!(await s.auth.getUser()).data.user; } catch { return false; } })();
}

function searchQuery(topic: string, source: DiscoverySource) {
  const q = topic.replace(/["']/g, '').trim();
  const pain = '("looking for" OR "wish there was" OR "is there a tool" OR frustrating OR frustration OR complaint OR workaround OR manual OR "doesn\'t work" OR "too expensive")';
  switch (source) {
    case 'github': return `"${q}" ${pain}`;
    case 'github_discussions': return `site:github.com "${q}" (discussion OR discussions) ${pain}`;
    case 'reddit': return `${q} ${pain}`;
    case 'x': return `${q} ${pain} -is:retweet lang:en`;
    case 'hacker_news': return q;
    case 'stackoverflow': return q;
    case 'indie_hackers': return `${q} ${pain}`;
    case 'product_hunt': return `${q} ${pain}`;
    case 'quora': return `${q} ${pain}`;
    case 'trustpilot': return `${q} reviews complaints alternative`;
    case 'google_maps': return `${q} reviews complaints customers`;
    case 'yc_discussions': return `${q} startup founder problem discussion`;
    case 'google_trends': return q;
    default: return `${q} ${pain}`;
  }
}

async function collect(source: DiscoverySource, q: string, topic: string): Promise<Signal[]> {
  switch (source) {
    case 'reddit': return collectReddit(q, topic);
    case 'x': return collectX(q, topic);
    case 'web': return collectWeb(q, topic);
    case 'github': return collectGitHub(q, topic, false);
    case 'github_discussions': return collectGitHub(q, topic, true);
    case 'hacker_news': return collectHackerNews(q, topic);
    case 'stackoverflow': return collectStackOverflow(q, topic);
    case 'google_trends': return collectGoogleTrends(q, topic);
    case 'indie_hackers':
    case 'product_hunt':
    case 'quora':
    case 'trustpilot':
    case 'google_maps':
    case 'yc_discussions': return collectSite(source, q, topic);
    default: return [];
  }
}

export async function POST(request: NextRequest) {
  if (!(await auth(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  let query = String(body?.query || '').trim();
  if (!query) { try { query = (await buildOpenResearchPlan())[0] || ''; } catch { query = ''; } }
  if (query.length < 3) return NextResponse.json({ error: 'No research lens could be generated' }, { status: 400 });

  const requested = Array.isArray(body?.sources) && body.sources.length ? body.sources.map(String) : SOURCES.map(s => s.key);
  const selected = SOURCES.filter(s => requested.includes(s.key));
  if (!selected.length) return NextResponse.json({ error: 'No valid discovery sources selected' }, { status: 400 });

  const c = db();
  const { data: run, error: runError } = await c.from('discovery_runs').insert({ query, status: 'running', sources: selected.map(s => s.key) }).select('id').single();
  if (runError || !run) return NextResponse.json({ error: runError?.message || 'Could not create discovery run' }, { status: 500 });

  const tkey = topicKey(query);
  const results: Record<string, { collected: number; error?: string }> = {};
  try {
    const batches = await Promise.all(selected.map(async s => {
      try { const docs = await collect(s.key, searchQuery(query, s.key), query); results[s.key] = { collected: docs.length }; return [s, docs] as const; }
      catch (e: any) { results[s.key] = { collected: 0, error: e?.message || 'source failed' }; return [s, []] as const; }
    }));

    const all = batches.flatMap(([, docs]) => docs);
    const seen = new Set<string>();
    const documents = all.filter(d => { const k = `${d.source}:${d.external_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    let linked = 0;

    for (const [sourceConfig, docs] of batches) {
      if (!docs.length) continue;
      const src = await c.from('sources').upsert({ name: sourceConfig.name, type: sourceConfig.type, enabled: true, last_collected_at: new Date().toISOString(), last_error: null }, { onConflict: 'name' }).select('id').single();
      if (src.error || !src.data) throw src.error || new Error(`Could not register ${sourceConfig.name}`);
      const rows = docs.map(d => ({ source_id: src.data.id, external_id: `${d.external_id}:topic:${tkey}`, url: d.url || null, title: clean(d.title), content: clean(d.content), published_at: d.published_at || null, metadata: { ...(d.metadata || {}), research_topic: query, topic_key: tkey, source_key: sourceConfig.key, original_external_id: d.external_id, collected_at: new Date().toISOString() } }));
      const ins = await c.from('raw_documents').upsert(rows, { onConflict: 'source_id,external_id' }).select('id');
      if (ins.error) throw ins.error;
      const ids = (ins.data || []).map((x: any) => x.id);
      if (ids.length) {
        const links = await c.from('discovery_run_documents').upsert(ids.map((raw_document_id: string) => ({ discovery_run_id: run.id, raw_document_id })), { onConflict: 'discovery_run_id,raw_document_id', ignoreDuplicates: true });
        if (links.error) throw links.error;
        linked += ids.length;
      }
    }

    await c.from('discovery_runs').update({ status: 'completed', signals_collected: documents.length, metadata: { linked_documents: linked, topic_key: tkey, source_results: results, selected_sources: selected.map(s => s.key) }, completed_at: new Date().toISOString() }).eq('id', run.id);
    return NextResponse.json({ ok: true, run_id: run.id, query, sources: selected.map(s => s.key), signals_collected: documents.length, linked, source_results: results, autonomous: !body?.query });
  } catch (e: any) {
    await c.from('discovery_runs').update({ status: 'error', error: e?.message || 'Discovery failed', metadata: { source_results: results }, completed_at: new Date().toISOString() }).eq('id', run.id);
    return NextResponse.json({ error: e?.message || 'Discovery failed', run_id: run.id, source_results: results }, { status: 500 });
  }
}
