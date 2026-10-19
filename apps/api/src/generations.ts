import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GatewayError } from '@omnichat/omniroute';
import { authenticate, HttpError } from './security.js';
import { idOf, type Context } from './app.js';
import { job as serializeJob } from './serializers.js';

export function registerGenerations(app:FastifyInstance,{db,gateway,active}:Context) {
  app.get('/api/generations',async request=>{const {userId}=await authenticate(request,db);return {items:(await db.generationJob.findMany({where:{userId},include:{assets:true},orderBy:{createdAt:'desc'},take:50})).map(serializeJob)};});
  app.get('/api/generations/:id',async request=>{const {userId}=await authenticate(request,db);const row=await db.generationJob.findFirst({where:{id:idOf(request),userId},include:{assets:true}});if(!row)throw new HttpError(404,'NOT_FOUND','Generation not found.');return serializeJob(row);});
  app.post('/api/generations/:id/cancel',async request=>{const {userId}=await authenticate(request,db);const id=idOf(request);const row=await db.generationJob.findFirst({where:{id,userId}});if(!row)throw new HttpError(404,'NOT_FOUND','Generation not found.');active.get(`job:${id}`)?.abort();await db.generationJob.updateMany({where:{id,status:{in:['queued','running']}},data:{status:'cancelled'}});return {ok:true};});
  app.post('/api/generations',{config:{rateLimit:{max:10,timeWindow:60_000}}},async(request,reply)=>{
    const {userId}=await authenticate(request,db);
    const body=z.object({kind:z.enum(['images','imageEdits','video','music','speech','transcription']),modelId:z.string().min(1).max(300),prompt:z.string().trim().min(1).max(16000),requestId:z.string().uuid(),options:z.object({size:z.string().max(40).optional()}).strict().default({}),attachmentId:z.string().uuid().optional()}).strict().parse(request.body);
    const existing=await db.generationJob.findUnique({where:{userId_requestId:{userId,requestId:body.requestId}},include:{assets:true}});
    if(existing){if(existing.kind!==body.kind||existing.modelId!==body.modelId||existing.prompt!==body.prompt)throw new HttpError(409,'REQUEST_CONFLICT','This request ID is already used.');return serializeJob(existing);}
    if(body.kind!=='images')throw new HttpError(409,'UNAVAILABLE','This media adapter is not enabled for the installed gateway.');
    if(body.attachmentId)throw new HttpError(409,'UNAVAILABLE','Image editing is not enabled; image generation uses a text prompt.');
    const registry=await gateway.discover();const model=registry.models.find(m=>m.id===body.modelId);
    if(!model?.capabilities.images)throw new HttpError(409,'UNAVAILABLE','Choose a discovered image generation model.');
    if(body.options.size&&!model.supportedSizes?.includes(body.options.size))throw new HttpError(400,'UNSUPPORTED_OPTION','This model has not advertised the selected image size. Use its default.');
    const job=await db.generationJob.create({data:{userId,requestId:body.requestId,kind:body.kind,modelId:body.modelId,prompt:body.prompt,options:body.options,status:'queued'},include:{assets:true}});
    const controller=new AbortController();active.set(`job:${job.id}`,controller);
    // Requests return immediately; state is durable. Interrupted jobs are failed on restart,
    // never automatically retried because a provider may already have charged for them.
    void (async()=>{
      try {
        const started=await db.generationJob.updateMany({where:{id:job.id,status:'queued'},data:{status:'running'}});if(!started.count)return;
        const assets=await gateway.images(body.modelId,body.prompt,body.options,AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]));
        await db.$transaction(async tx=>{
          const completed=await tx.generationJob.updateMany({where:{id:job.id,status:'running'},data:{status:'complete'}});
          if(completed.count)await tx.generatedAsset.createMany({data:assets.map(asset=>({jobId:job.id,...asset}))});
        });
      }catch(error){await db.generationJob.updateMany({where:{id:job.id,status:{in:['queued','running']}},data:{status:controller.signal.aborted?'cancelled':'failed',error:controller.signal.aborted?null:error instanceof GatewayError?error.message:'Image generation failed or timed out. It was not retried.'}}).catch(()=>{});}
      finally{if(active.get(`job:${job.id}`)===controller)active.delete(`job:${job.id}`);}
    })();
    return reply.status(202).send(serializeJob(job));
  });
}
