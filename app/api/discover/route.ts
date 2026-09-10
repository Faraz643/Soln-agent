import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Soln-Agent',
  'X-GitHub-Api-Version': '2022-11-28',
};

const db = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 12000);

const STOP_WORDS = new Set(`a an and are as at be been being by can could did do does doing for from had has have having how i if in into is it its me more most my of on or our please problem problems should that the their them they this to was we what when where which who why will with would you your face facing users user people find finding choosing choose looking look need needs needed get getting`.split(' '));

function topicTerms(query: string) {
  const terms: string[] = [];
  for (const word of query.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) || []) {
    const w = word.replace(/-+/g, ' ');
    if (!STOP_WORDS.has(w) && w.length >= 3 && !terms.includes(w)) terms.push(w);
  }
  return terms.slice(0, 8);
}

function buildSearchQueries(query: string, source: 'github' | 'reddit' | 'web') {
  const terms = topicTerms(query);
  const primary = terms.slice(0, 5);
  const queries = new Set<string>();
  if (query.trim()) queries.add(`"${query.trim()}"`);
  if (primary.length >= 2) queries.add(primary.join(' '));
  if (primary.length >= 3) queries.add(primary.slice(0, 3).join(' '));
  if (primary.length >= 2) queries.add(`${primary.slice(0, 2).join(' ')} complaint OR problem OR frustrated OR "looking for"`);

  if (source === 'github') {
    // GitHub is supporting evidence, not the main problem database. Keep it recent
    // and require several topic terms rather than searching the whole natural-language sentence.
    const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const githubQueries = new Set<string>();
    if (primary.length >= 2) githubQueries.add(`${primary.slice(0, 2).map(t => `"${t}"`).join(' ')} is:issue is:open updated:>=${since}`);
    if (primary.length >= 3) githubQueries.add(`${primary.slice(0, 3).map(t => `"${t}"`).join(' ')} is:issue is:open updated:>=${since}`);
    return [...githubQueries].slice(0, 3);
  }

  if (source === 'reddit') {
    const redditQueries = new Set<string>();
    if (primary.length >= 2) redditQueries.add(primary.slice(0, 2).map(t => `"${t}"`).join(' '));
    if (primary.length >= 3) redditQueries.add(primary.slice(0, 3).map(t => `"${t}"`).join(' '));
    if (primary.length >= 2) redditQueries.add(`${primary.slice(0, 2).join(' ')} problem complaint frustrating OR "looking for"`);
    return [...redditQueries].slice(0, 4);
  }

  const webQueries = new Set<string>();
  webQueries.add(`"${query.trim()}" problem complaint OR frustration OR workaround`);
  if (primary.length >= 2) webQueries.add(`${primary.join(' ')} problem complaint workaround review forum`);
  if (primary.length >= 3) webQueries.add(`${primary.slice(0, 3).join(' ')} "looking for" OR "anyone else" OR "how do I"`);
  return [...webQueries].slice(0, 4);
}

async function authorized(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  try {
    const cs = await cookies();
    const s = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cs.getAll(), setAll: () => {} } },
    );
    return !!(await s.auth.getUser()).data.user;
  } catch {
    return false;
  }
}

async function github(query: string, researchQuery: string) {
  const q = encodeURIComponent(query);
  const r = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=20`, { headers, cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map((i: any) => ({
    source: 'github', external_id: String(i.id), url: i.html_url, title: i.title, content: i.body || '',
    published_at: i.created_at,
    metadata: { repository: i.repository_url, labels: (i.labels || []).map((x: any) => x.name), comments: i.comments, reactions: i.reactions?.total_count || 0, query: researchQuery, source_query: query, updated_at: i.updated_at },
  }));
}

async function reddit(query: string, researchQuery: string) {
  const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=year&limit=25&raw_json=1`, { headers: { 'User-Agent': 'Soln-Agent/1.0 demand-research' }, cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.data?.children || []).map((x: any) => {
    const p = x.data;
    return {
      source: 'reddit', external_id: String(p.id), url: `https://www.reddit.com${p.permalink}`, title: p.title || '',
      content: [p.title, p.selftext].filter(Boolean).join('\n\n'),
      published_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
      metadata: { subreddit: p.subreddit, score: p.score, comments: p.num_comments, author: p.author, query: researchQuery, source_query: query },
    };
  });
}

async function web(query: string, researchQuery: string) {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Mozilla/5.0 Soln-Agent' }, cache: 'no-store' });
  if (!r.ok) return [];
  const html = await r.text();
  const out: any[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 15) {
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    out.push({ source: 'web', external_id: m[1], url: m[1], title: strip(m[2]), content: strip(m[3]), published_at: null, metadata: { query: researchQuery, source_query: query, engine: 'duckduckgo' } });
  }
  return out;
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const query = String(body?.query || '').trim();
  if (query.length < 3) return NextResponse.json({ error: 'query is required' }, { status: 400 });
  const sources = Array.isArray(body?.sources) && body.sources.length ? body.sources : ['reddit', 'github', 'web'];
  const c = db();
  const { data: run, error: re } = await c.from('discovery_runs').insert({ query, status: 'running', sources }).select('id').single();
  if (re || !run) return NextResponse.json({ error: re?.message || 'Could not create research run' }, { status: 500 });

  try {
    const jobs: Promise<any[]>[] = [];
    if (sources.includes('github')) {
      for (const q of buildSearchQueries(query, 'github')) jobs.push(github(q, query));
    }
    if (sources.includes('reddit')) {
      for (const q of buildSearchQueries(query, 'reddit')) jobs.push(reddit(q, query));
    }
    if (sources.includes('web')) {
      for (const q of buildSearchQueries(query, 'web')) jobs.push(web(q, query));
    }
    const batches = await Promise.all(jobs);
    const seen = new Set<string>();
    const documents = batches.flat().filter((d: any) => {
      const key = `${d.source}:${d.external_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let linked = 0;

    for (const type of ['github', 'reddit', 'web']) {
      const docs = documents.filter((d: any) => d.source === type);
      if (!docs.length) continue;
      const name = type === 'github' ? 'GitHub' : type === 'reddit' ? 'Reddit' : 'Web Search';
      const src = await c.from('sources').upsert(
        { name, type, enabled: true, last_collected_at: new Date().toISOString(), last_error: null },
        { onConflict: 'name' },
      ).select('id').single();
      if (src.error || !src.data) throw src.error || new Error(`Could not create ${name} source`);

      const rows = docs.map((d: any) => ({
        source_id: src.data.id, external_id: d.external_id, url: d.url || null, title: d.title || null,
        content: clean(d.content || ''), published_at: d.published_at || null,
        metadata: { ...(d.metadata || {}), research_topic: query, collected_at: new Date().toISOString() },
      }));
      const ins = await c.from('raw_documents').upsert(rows, { onConflict: 'source_id,external_id' }).select('id');
      if (ins.error) throw ins.error;

      const ids = (ins.data || []).map((x: any) => x.id);
      if (ids.length) {
        const links = ids.map((raw_document_id: string) => ({ discovery_run_id: run.id, raw_document_id }));
        const linkRes = await c.from('discovery_run_documents').upsert(links, { onConflict: 'discovery_run_id,raw_document_id', ignoreDuplicates: true });
        if (linkRes.error) throw linkRes.error;
        linked += ids.length;
      }
    }

    await c.from('discovery_runs').update({
      status: 'completed', signals_collected: documents.length,
      metadata: { linked_documents: linked, search_queries: {
        github: sources.includes('github') ? buildSearchQueries(query, 'github') : [],
        reddit: sources.includes('reddit') ? buildSearchQueries(query, 'reddit') : [],
        web: sources.includes('web') ? buildSearchQueries(query, 'web') : [],
      } }, completed_at: new Date().toISOString(),
    }).eq('id', run.id);
    return NextResponse.json({ ok: true, run_id: run.id, query, sources, signals_collected: documents.length, linked });
  } catch (e: any) {
    await c.from('discovery_runs').update({ status: 'error', error: e?.message || 'Discovery failed', completed_at: new Date().toISOString() }).eq('id', run.id);
    return NextResponse.json({ error: e?.message || 'Discovery failed', run_id: run.id }, { status: 500 });
  }
}
