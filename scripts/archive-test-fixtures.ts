import { db } from '../src/lib/db';
import { saveResource,keyAction } from '../src/lib/services';
import { roles,type Actor } from '../src/lib/auth';
import type { Kind } from '../src/lib/contracts';
async function main(){
 const user=await db.user.findUniqueOrThrow({where:{email:process.env.ADMIN_EMAIL!}});
 const actor:Actor={id:user.id,userId:user.id,name:user.name,type:'human',role:user.role,scopes:roles[user.role],productIds:[]};
 const products=await db.resource.findMany({where:{kind:'product',createdBy:user.id,OR:[{title:{startsWith:'集成验收 · '}},{title:{startsWith:'浏览器验收 · '}}]}});
 const ids=products.map(p=>p.id);
 const resources=await db.resource.findMany({where:{status:{not:'archived'},OR:[{id:{in:ids}},{productId:{in:ids}}]}});
 for(const r of resources)await db.$transaction(tx=>saveResource(actor,r.kind as Kind,{title:r.title,content:r.content,status:'archived',baseVersion:r.version},tx,r.id));
 const keys=await db.apiKey.findMany({where:{ownerId:user.id,revokedAt:null,name:{startsWith:'浏览器验收 Agent'}}});
 for(const k of keys)await keyAction(actor,k.id,'revoke');
 console.log(`Archived ${resources.length} test resources and revoked ${keys.length} browser test keys; history retained.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
