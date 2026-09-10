import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const clamp = (n: unknown) => Math.max(0, Math.min(100, Number(n) || 0));
const json = (v: unknown) => typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};

async function githubState(url: string | null, externalId: string) {
  if (!url || !url.includes('github.com/')) return { isOpen: null, hasPr: false, isSolved: false, reason: null };
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) return { isOpen: null, hasPr: false, isSolved: false, reason: null };
  const [, owner, repo, number] = m;
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Soln-Agent' };
    const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, { headers, next: { revalidate: 300 } });
    if (!issueRes.ok) return { isOpen: null, hasPr: false, isSolved: false, reason: null };
    const issue = await issueRes.json();
    const timelineRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/timeline`, { headers, next: { revalidate: 300 } });
    let hasPr = false;
    if (timelineRes.ok) {
      const timeline = await timelineRes.json();
      hasPr = Array.isArray(timeline) && timeline.some((x: any) => x?.event === 'cross-referenced' && String(x?.source?.issue?.html_url || '').includes('/pull/'));
    }
    const closed = issue.state === 'closed';
    return { isOpen: !closed, hasPr, isSolved: closed || hasPr, reason: closed ? `GitHub issue is ${issue.state_reason || 'closed'}` : hasPr ? 'A pull request is linked from the issue timeline' : null };
  } catch {
    return { isOpen: null, hasPr: false, isSolved: false, reason: null };
  }
}

async function callModel(input: { title: string; content: string; source: string; metadata: Record<string, unknown> }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const system = `You are Soln-Agent's strict opportunity classifier. Analyze one public document. Return ONLY valid JSON. Do not invent payment, bounties, demand, or status. A GitHub issue is an opportunity only when there is credible evidence of a paid reward/bounty OR a clearly actionable software request; payment is false unless explicitly evidenced. Score demand, payment likelihood, pain and opportunity from 0-100. Reject spam, announcements, tutorials, generic discussion, already-solved work, vague ideas, and content with insufficient evidence. Fields: is_problem:boolean,is_paid:boolean,reward_amount:number|null,currency:string|null,difficulty:string|null,technologies:string[],problem_summary:string,opportunity_summary:string,demand_score:number,payment_score:number,pain_score:number,opportunity_score:number,confidence_score:number,rejection_reason:string|null.`;
  const payload = JSON.stringify(input).slice(0, 30000);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: payload }] }),
  });
  if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

export async function POST(request: NextRequest) {
  const expected = process.env.INGEST_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.raw_document_ids) ? body.raw_document_ids : [];
  if (!ids.length || ids.length > 50) return NextResponse.json({ error: 'raw_document_ids must contain 1-50 ids' }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'Supabase server credentials are not configured' }, { status: 503 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: docs, error } = await db.from('raw_documents').select('id,external_id,url,title,content,published_at,metadata,sources(type,name)').in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const doc of docs || []) {
    try {
      const source = String((doc as any).sources?.type || 'other');
      const meta = json(doc.metadata);
      const gh = source === 'github' ? await githubState(doc.url, doc.external_id) : { isOpen: null, hasPr: false, isSolved: false, reason: null };
      const stale = !!doc.published_at && Date.now() - new Date(doc.published_at).getTime() > 180 * 86400000;
      const ai = await callModel({ title: doc.title || '', content: doc.content || '', source, metadata: meta });
      const isOpen = source === 'github' && gh.isOpen !== null ? gh.isOpen : null;
      const isSolved = gh.isSolved || ai.is_solved === true;
      const hasPr = gh.hasPr || ai.has_pr === true;
      const confidence = clamp(ai.confidence_score);
      const hardReject = !ai.is_problem || isSolved || (stale && source === 'github') || confidence < 70 || clamp(ai.opportunity_score) < 60;
      const status = hardReject ? 'rejected' : (ai.is_paid || clamp(ai.opportunity_score) >= 75 ? 'verified' : 'candidate');
      const rejectionReason = hardReject ? (gh.reason || ai.rejection_reason || (stale ? 'Older than 180 days' : confidence < 70 ? 'Low confidence' : 'Does not meet strict opportunity threshold')) : null;
      const row = {
        raw_document_id: doc.id, status, is_problem: !!ai.is_problem, is_paid: !!ai.is_paid,
        reward_amount: ai.reward_amount == null ? null : Number(ai.reward_amount), currency: ai.currency || null,
        is_open: isOpen, has_pr: hasPr, is_solved: isSolved, is_stale: stale,
        difficulty: ai.difficulty || null, technologies: Array.isArray(ai.technologies) ? ai.technologies.slice(0, 20) : [],
        problem_summary: ai.problem_summary || null, opportunity_summary: ai.opportunity_summary || null,
        opportunity_score: clamp(ai.opportunity_score), confidence_score: confidence, rejection_reason: rejectionReason,
        evidence: { source, metadata: meta, github: gh }, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      const { data: saved, error: saveError } = await db.from('document_analyses').upsert(row, { onConflict: 'raw_document_id' }).select().single();
      if (saveError) throw saveError;
      results.push(saved);
    } catch (e: any) {
      await db.from('document_analyses').upsert({ raw_document_id: doc.id, status: 'error', rejection_reason: e?.message || 'Analysis failed', analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'raw_document_id' });
      results.push({ raw_document_id: doc.id, status: 'error', error: e?.message || 'Analysis failed' });
    }
  }
  return NextResponse.json({ ok: true, analyzed: results.length, results });
}
