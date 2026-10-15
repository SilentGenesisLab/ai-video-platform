import {expect,test} from "vitest";
import {canUseOpenRouter,openRouterModel} from "../src/worker/openrouter";
import {downloadResult} from "../src/worker/provider";
const job={kind:"image",input:{model:"gpt-image-2.5-flare",channel:"auto"}};
test("only auto or unspecified confirmed failures use final fallback",()=>{
 expect(canUseOpenRouter(job,{status:"failed",fallback_count:1,error:"maintenance"})).toBe(true);
 expect(canUseOpenRouter({...job,input:{model:job.input.model}},{status:"failed"})).toBe(true);
 for(const result of [{status:"running"},{status:"failed",error:"timeout"},{status:"failed",billed_cost:0.3},{status:"failed",result_urls:["result"]}])expect(canUseOpenRouter(job,result)).toBe(false);
 expect(canUseOpenRouter({...job,input:{...job.input,channel:"grsai"}},{status:"failed"})).toBe(false);
 expect(canUseOpenRouter({...job,input:{...job.input,openrouterAttempted:true}},{status:"failed"})).toBe(false);
});
test("official slugs and bounded inline images",async()=>{
 expect(openRouterModel("gpt-image-2.5-sunburst")).toBe("openai/gpt-image-2.5-sunburst");
 expect(()=>openRouterModel("seedance-2.5")).toThrow();
 expect((await downloadResult("data:image/png;base64,YWJj")).buffer.toString()).toBe("abc");
 await expect(downloadResult("data:text/html;base64,YWJj")).rejects.toThrow();
});
