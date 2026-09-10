import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3&&!['problem','users','user','people','need','want','using','tool'].includes(w)).slice(0,8).sort().join(' ');
export async function POST(req:NextRequest){
 const secret=process.env.INGEST_SECRET;if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=await req.json().catch(()=>({}));const limit=Math.min(Math.max(Number(body.limit)||200,1),500);const client=db();
 const {data:rows,error}=await client.from('document_analyses').select('*,raw_documents(id,url,title,published_at,collected_at,metadata)').eq('is_problem',true).order('analyzed_at',{ascending:false}).limit(limit);if(error)return NextResponse.json({error:error.message},{status:500});
 const groups=new Map<string,any[]>();for(const r of rows||[]){const k=key(r.problem_summary||r.opportunity_summary||'');if(k){const a=groups.get(k)||[];a.push(r);groups.set(k,a);}}
 let problems=0,opportunities=0,evidence=0;
 for(const [k,list] of groups){const avg=(f:string)=>Math.round(list.reduce((s:any,x:any)=>s+Number(x[f]||0),0)/list.length);const title=list[0].problem_summary||'Unspecified customer problem';const seg=[...new Set(list.flatMap((x:any)=>x.customer_segments||[]))] as string[];const target=seg.join(', ')||'Customer segment requires validation';
  const existing=await client.from('problems').select('id').eq('title',title).limit(1).maybeSingle();let pid=existing.data?.id;
  const payload={title,summary:list[0].problem_summary,target_customer:target,category:(list[0].technologies||[])[0]||'General',pain_score:avg('pain_score'),demand_score:avg('demand_score'),payment_score:avg('payment_score'),opportunity_score:avg('opportunity_score'),mention_count:list.length,last_seen_at:new Date().toISOString(),metadata:{cluster_key:k,segments:seg,source_count:new Set(list.map((x:any)=>x.evidence?.source)).size}};
  if(pid) await client.from('problems').update(payload).eq('id',pid); else {const ins=await client.from('problems').insert(payload).select('id').single();pid=ins.data?.id;} if(!pid)continue;problems++;
  const oppName=(list[0].opportunity_summary||title).slice(0,180);const oe=await client.from('opportunities').select('id').eq('problem_id',pid).limit(1).maybeSingle();let oid=oe.data?.id;if(oid)await client.from('opportunities').update({name:oppName,description:list[0].opportunity_summary,score:avg('opportunity_score'),updated_at:new Date().toISOString(),metadata:{pain:avg('pain_score'),demand:avg('demand_score'),payment:avg('payment_score')}}).eq('id',oid);else {const ins=await client.from('opportunities').insert({problem_id:pid,name:oppName,description:list[0].opportunity_summary,score:avg('opportunity_score'),metadata:{pain:avg('pain_score'),demand:avg('demand_score'),payment:avg('payment_score')}}).select('id').single();oid=ins.data?.id;}if(oid)opportunities++;
  for(const r of list.slice(0,50)){await client.from('problem_signals').upsert({problem_id:pid,raw_document_id:r.raw_document_id,relevance:r.opportunity_score,evidence_quality:r.evidence_quality},{onConflict:'problem_id,raw_document_id'});const ex=String(r.evidence?.ai_evidence?.description||r.problem_summary||'').slice(0,500);await client.from('evidence').insert({problem_id:pid,opportunity_id:oid||null,raw_document_id:r.raw_document_id,signal_type:String(r.evidence?.source||'signal'),strength:r.evidence_quality,excerpt:ex});evidence++;}
  const end=new Date();const start=new Date(end.getTime()-30*86400000);await client.from('trend_snapshots').upsert({problem_id:pid,period_start:start.toISOString(),period_end:end.toISOString(),mentions:list.length,demand_score:avg('demand_score'),pain_score:avg('pain_score')},{onConflict:'problem_id,period_start,period_end'});
 }
 return NextResponse.json({ok:true,groups:groups.size,problems,opportunities,evidence});
}
