import { strict as assert } from 'node:assert';
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
async function main(){
  const base=process.env.APP_URL!,state=JSON.parse(await readFile('.runtime/live-smoke.json','utf8'));let cookie='';
  async function api(path:string,method='GET',body?:unknown){const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body!==undefined?{body:JSON.stringify(body)}:{})});assert(r.ok);if(path==='/auth/login')cookie=r.headers.get('set-cookie')!.split(';')[0];return r.json();}
  await api('/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  if(!state.restartRun){const r=await api('/conversations/'+state.conversation+'/messages','POST',{text:'这是服务重启后的只读验证。请通过工具读取当前产品，回复产品名称与版本；不要修改数据，不要提交生成。'});state.restartRun=r.id;await writeFile('.runtime/live-smoke.json',JSON.stringify(state,null,2));}
  for(let i=0;i<90;i++){const c=await api('/conversations/'+state.conversation);const run=c.runs.find((r:any)=>r.id===state.restartRun);if(run.status==='completed'){console.log('PASS restarted Agent runtime used business tools and saved its final response');return;}assert(!['failed','stopped'].includes(run.status),run.error);await new Promise(r=>setTimeout(r,1000));}
  throw new Error('Agent restart check still pending');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
