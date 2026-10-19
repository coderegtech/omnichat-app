import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageAncestry, trimContext, encodeSSE } from '@omnichat/core';
import type { StreamEvent } from '@omnichat/types';
import { GatewayError } from '@omnichat/omniroute';
import { authenticate, HttpError } from './security.js';
import { ownedConversation, idOf, type Context } from './app.js';
import { message as serializeMessage } from './serializers.js';

const input=z.object({content:z.string().max(100000),modelId:z.string().min(1).max(300),requestId:z.string().uuid(),parentId:z.string().uuid().nullable().optional(),attachmentIds:z.array(z.string().uuid()).max(8).default([]),regenerate:z.boolean().default(false),stream:z.boolean().optional()}).strict();
export function registerChat(app:FastifyInstance,{db,gateway,config,active}:Context) {
  app.post('/api/conversations/:id/cancel',async request=>{
    const {userId}=await authenticate(request,db);const id=idOf(request);await ownedConversation(db,id,userId);
    active.get(id)?.abort();await db.message.updateMany({where:{conversationId:id,status:{in:['pending','streaming']},role:'assistant'},data:{status:'cancelled'}});return {ok:true};
  });
  app.post('/api/conversations/:id/messages',{config:{rateLimit:{max:30,timeWindow:60_000}}},async(request,reply)=>{
    const {userId}=await authenticate(request,db);const id=idOf(request);const conversation=await ownedConversation(db,id,userId);const body=input.parse(request.body);
    const existing=await db.message.findUnique({where:{conversationId_requestId:{conversationId:id,requestId:body.requestId}},include:{parent:true}});
    if(existing) {
      if(existing.modelId!==body.modelId || (!body.regenerate && existing.parent?.content!==body.content)) throw new HttpError(409,'REQUEST_CONFLICT','This request ID was already used for different content.');
      if(['pending','streaming'].includes(existing.status)) throw new HttpError(409,'GENERATION_ACTIVE','This request is already running.');
      return reply.type('text/event-stream').header('Cache-Control','no-store').send(encodeSSE({type:'meta',conversationId:id,userMessageId:existing.parentId!,assistantMessageId:existing.id})+encodeSSE({type:'done',message:serializeMessage(existing)}));
    }
    if(!body.regenerate && !body.content.trim() && !body.attachmentIds.length) throw new HttpError(400,'EMPTY_MESSAGE','Write a message or attach a document.');
    const registry=await gateway.discover();const model=registry.models.find(m=>m.id===body.modelId);
    if(!model || !model.capabilities.chat) throw new HttpError(409,'MODEL_UNAVAILABLE','Choose a discovered chat-compatible model.');
    const settings=await db.userSettings.findUnique({where:{userId}});
    const all=await db.message.findMany({where:{conversationId:id},include:{attachments:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    let parentId=body.parentId===undefined?all.at(-1)?.id??null:body.parentId;
    const parent=parentId?all.find(m=>m.id===parentId):undefined;
    if(parentId && !parent) throw new HttpError(400,'INVALID_PARENT','The selected branch does not belong to this conversation.');
    if(body.regenerate && parent?.role!=='user') throw new HttpError(400,'INVALID_PARENT','Regenerate requires the original user message.');
    if(parent && ['pending','streaming'].includes(parent.status)) throw new HttpError(409,'GENERATION_ACTIVE','Wait for the current response or stop it first.');
    const ids=[...new Set(body.attachmentIds)];
    const attachments=body.regenerate?parent!.attachments:await db.attachment.findMany({where:{id:{in:ids},userId}});
    if(!body.regenerate && attachments.length!==ids.length) throw new HttpError(404,'NOT_FOUND','An attachment was not found.');
    const branch=messageAncestry(all,parentId);
    const pendingUser=body.regenerate?null:{role:'user',content:body.content,attachments};
    const source=[...branch,...(pendingUser?[pendingUser]:[])];
    const systemPrompt=conversation.systemPrompt??settings?.systemPrompt??'';
    const payloads:{role:string;content:string;attachments:typeof attachments}[]=[];
    if(systemPrompt) payloads.push({role:'system',content:systemPrompt,attachments:[]});
    let documentTruncated=false;
    for(const item of source) {
      let content=item.content;
      for(const attachment of item.attachments) {
        if(attachment.mimeType.startsWith('image/')) {
          if(model.capabilities.vision!==true) throw new HttpError(409,'VISION_UNKNOWN','This model has no confirmed image-input capability. Choose a vision model with a compatibility entry.');
        } else if(attachment.extractedText) {
          if(attachment.extractedText.length>12000) documentTruncated=true;
          content+=`\n\n<attachment name=${JSON.stringify(attachment.name)}>\n${attachment.extractedText.slice(0,12000)}\n</attachment>`;
        }
      }
      payloads.push({role:item.role,content,attachments:item.attachments});
    }
    const maxTokens=conversation.maxTokens??settings?.maxTokens??undefined;
    const budget=model.contextWindow?Math.max(1000,Math.min(80000,model.contextWindow-(maxTokens??2048))):48000;
    let trimmed:ReturnType<typeof trimContext<(typeof payloads)[number]>>;
    try {trimmed=trimContext(payloads,budget);} catch {throw new HttpError(400,'CONTEXT_LIMIT','The latest message or system instructions exceed the conservative context limit. Shorten them or use a model with a larger known context window.');}
    const upstreamMessages=await Promise.all(trimmed.messages.map(async item=>{
      const images=item.attachments.filter(a=>a.mimeType.startsWith('image/'));
      if(!images.length) return {role:item.role,content:item.content};
      return {role:item.role,content:[{type:'text',text:item.content},...await Promise.all(images.map(async a=>({type:'image_url',image_url:{url:`data:${a.mimeType};base64,${(await readFile(join(config.uploadDir,a.storageKey))).toString('base64')}`}})))]};
    }));
    const created=await db.$transaction(async tx=>{
      // A database lock prevents concurrent generations even across API processes.
      // The lock function returns PostgreSQL void, which Prisma cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      if(await tx.message.count({where:{conversationId:id,role:'assistant',status:{in:['pending','streaming']}}})) throw new HttpError(409,'GENERATION_ACTIVE','This conversation already has an active response.');
      const user=body.regenerate?parent!:await tx.message.create({data:{conversationId:id,parentId,role:'user',content:body.content,status:'complete',attachments:{connect:attachments.map(a=>({id:a.id}))}}});
      const assistant=await tx.message.create({data:{conversationId:id,parentId:user.id,role:'assistant',modelId:body.modelId,status:'streaming',requestId:body.requestId}});
      await tx.conversation.update({where:{id},data:{modelId:body.modelId,...(conversation.title==='New conversation'?{title:(body.content.trim()||attachments[0]?.name||'New conversation').slice(0,80)}:{}),updatedAt:new Date()}});
      return {user,assistant};
    });
    const controller=new AbortController();active.set(id,controller);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
    reply.hijack();for(const [key,value] of Object.entries(reply.getHeaders()))if(value!==undefined)reply.raw.setHeader(key,value);
    reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const close=()=>{if(!reply.raw.writableEnded)controller.abort();};reply.raw.on('close',close);
    const emit=async(event:StreamEvent)=>{if(reply.raw.destroyed || reply.raw.writableEnded)return;if(!reply.raw.write(encodeSSE(event)))await Promise.race([once(reply.raw,'drain'),once(reply.raw,'close')]);};
    let content='';let inputTokens:number|undefined;let outputTokens:number|undefined;let lastSave=Date.now();let status='complete';let failure:string|undefined;
    try {
      await emit({type:'meta',conversationId:id,userMessageId:created.user.id,assistantMessageId:created.assistant.id});
      if(trimmed.omitted)await emit({type:'notice',message:`${trimmed.omitted} older messages were omitted to fit a conservative context budget.`});
      if(documentTruncated)await emit({type:'notice',message:'Long attachments were limited to their first 12,000 characters for this request.'});
      const temperature=conversation.temperature??settings?.temperature;
      const upstream={model:body.modelId,messages:upstreamMessages,stream:body.stream??(settings?.streaming!==false && model.capabilities.streaming!==false),...(model.capabilities.temperature===true && temperature!=null?{temperature}:{}),...(maxTokens && model.maxOutputTokens?{max_tokens:Math.min(maxTokens,model.maxOutputTokens)}:{})};
      for await(const chunk of gateway.chat(upstream,signal)) {
        if(chunk.text){content+=chunk.text;if(content.length>2_000_000)throw new HttpError(502,'RESPONSE_LIMIT','The response exceeded the application safety limit.');await emit({type:'delta',text:chunk.text});}
        if(chunk.inputTokens!==undefined)inputTokens=chunk.inputTokens;if(chunk.outputTokens!==undefined)outputTokens=chunk.outputTokens;
        if(Date.now()-lastSave>500){const saved=await db.message.updateMany({where:{id:created.assistant.id,status:'streaming'},data:{content,inputTokens,outputTokens}});if(!saved.count){controller.abort();throw new Error('Cancelled');}lastSave=Date.now();}
      }
    } catch(error) {
      status=controller.signal.aborted?'cancelled':'error';
      failure=status==='cancelled'?undefined:error instanceof GatewayError||error instanceof HttpError?error.message:signal.aborted?'Generation timed out. Partial text was saved.':'The provider connection failed. Partial text was saved.';
      if(status==='error')await emit({type:'error',code:error instanceof GatewayError||error instanceof HttpError?error.code:'STREAM_ERROR',message:failure!});
    } finally {
      if(active.get(id)===controller)active.delete(id);
      try {
        const current=await db.message.findUnique({where:{id:created.assistant.id},select:{status:true}});
        if(current?.status==='cancelled')status='cancelled';
        const saved=await db.message.update({where:{id:created.assistant.id},data:{content,status,error:failure??null,inputTokens,outputTokens}});
        if(inputTokens!==undefined||outputTokens!==undefined){await db.usageRecord.upsert({where:{messageId:saved.id},create:{userId,messageId:saved.id,modelId:body.modelId,inputTokens,outputTokens},update:{inputTokens,outputTokens}});await emit({type:'usage',inputTokens,outputTokens});}
        await db.conversation.update({where:{id},data:{updatedAt:new Date()}});
        await emit({type:'done',message:serializeMessage(saved)});
      } catch {await emit({type:'error',code:'PERSISTENCE_ERROR',message:'The response could not be fully saved. Reload the conversation to check its saved state.'});}
      reply.raw.off('close',close);if(!reply.raw.writableEnded)reply.raw.end();
    }
  });
}
