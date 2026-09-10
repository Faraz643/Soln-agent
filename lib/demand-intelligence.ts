export type DemandInput = {
  title: string;
  content: string;
  source: string;
  query?: string;
  metadata?: Record<string, unknown>;
};

export type DemandAnalysis = {
  topic_relevance_score: number;
  topic_relevance_reason: string;
  is_problem: boolean;
  is_paid: boolean;
  reward_amount: number | null;
  currency: string | null;
  difficulty: string | null;
  technologies: string[];
  problem_summary: string;
  opportunity_summary: string;
  demand_score: number;
  payment_score: number;
  pain_score: number;
  opportunity_score: number;
  confidence_score: number;
  rejection_reason: string | null;
  is_solved: boolean;
  has_pr: boolean;
  evidence_quality: number;
  urgency_score: number;
  competition_score: number;
  workaround_score: number;
  customer_segments: string[];
  evidence: Record<string, unknown>;
};

const clamp = (n: unknown) => Math.max(0, Math.min(100, Number(n) || 0));

export function normalizeDemandAnalysis(raw: Partial<DemandAnalysis>, source: string): DemandAnalysis {
  const a = raw || {};
  const pain = clamp(a.pain_score);
  const demand = clamp(a.demand_score);
  const payment = clamp(a.payment_score);
  const evidence = clamp(a.evidence_quality);
  const urgency = clamp(a.urgency_score);
  const competition = clamp(a.competition_score);
  const workaround = clamp(a.workaround_score);
  const relevance = clamp(a.topic_relevance_score);

  // Opportunity is deliberately demand-led. Payment is one signal, not a bounty gate.
  const opportunity = clamp(a.opportunity_score ?? (pain * 0.25 + demand * 0.30 + payment * 0.15 + evidence * 0.10 + urgency * 0.10 + workaround * 0.10 - competition * 0.10));
  const confidence = clamp(a.confidence_score);

  return {
    topic_relevance_score: relevance,
    topic_relevance_reason: String(a.topic_relevance_reason || ''),
    is_problem: Boolean(a.is_problem),
    is_paid: Boolean(a.is_paid),
    reward_amount: a.reward_amount == null ? null : Number(a.reward_amount),
    currency: a.currency || null,
    difficulty: a.difficulty || null,
    technologies: Array.isArray(a.technologies) ? a.technologies.slice(0, 20).map(String) : [],
    problem_summary: String(a.problem_summary || ''),
    opportunity_summary: String(a.opportunity_summary || ''),
    demand_score: demand,
    payment_score: payment,
    pain_score: pain,
    opportunity_score: opportunity,
    confidence_score: confidence,
    rejection_reason: a.rejection_reason || null,
    is_solved: Boolean(a.is_solved),
    has_pr: Boolean(a.has_pr),
    evidence_quality: evidence,
    urgency_score: urgency,
    competition_score: competition,
    workaround_score: workaround,
    customer_segments: Array.isArray(a.customer_segments) ? a.customer_segments.slice(0, 10).map(String) : [],
    evidence: typeof a.evidence === 'object' && a.evidence !== null ? a.evidence : { source },
  };
}

export const DEMAND_SYSTEM_PROMPT = `You are Soln-Agent, a Product Demand Intelligence engine. This is NOT a bounty hunter and NOT a code-task classifier.

The user gives you a RESEARCH TOPIC. Every document must first pass a strict topic-relevance gate. A document can only become a demand signal if its actual content is materially about the research topic. Do not infer relevance merely because a few generic words overlap.

Analyze in this order:
1. TOPIC RELEVANCE: Compare the document's title/content with the research topic. Score 0-100. Use 90+ only when the document is clearly about the same people/problem/domain. Score below 40 when it is unrelated, even if individual words overlap. A document about a different technical project, assignment, article, or domain must be rejected.
2. Problem reality: Is there a concrete problem, need, job-to-be-done, or recurring frustration within the research topic?
3. Pain: severity, frequency, consequences, and cost of the current problem.
4. Demand: strength and specificity of people asking for, complaining about, or seeking a solution. Repeated independent evidence is stronger.
5. Willingness to pay: explicit or indirect evidence that users/businesses spend money, request paid solutions, have budgets, or pay for workarounds. Absence of payment evidence does NOT make a problem invalid.
6. Workarounds: manual processes, hacks, spreadsheets, scripts, existing tools, or other ways users cope.
7. Urgency: whether the problem is actively blocking work or causing immediate pain.
8. Competition: quality and saturation of existing alternatives. High competition reduces opportunity but does not erase demand.
9. Evidence quality: direct user evidence, specificity, recency, independent repetition, and source credibility.
10. Product opportunity: whether a focused product could solve the problem for a meaningful customer segment.

IMPORTANT RULES:
- Never invent users, revenue, payment, market size, competitors, or facts not present in the input.
- Do NOT require a GitHub bounty. A GitHub issue is only a demand signal.
- Do NOT treat open/closed status or PR existence as proof that demand does or does not exist. Record them as lifecycle context.
- is_paid means there is evidence of willingness to pay or existing monetary spending around the problem, not a GitHub bounty.
- reward_amount should only be populated when an explicit monetary amount is actually present.
- A feature request can be a valid demand signal if it represents a meaningful customer problem.
- Reject unrelated content, keyword-only matches, spam, announcements, tutorials without a problem, academic assignments, informational articles without a user need, and purely technical noise with no user need.
- For a source such as GitHub, repository/issue context must itself be relevant to the research topic. Do not treat GitHub as a generic problem database.
- If the research topic is about a consumer/customer group, a random software repository with one overlapping word is NOT relevant.
- Separate observed evidence from inference.
- Score each dimension from 0-100.
- opportunity_score should reflect product opportunity, not coding difficulty.
- confidence_score measures confidence in the analysis based on evidence quality.

Return ONLY JSON with exactly these fields:
topic_relevance_score:number,topic_relevance_reason:string,is_problem:boolean,is_paid:boolean,reward_amount:number|null,currency:string|null,difficulty:string|null,technologies:string[],problem_summary:string,opportunity_summary:string,demand_score:number,payment_score:number,pain_score:number,opportunity_score:number,confidence_score:number,rejection_reason:string|null,is_solved:boolean,has_pr:boolean,evidence_quality:number,urgency_score:number,competition_score:number,workaround_score:number,customer_segments:string[],evidence:object`;
`;
