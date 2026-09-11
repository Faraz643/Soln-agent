export type DiscoverySource =
  | 'reddit' | 'x' | 'web' | 'github' | 'hacker_news' | 'indie_hackers'
  | 'product_hunt' | 'stackoverflow' | 'quora' | 'trustpilot' | 'google_maps'
  | 'github_discussions' | 'yc_discussions' | 'google_trends';

export type Signal = {
  source: DiscoverySource;
  external_id: string;
  url: string;
  title: string;
  content: string;
  published_at: string | null;
  metadata: Record<string, unknown>;
};

const UA = 'Soln-Agent/1.0 (product-demand-research)';
const clean = (s: string) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12000);
const strip = (s: string) => clean(String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

async function json(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, cache: 'no-store' });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

function unwrapSearchUrl(value: string) {
  try {
    const raw = value.startsWith('//') ? `https:${value}` : value;
    const u = new URL(raw);
    const redirected = u.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : raw;
  } catch { return value; }
}

async function ddg(q: string, source: DiscoverySource, researchQuery: string, limit = 15): Promise<Signal[]> {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0 Soln-Agent' }, cache: 'no-store' });
  if (!r.ok) return [];
  const html = await r.text();
  const out: Signal[] = [];
  // DDG has changed the result snippet markup over time. Parse result anchors first,
  // then take the nearest snippet text rather than depending on one exact tag shape.
  const resultRe = /<div[^>]*class="[^"]*result[^\"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const blocks: string[] = [];
  let block: RegExpExecArray | null;
  while ((block = resultRe.exec(html)) && blocks.length < limit * 2) blocks.push(block[1]);
  const anchorRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRe = /(?:class="[^"]*result__snippet[^"]*"[^>]*>|class='[^']*result__snippet[^']*'[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>|<\/span>)/i;
  for (const candidate of blocks) {
    const a = candidate.match(anchorRe);
    if (!a) continue;
    const url = unwrapSearchUrl(strip(a[1]));
    if (!url || out.some(x => x.url === url)) continue;
    const sn = candidate.match(snippetRe);
    const title = strip(a[2]);
    const snippet = sn ? strip(sn[1]) : strip(candidate.replace(a[0], '')).slice(0, 1000);
    out.push({ source, external_id: url, url, title, content: clean(`${title}\n\n${snippet}`), published_at: null, metadata: { research_query: researchQuery, collection_method: 'public-web-search', source_query: q } });
    if (out.length >= limit) break;
  }
  // Fallback parser for compact/changed DDG markup.
  if (!out.length) {
    const links = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of links.slice(0, limit)) {
      const url = unwrapSearchUrl(strip(m[1]));
      if (!url || out.some(x => x.url === url)) continue;
      out.push({ source, external_id: url, url, title: strip(m[2]), content: strip(m[2]), published_at: null, metadata: { research_query: researchQuery, collection_method: 'public-web-search-fallback', source_query: q } });
    }
  }
  return out;
}

export async function collectReddit(q: string, researchQuery: string): Promise<Signal[]> {
  const j = await json(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=year&limit=25&raw_json=1`);
  return (j?.data?.children || []).map((x: any) => { const p = x.data; return { source: 'reddit', external_id: String(p.id), url: `https://www.reddit.com${p.permalink}`, title: clean(p.title), content: clean([p.title, p.selftext].filter(Boolean).join('\n\n')), published_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null, metadata: { subreddit: p.subreddit, score: p.score, comments: p.num_comments, author: p.author, research_query: researchQuery, collection_method: 'reddit-api' } }; });
}

export async function collectX(q: string, researchQuery: string): Promise<Signal[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (token) {
    const j = await json(`https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=25&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`, { Authorization: `Bearer ${token}` });
    if (j?.data) { const users = new Map((j.includes?.users || []).map((u: any) => [u.id, u])); return j.data.map((t: any) => { const u: any = users.get(t.author_id); return { source: 'x', external_id: String(t.id), url: `https://x.com/${u?.username || 'i'}/status/${t.id}`, title: u?.name ? `@${u.username} — ${u.name}` : 'X post', content: clean(t.text), published_at: t.created_at || null, metadata: { username: u?.username, likes: t.public_metrics?.like_count || 0, replies: t.public_metrics?.reply_count || 0, reposts: t.public_metrics?.retweet_count || 0, research_query: researchQuery, collection_method: 'x-api' } }; }); }
  }
  return ddg(`site:x.com ${q}`, 'x', researchQuery, 15);
}

export async function collectGitHub(q: string, researchQuery: string, discussions = false): Promise<Signal[]> {
  if (discussions) return ddg(`site:github.com ${q} (discussion OR discussions)`, 'github_discussions', researchQuery, 15);
  const j = await json(`https://api.github.com/search/issues?q=${encodeURIComponent(`${q} is:issue is:open`)}&sort=updated&order=desc&per_page=25`, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  return (j?.items || []).map((i: any) => ({ source: 'github', external_id: String(i.id), url: i.html_url, title: clean(i.title), content: clean(i.body || ''), published_at: i.created_at || null, metadata: { repository: i.repository_url, labels: (i.labels || []).map((x: any) => x.name), comments: i.comments, reactions: i.reactions?.total_count || 0, author: i.user?.login, research_query: researchQuery, collection_method: 'github-api', updated_at: i.updated_at } }));
}

export async function collectHackerNews(q: string, researchQuery: string): Promise<Signal[]> {
  const j = await json(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=25`);
  return (j?.hits || []).map((h: any) => ({ source: 'hacker_news', external_id: String(h.objectID), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, title: clean(h.title || ''), content: clean([h.title, h.story_text].filter(Boolean).join('\n\n')), published_at: h.created_at || null, metadata: { points: h.points, comments: h.num_comments, author: h.author, research_query: researchQuery, collection_method: 'hn-algolia-api' } }));
}

export async function collectStackOverflow(q: string, researchQuery: string): Promise<Signal[]> {
  const j = await json(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=activity&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=25&filter=default`);
  return (j?.items || []).map((x: any) => ({ source: 'stackoverflow', external_id: String(x.question_id), url: x.link, title: clean(x.title), content: clean((x.tags || []).join(', ') + ' ' + (x.title || '')), published_at: x.creation_date ? new Date(x.creation_date * 1000).toISOString() : null, metadata: { tags: x.tags, score: x.score, answers: x.answer_count, views: x.view_count, accepted: !!x.accepted_answer_id, research_query: researchQuery, collection_method: 'stackexchange-api' } }));
}

const SITE_SOURCES: Array<[DiscoverySource, string]> = [
  ['indie_hackers', 'indiehackers.com'], ['product_hunt', 'producthunt.com'], ['quora', 'quora.com'],
  ['trustpilot', 'trustpilot.com'], ['google_maps', 'google.com/maps'], ['yc_discussions', 'ycombinator.com'],
];

export async function collectSite(source: DiscoverySource, q: string, researchQuery: string): Promise<Signal[]> {
  const domain = SITE_SOURCES.find(([s]) => s === source)?.[1];
  return ddg(`site:${domain || source} ${q}`, source, researchQuery, 15);
}

export async function collectWeb(q: string, researchQuery: string): Promise<Signal[]> {
  return ddg(q, 'web', researchQuery, 20);
}

export async function collectGoogleTrends(q: string, researchQuery: string): Promise<Signal[]> {
  const url = `https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}`;
  return [{ source: 'google_trends', external_id: url, url, title: `Google Trends: ${q}`, content: `Trend validation page for ${q}. Open the source to inspect search-interest trajectory and related queries.`, published_at: null, metadata: { research_query: researchQuery, collection_method: 'google-trends-public-page', validation_only: true } }];
}
