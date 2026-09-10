import { createClient } from '@supabase/supabase-js';

export type AnalysisRow = { id:string; raw_document_id:string; status:string; is_problem:boolean; is_paid:boolean; reward_amount:number|null; currency:string|null; is_open:boolean|null; has_pr:boolean; is_solved:boolean; is_stale:boolean; difficulty:string|null; technologies:string[]; problem_summary:string|null; opportunity_summary:string|null; opportunity_score:number|null; confidence_score:number|null; pain_score:number|null; demand_score:number|null; payment_score:number|null; evidence_quality:number|null; urgency_score:number|null; competition_score:number|null; workaround_score:number|null; customer_segments:string[]; evidence:Record<string,unknown>; analyzed_at:string|null };
function db(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null}
export async function getAnalyses(limit=100){const c=db();if(!c)return[];const {data}=await c.from('document_analyses').select('*').order('opportunity_score',{ascending:false}).limit(limit);return(data||[]) as AnalysisRow[]}
export async function getDocuments(limit=100){const c=db();if(!c)return[];const {data}=await c.from('raw_documents').select('id,url,title,content,published_at,collected_at,metadata,sources(type,name)').order('collected_at',{ascending:false}).limit(limit);return(data||[]) as any[]}
export async function getSources(){const c=db();if(!c)return[];const {data}=await c.from('sources').select('id,name,type,enabled,created_at,last_collected_at,documents_collected,last_error').order('name');return data||[]}
export async function getProblems(limit=100){const c=db();if(!c)return[];const {data}=await c.from('problems').select('*').order('opportunity_score',{ascending:false}).limit(limit);return data||[]}
export async function getOpportunities(limit=100){const c=db();if(!c)return[];const {data}=await c.from('opportunities').select('*,problems(*)').order('score',{ascending:false}).limit(limit);return data||[]}

async function getLatestRunScoped(c:any, limit:number){
  const runRes=await c.from('discovery_runs').select('id,query,status,signals_collected,problems_found,opportunities_found,started_at,completed_at').order('started_at',{ascending:false}).limit(1).maybeSingle();
  if(runRes.error||!runRes.data)return null;
  const run=runRes.data;
  const linkRes=await c.from('discovery_run_documents').select('raw_document_id').eq('discovery_run_id',run.id).limit(500);
  if(linkRes.error)return null;
  const ids=(linkRes.data||[]).map((x:any)=>x.raw_document_id);
  if(!ids.length)return {run,analyses:[],documents:[],storedProblems:[],storedOpportunities:[]};
  const [a,d]=await Promise.all([
    c.from('document_analyses').select('*').in('raw_document_id',ids).order('opportunity_score',{ascending:false}).limit(limit),
    c.from('raw_documents').select('id,url,title,content,published_at,collected_at,metadata,sources(type,name)').in('id',ids).order('collected_at',{ascending:false}).limit(limit),
  ]);
  const ps=await c.from('problem_signals').select('problem_id').in('raw_document_id',ids);
  const pids=[...new Set((ps.data||[]).map((x:any)=>x.problem_id).filter(Boolean))];
  const problemsRes=pids.length?await c.from('problems').select('*').in('id',pids).order('opportunity_score',{ascending:false}):{data:[]};
  const storedProblems=problemsRes.data||[];
  const storedOpportunities=storedProblems.length?((await c.from('opportunities').select('*,problems(*)').in('problem_id',storedProblems.map((x:any)=>x.id)).order('score',{ascending:false})).data||[]):[];
  return {run,analyses:(a.data||[]) as AnalysisRow[],documents:d.data||[],storedProblems,storedOpportunities};
}

export async function getOverview(){
  const c=db();
  if(!c)return{analyses:[],documents:[],sources:[],problems:0,opportunities:0,highDemand:0,avgDemand:0,storedProblems:[],storedOpportunities:[],run:null};
  const sources=getSources();
  const scoped=await getLatestRunScoped(c,200);
  if(scoped){
    const {analyses,documents,storedProblems,storedOpportunities}=scoped;
    const problems=storedProblems.length||analyses.filter(a=>a.is_problem).length;
    const opportunities=storedOpportunities.length||analyses.filter(a=>a.is_problem&&(a.opportunity_score||0)>=75).length;
    const highDemand=analyses.filter(a=>(a.demand_score||0)>=70).length;
    const avgDemand=analyses.length?Math.round(analyses.reduce((s,a)=>s+Number(a.demand_score||0),0)/analyses.length):0;
    return{analyses,documents,sources:await sources,problems,opportunities,highDemand,avgDemand,storedProblems,storedOpportunities,run:scoped.run};
  }
  const [analyses,documents,sourceRows,storedProblems,storedOpportunities]=await Promise.all([getAnalyses(200),getDocuments(200),sources,getProblems(200),getOpportunities(200)]);
  const problems=storedProblems.length||analyses.filter(a=>a.is_problem).length;const opportunities=storedOpportunities.length||analyses.filter(a=>a.is_problem&&(a.opportunity_score||0)>=75).length;const highDemand=analyses.filter(a=>(a.demand_score||0)>=70).length;const avgDemand=analyses.length?Math.round(analyses.reduce((s,a)=>s+Number(a.demand_score||0),0)/analyses.length):0;return{analyses,documents,sources:sourceRows,problems,opportunities,highDemand,avgDemand,storedProblems,storedOpportunities,run:null};
}

export function groupProblems(analyses:AnalysisRow[]){const groups=new Map<string,any>();for(const a of analyses.filter(x=>x.is_problem)){const base=(a.problem_summary||a.opportunity_summary||'Unspecified problem').replace(/[^a-z0-9 ]/gi,' ').toLowerCase().split(/\s+/).filter(Boolean).slice(0,7).join(' ');const key=base||'unspecified';const g=groups.get(key)||{key,title:a.problem_summary||'Unspecified problem',summary:a.problem_summary||'',mentions:0,pain:0,demand:0,payment:0,opportunity:0,confidence:0,segments:new Set<string>(),sources:new Set<string>()};g.mentions++;for(const f of ['pain','demand','payment','opportunity','confidence'])g[f]+=Number(a[`${f}_score` as keyof AnalysisRow]||0);for(const s of a.customer_segments||[])g.segments.add(s);g.sources.add(String(a.evidence?.source||'unknown'));groups.set(key,g)}return[...groups.values()].map(g=>({...g,pain:Math.round(g.pain/g.mentions),demand:Math.round(g.demand/g.mentions),payment:Math.round(g.payment/g.mentions),opportunity:Math.round(g.opportunity/g.mentions),confidence:Math.round(g.confidence/g.mentions),segments:[...g.segments],sources:[...g.sources]})).sort((a,b)=>b.opportunity-a.opportunity)}
