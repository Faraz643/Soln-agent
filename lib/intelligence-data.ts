import { createClient } from '@supabase/supabase-js';

export type AnalysisRow = {
  id: string;
  raw_document_id: string;
  status: string;
  is_problem: boolean;
  is_paid: boolean;
  reward_amount: number | null;
  currency: string | null;
  is_open: boolean | null;
  has_pr: boolean;
  is_solved: boolean;
  is_stale: boolean;
  difficulty: string | null;
  technologies: string[];
  problem_summary: string | null;
  opportunity_summary: string | null;
  opportunity_score: number | null;
  confidence_score: number | null;
  pain_score: number | null;
  demand_score: number | null;
  payment_score: number | null;
  evidence_quality: number | null;
  urgency_score: number | null;
  competition_score: number | null;
  workaround_score: number | null;
  customer_segments: string[];
  evidence: Record<string, unknown>;
  analyzed_at: string | null;
};

export type DocumentRow = { id: string; url: string | null; title: string | null; content: string | null; published_at: string | null; collected_at: string; metadata: Record<string, unknown>; sources: { type: string; name: string } | null };

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getAnalyses(limit = 100): Promise<AnalysisRow[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client.from('document_analyses').select('*').order('opportunity_score', { ascending: false }).limit(limit);
  return (data || []) as AnalysisRow[];
}

export async function getDocuments(limit = 100): Promise<DocumentRow[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client.from('raw_documents').select('id,url,title,content,published_at,collected_at,metadata,sources(type,name)').order('collected_at', { ascending: false }).limit(limit);
  return (data || []) as unknown as DocumentRow[];
}

export async function getSources() {
  const client = db();
  if (!client) return [];
  const { data } = await client.from('sources').select('id,name,type,enabled,created_at').order('name');
  return data || [];
}

export async function getOverview() {
  const [analyses, documents, sources] = await Promise.all([getAnalyses(200), getDocuments(200), getSources()]);
  const opportunities = analyses.filter(a => a.is_problem && (a.opportunity_score || 0) >= 75).length;
  const problems = analyses.filter(a => a.is_problem).length;
  const highDemand = analyses.filter(a => (a.demand_score || 0) >= 70).length;
  const avgDemand = analyses.length ? Math.round(analyses.reduce((s, a) => s + Number(a.demand_score || 0), 0) / analyses.length) : 0;
  return { analyses, documents, sources, opportunities, problems, highDemand, avgDemand };
}

export function groupProblems(analyses: AnalysisRow[]) {
  const groups = new Map<string, { key: string; title: string; summary: string; mentions: number; pain: number; demand: number; payment: number; opportunity: number; confidence: number; segments: Set<string>; sources: Set<string> }>();
  for (const a of analyses.filter(x => x.is_problem)) {
    const base = (a.problem_summary || a.opportunity_summary || 'Unspecified problem').replace(/[^a-z0-9 ]/gi, ' ').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 7).join(' ');
    const key = base || 'unspecified problem';
    const g = groups.get(key) || { key, title: a.problem_summary || 'Unspecified problem', summary: a.problem_summary || '', mentions: 0, pain: 0, demand: 0, payment: 0, opportunity: 0, confidence: 0, segments: new Set<string>(), sources: new Set<string>() };
    g.mentions += 1;
    g.pain += Number(a.pain_score || 0); g.demand += Number(a.demand_score || 0); g.payment += Number(a.payment_score || 0); g.opportunity += Number(a.opportunity_score || 0); g.confidence += Number(a.confidence_score || 0);
    for (const s of a.customer_segments || []) g.segments.add(s);
    const source = String((a.evidence?.source as string) || 'unknown'); g.sources.add(source);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => ({ ...g, pain: Math.round(g.pain / g.mentions), demand: Math.round(g.demand / g.mentions), payment: Math.round(g.payment / g.mentions), opportunity: Math.round(g.opportunity / g.mentions), confidence: Math.round(g.confidence / g.mentions), segments: [...g.segments], sources: [...g.sources] })).sort((a, b) => b.opportunity - a.opportunity);
}
