import { createClient } from '@supabase/supabase-js';

function db(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
}

export async function getAutonomousOverview(){
  const c=db();
  if(!c)return {runs:[],topics:[]};
  const [runs,topics]=await Promise.all([
    c.from('agent_runs').select('id,status,topic,signals_collected,signals_analyzed,problems_found,opportunities_found,started_at,completed_at,error').order('started_at',{ascending:false}).limit(10),
    c.from('discovery_topics').select('id,topic,priority,last_researched_at,times_researched').eq('status','active').order('priority',{ascending:false}).limit(10),
  ]);
  return {runs:runs.data||[],topics:topics.data||[]};
}
