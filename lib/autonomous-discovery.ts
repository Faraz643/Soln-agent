import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

function geminiModel() { return process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'; }

async function generateTopics(existing: string[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = [
    'You are the autonomous discovery strategist for a product demand intelligence platform.',
    'Generate 8 concrete research topics that are likely to reveal recurring customer problems and opportunities for software or services.',
    'Do not generate startup ideas. Generate markets/problem domains to investigate.',
    'Prefer areas with active online discussion, painful workflows, money/time loss, repeated workarounds, or rapidly changing behavior.',
    'Cover different customer groups and industries. Avoid duplicates and generic topics like "business problems".',
    `Already researched topics: ${existing.slice(0, 30).join(' | ')}`,
    'Return ONLY JSON: {"topics":[{"topic":"...","reason":"...","priority":number}]}',
  ].join('\n');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini topic generation returned ${res.status}`);
  const data = await res.json(); const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no topic suggestions');
  const parsed = JSON.parse(text); return Array.isArray(parsed.topics) ? parsed.topics : [];
}

export async function ensureTopicQueue() {
  const c = db();
  const { data: rows } = await c.from('discovery_topics').select('topic').order('last_researched_at', { ascending: true, nullsFirst: true }).limit(100);
  const existing = (rows || []).map((x: any) => String(x.topic));
  if (existing.length >= 8) return existing;
  const generated = await generateTopics(existing);
  if (generated.length) {
    await c.from('discovery_topics').upsert(generated.map((x: any) => ({ topic: String(x.topic).trim(), source: 'agent', priority: Math.max(1, Math.min(100, Number(x.priority) || 50)), metadata: { reason: String(x.reason || '') } })).filter((x: any) => x.topic.length >= 8), { onConflict: 'topic' });
  }
  return [...existing, ...generated.map((x: any) => String(x.topic).trim())];
}

export async function pickTopic() {
  const c = db();
  await ensureTopicQueue();
  const now = new Date().toISOString();
  const { data } = await c.from('discovery_topics').select('*').eq('status', 'active').or(`next_research_at.is.null,next_research_at.lte.${now}`).order('priority', { ascending: false }).order('last_researched_at', { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
  if (data) return data;
  const { data: fallback } = await c.from('discovery_topics').select('*').eq('status', 'active').order('last_researched_at', { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
  return fallback;
}

export async function markTopic(topicId: string, success: boolean) {
  const c = db(); const next = new Date(Date.now() + (success ? 6 : 1) * 3600000).toISOString();
  await c.from('discovery_topics').update({ last_researched_at: new Date().toISOString(), next_research_at: next, times_researched: (await c.from('discovery_topics').select('times_researched').eq('id', topicId).maybeSingle()).data?.times_researched ? Number((await c.from('discovery_topics').select('times_researched').eq('id', topicId).maybeSingle()).data?.times_researched) + 1 : 1, updated_at: new Date().toISOString() }).eq('id', topicId);
}
