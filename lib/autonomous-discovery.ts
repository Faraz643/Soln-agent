import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

async function generateTopics(existing: string[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = [
    'You are the autonomous market-research strategist for Soln-Agent.',
    'Your job is to choose research directions that can uncover REAL product opportunities from public conversations.',
    '',
    'Generate 10 research directions. A direction is a specific customer + workflow + recurring pain domain, NOT a startup idea and NOT a vague industry label.',
    'GOOD: "independent consultants struggling to collect late client payments".',
    'GOOD: "small clinics losing leads because WhatsApp inquiries are not followed up".',
    'GOOD: "online sellers reconciling orders, returns and payouts across marketplaces".',
    'BAD: "freelancing".',
    'BAD: "ecommerce operations".',
    'BAD: "AI software".',
    '',
    'Prefer directions with repeated complaints, active discussions on Reddit/X/forums, manual workarounds, money/time loss, urgent jobs, or people already paying for imperfect solutions.',
    'Cover different customer segments and workflows. Avoid repeating previous directions or producing adjacent wording for the same market.',
    'Do not fabricate statistics, companies, or evidence. The reason is only a research hypothesis.',
    `Previously researched directions: ${existing.slice(0, 60).join(' | ')}`,
    '',
    'Return ONLY JSON: {"topics":[{"topic":"specific customer + workflow + pain domain","reason":"why this is worth researching","priority":number}]}',
  ].join('\n');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.55, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini topic generation returned ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no topic suggestions');
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.topics) ? parsed.topics : [];
}

function isEligibleTopic(row: any) {
  return row?.metadata?.topic_type === 'customer_workflow_pain' && String(row.topic || '').trim().length >= 18;
}

export async function ensureTopicQueue() {
  const c = db();
  const { data: rows } = await c.from('discovery_topics').select('topic,metadata').eq('status', 'active').order('last_researched_at', { ascending: true, nullsFirst: true }).limit(150);
  const all = rows || [];
  const eligible = all.filter(isEligibleTopic);
  const existing = all.map((x: any) => String(x.topic));
  if (eligible.length >= 8) return existing;
  const generated = await generateTopics(existing);
  const cleaned = generated
    .map((x: any) => ({ topic: String(x.topic || '').trim(), reason: String(x.reason || '').trim(), priority: Math.max(1, Math.min(100, Number(x.priority) || 50)) }))
    .filter((x: any) => x.topic.length >= 18 && x.topic.length <= 180 && !existing.some(e => e.toLowerCase() === x.topic.toLowerCase()));
  if (cleaned.length) {
    await c.from('discovery_topics').upsert(cleaned.map((x: any) => ({ topic: x.topic, source: 'agent', priority: x.priority, metadata: { reason: x.reason, topic_type: 'customer_workflow_pain' } })), { onConflict: 'topic' });
  }
  return [...existing, ...cleaned.map((x: any) => x.topic)];
}

export async function pickTopic() {
  const c = db();
  await ensureTopicQueue();
  const now = new Date().toISOString();
  const { data: rows } = await c.from('discovery_topics').select('*').eq('status', 'active').or(`next_research_at.is.null,next_research_at.lte.${now}`).order('priority', { ascending: false }).order('last_researched_at', { ascending: true, nullsFirst: true }).limit(50);
  const eligible = (rows || []).filter(isEligibleTopic);
  if (eligible.length) return eligible[0];
  const { data: fallback } = await c.from('discovery_topics').select('*').eq('status', 'active').order('last_researched_at', { ascending: true, nullsFirst: true }).limit(50);
  return (fallback || []).find(isEligibleTopic) || null;
}

export async function markTopic(topicId: string, success: boolean) {
  const c = db();
  const { data: row } = await c.from('discovery_topics').select('times_researched').eq('id', topicId).maybeSingle();
  const next = new Date(Date.now() + (success ? 6 : 1) * 3600000).toISOString();
  await c.from('discovery_topics').update({ last_researched_at: new Date().toISOString(), next_research_at: next, times_researched: Number(row?.times_researched || 0) + 1, updated_at: new Date().toISOString() }).eq('id', topicId);
}
