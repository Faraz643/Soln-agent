import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DEMAND_SYSTEM_PROMPT, normalizeDemandAnalysis } from '@/lib/demand-intelligence';

const json = (v: unknown) => typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};

async function githubState(url: string | null) {
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
    return { isOpen: !closed, hasPr, isSolved: closed, reason: closed ? `GitHub issue is ${issue.state_reason || 'closed'}` : null };
  } catch {
    return { isOpen: null, hasPr: false, isSolved: false, reason: null };
  }
}

async function callGemini(input: { title: string; content: string; source: string; metadata: Record<string, unknown>; lifecycle: Record<string, unknown> }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const payload = JSON.stringify(input).slice(0, 30000);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: DEMAND_SYSTEM_PROMPT }] }, contents: [{ role: 'user', parts: [{ text: payload }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini API returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no analysis');
  return { data: JSON.parse(text), model };
}

export async function POST(request: NextRequest) {
  const expected = process.env.INGEST_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.raw_document_ids) ? body.raw_document_ids : [];
  const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 50);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'Supabase server credentials are not configured' }, { status: 503 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let docs: any[] | null = null;
  let error: any = null;
  if (ids.length) {
    if (ids.length > 50) return NextResponse.json({ error: 'raw_document_ids must contain at most 50 ids' }, { status: 400 });
    ({ data: docs, error } = await db.from('raw_documents').select('id,external_id,url,title,content,published_at,metadata,sources(type,name)').in('id', ids));
  } else {
    ({ data: docs, error } = await db.from('raw_documents').select('id,external_id,url,title,content,published_at,metadata,sources(type,name)').order('collected_at', { ascending: false }).limit(limit));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const doc of docs || []) {
    try {
      const source = String(doc.sources?.type || 'other');
      const meta = json(doc.metadata);
      const gh = source === 'github' ? await githubState(doc.url) : { isOpen: null, hasPr: false, isSolved: false, reason: null };
      const stale = !!doc.published_at && Date.now() - new Date(doc.published_at).getTime() > 180 * 86400000;
      const { data: aiRaw, model } = await callGemini({ title: doc.title || '', content: doc.content || '', source, metadata: meta, lifecycle: gh });
      const ai = normalizeDemandAnalysis(aiRaw, source);
      const isOpen = source === 'github' && gh.isOpen !== null ? gh.isOpen : null;
      const isSolved = gh.isSolved || ai.is_solved;
      const hasPr = gh.hasPr || ai.has_pr;
      const status = !ai.is_problem ? 'rejected' : ai.confidence_score < 45 ? 'candidate' : ai.opportunity_score >= 75 ? 'verified' : 'candidate';
      const row = {
        raw_document_id: doc.id, status, is_problem: ai.is_problem, is_paid: ai.is_paid, reward_amount: ai.reward_amount, currency: ai.currency,
        is_open: isOpen, has_pr: hasPr, is_solved: isSolved, is_stale: stale, difficulty: ai.difficulty, technologies: ai.technologies,
        problem_summary: ai.problem_summary || null, opportunity_summary: ai.opportunity_summary || null, opportunity_score: ai.opportunity_score,
        confidence_score: ai.confidence_score, rejection_reason: status === 'rejected' ? (ai.rejection_reason || 'Not a meaningful problem signal') : null,
        evidence: { source, metadata: meta, lifecycle: gh, model_scores: { pain: ai.pain_score, demand: ai.demand_score, payment: ai.payment_score, evidence_quality: ai.evidence_quality, urgency: ai.urgency_score, competition: ai.competition_score, workaround: ai.workaround_score }, customer_segments: ai.customer_segments, ai_evidence: ai.evidence },
        model, analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString(), pain_score: ai.pain_score, demand_score: ai.demand_score,
        payment_score: ai.payment_score, evidence_quality: ai.evidence_quality, urgency_score: ai.urgency_score, competition_score: ai.competition_score,
        workaround_score: ai.workaround_score, customer_segments: ai.customer_segments,
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
