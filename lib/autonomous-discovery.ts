import { createClient } from '@supabase/supabase-js';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

const SEED_DIRECTIONS = [
  ['independent consultants struggling to collect late client payments', 'Repeated invoicing, follow-up and payment-collection pain for independent professionals.', 90],
  ['small clinics losing leads because WhatsApp inquiries are not followed up', 'Lead response and follow-up gaps in appointment-driven local businesses.', 88],
  ['online sellers reconciling orders, returns and payouts across marketplaces', 'Cross-marketplace reconciliation creates recurring manual finance work.', 87],
  ['property managers coordinating tenant maintenance requests across WhatsApp and email', 'Scattered maintenance requests create missed tasks and slow resolution.', 84],
  ['small agencies tracking client approvals and revisions across email and chat', 'Creative and service agencies often lose context across approval channels.', 84],
  ['home-service businesses scheduling technicians and rescheduling missed appointments', 'Scheduling and dispatch failures directly waste staff time and revenue.', 86],
  ['small restaurants managing delivery-platform menu changes and stock availability', 'Keeping menus and availability consistent across delivery channels is operationally heavy.', 80],
  ['freelance designers protecting scope when clients request endless revisions', 'Scope creep creates unpaid work and difficult client communication.', 86],
  ['small manufacturers tracking purchase orders and supplier delivery delays', 'Supplier status is often tracked manually and late deliveries disrupt planning.', 82],
  ['coaches and tutors handling recurring bookings, cancellations and reminders', 'Recurring appointment administration consumes time and causes avoidable no-shows.', 81],
  ['small exporters preparing repeated shipping and customs documentation', 'Documentation-heavy export workflows create repetitive manual effort and errors.', 79],
  ['recruiters coordinating candidate interviews across clients and applicants', 'Interview scheduling and follow-up creates fragmented coordination work.', 80],
  ['small construction contractors tracking site tasks and client change requests', 'Change requests and field updates can be lost across chat and spreadsheets.', 83],
  ['content creators organizing brand deals, deliverables and invoice follow-ups', 'Creator sponsorship operations span fragmented messages, files and payments.', 82],
  ['small accounting firms collecting missing documents from business clients', 'Repeated document chasing delays recurring accounting workflows.', 85],
  ['event organizers coordinating vendors, deposits and last-minute changes', 'Vendor coordination creates deadline-sensitive operational work.', 78],
  ['small law practices collecting client documents and tracking case follow-ups', 'Document collection and follow-up can become repetitive and difficult to track.', 79],
  ['B2B sales teams losing inbound leads because follow-ups happen in personal inboxes', 'Lead ownership and follow-up gaps can cause measurable revenue leakage.', 89],
  ['small gyms managing memberships, renewals and failed payment follow-ups', 'Recurring membership administration and payment recovery are repetitive workflows.', 84],
  ['independent repair technicians maintaining service history and warranty records', 'Technicians need fast access to service history while working in the field.', 77],
];

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

async function insertSeeds(c: ReturnType<typeof db>) {
  const rows = SEED_DIRECTIONS.map(([topic, reason, priority]) => ({
    topic,
    source: 'agent-seed',
    priority: Number(priority),
    metadata: { reason, topic_type: 'customer_workflow_pain', generated: false },
  }));
  await c.from('discovery_topics').upsert(rows, { onConflict: 'topic', ignoreDuplicates: true });
}

export async function ensureTopicQueue() {
  const c = db();
  const { data: rows } = await c.from('discovery_topics').select('topic,metadata').eq('status', 'active').order('last_researched_at', { ascending: true, nullsFirst: true }).limit(150);
  let all = rows || [];
  const eligible = all.filter(isEligibleTopic);
  const existing = all.map((x: any) => String(x.topic));

  // Never make the first button click wait on an LLM just to invent the initial
  // queue. Seeded customer/workflow hypotheses make the system immediately usable.
  if (!existing.length) {
    await insertSeeds(c);
    const { data: seeded } = await c.from('discovery_topics').select('topic,metadata').eq('status', 'active').order('priority', { ascending: false }).limit(150);
    all = seeded || [];
    return all.map((x: any) => String(x.topic));
  }

  // Once at least one direction exists, use it immediately. AI expansion is only
  // needed when the current queue is exhausted, so a Gemini hiccup cannot block a run.
  if (eligible.length >= 1) return existing;

  let generated: any[] = [];
  try { generated = await generateTopics(existing); } catch {
    // Keep the autonomous engine usable even if topic generation is temporarily
    // unavailable. The next click can retry generation after the current queue changes.
    return existing;
  }
  const cleaned = generated
    .map((x: any) => ({ topic: String(x.topic || '').trim(), reason: String(x.reason || '').trim(), priority: Math.max(1, Math.min(100, Number(x.priority) || 50)) }))
    .filter((x: any) => x.topic.length >= 18 && x.topic.length <= 180 && !existing.some(e => e.toLowerCase() === x.topic.toLowerCase()));
  if (cleaned.length) {
    await c.from('discovery_topics').upsert(cleaned.map((x: any) => ({ topic: x.topic, source: 'agent', priority: x.priority, metadata: { reason: x.reason, topic_type: 'customer_workflow_pain', generated: true } })), { onConflict: 'topic' });
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
