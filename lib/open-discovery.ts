import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const model = () => process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

const FALLBACK_LENSES = [
  'people wasting hours on repetitive manual work that still lives in spreadsheets, email or chat',
  'customers actively looking for a simpler tool because their current software is too expensive or complicated',
  'small businesses losing money because important follow-ups, reminders or renewals are handled manually',
  'professionals repeatedly chasing documents, approvals, payments or information from other people',
  'people building scripts, spreadsheets or awkward workarounds because no good product solves the workflow',
  'businesses copying the same data between multiple tools and making mistakes because systems do not connect',
  'customers complaining about hidden fees, pricing complexity or paying for features they do not use',
  'people coordinating appointments, schedules or dispatch manually across WhatsApp, email and calendars',
  'independent workers dealing with scope creep, late payments, client communication or administrative work',
  'online sellers dealing with returns, inventory, marketplace reconciliation or customer support across channels',
  'teams repeatedly asking for a feature or workflow that existing products still handle poorly',
  'people abandoning a workflow because existing software is slow, confusing, unreliable or difficult to configure',
  'local businesses losing leads because inquiries from messaging, forms, calls or social media are not followed up',
  'creators, agencies or service businesses manually managing proposals, approvals, deliverables and invoices',
  'people paying consultants, virtual assistants or agencies to perform a repetitive workflow that software could automate',
  'new or emerging workflows created by AI, regulation, platforms or changing consumer behavior that lack good tooling',
];

async function generateWithAI(recent: string[]) {
  const key = process.env.GEMINI_API_KEY; if (!key) return [];
  const prompt = [
    'You are the open-minded discovery engine for Soln-Agent.',
    'Your mission is NOT to choose a startup category. Generate search lenses that help discover unexpected real-world problems anywhere on the public internet.',
    'Think like a relentless product researcher: follow evidence, not industry categories.',
    '',
    'Generate 14 highly diverse research lenses. Each lens must describe a concrete customer pain, behavior, workaround, failure, unmet request, expense, delay, or repeated frustration that people are likely to discuss publicly.',
    'Do not output startup ideas, products, industries, technologies, or market-size claims.',
    'Avoid broad labels such as freelancing, ecommerce, AI, productivity, healthcare, education or SaaS.',
    'Prefer signals such as: "I keep having to...", "is there a tool...", "I wish...", "we still use a spreadsheet...", "this costs us...", "we pay someone to...", "nothing works for...", "I am looking for an alternative...", repeated feature requests, manual workarounds and complaints about expensive or fragmented software.',
    'Cover different customer types and workflows without forcing categories. Include both obvious and surprising problem spaces.',
    'The lens must be useful for Reddit, X, web discussions and GitHub issue/search discovery.',
    `Recently explored lenses to avoid repeating: ${recent.slice(0, 50).join(' | ') || 'none'}`,
    '',
    'Return ONLY JSON: {"lenses":["..."]}',
  ].join('\n');
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, responseMimeType: 'application/json' } }), cache: 'no-store' });
    if (!r.ok) return []; const j = await r.json(); const text = j.candidates?.[0]?.content?.parts?.[0]?.text; if (!text) return []; const parsed = JSON.parse(text);
    return Array.isArray(parsed.lenses) ? parsed.lenses.map(String).map((x: string) => x.trim()).filter((x: string) => x.length >= 35 && x.length <= 220) : [];
  } catch { return []; }
}

export async function buildOpenResearchPlan() {
  const c = db(); const { data: runs } = await c.from('agent_runs').select('topic,metadata').order('started_at', { ascending: false }).limit(30);
  const recent = (runs || []).flatMap((r: any) => Array.isArray(r.metadata?.research_queries) ? r.metadata.research_queries.map(String) : [String(r.topic || '')]).filter(Boolean);
  const ai = await generateWithAI(recent); const pool = [...ai, ...FALLBACK_LENSES]; const seen = new Set<string>(); const plan: string[] = [];
  for (const raw of pool) { const q = raw.replace(/\s+/g, ' ').trim(); const key = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!key || seen.has(key)) continue; if (recent.some((r) => r.toLowerCase() === q.toLowerCase())) continue; seen.add(key); plan.push(q); if (plan.length >= 12) break; }
  return plan.length ? plan : FALLBACK_LENSES.slice(0, 12);
}
