import {it,expect} from 'vitest';
import {ApiClient} from './index';
it('uses only native session tokens and detects truncated streams without retrying',async()=>{
  let calls=0;
  const api=new ApiClient({baseUrl:'http://localhost/api',token:()=> 'session-token',fetch:async(_url,options)=>{calls++;expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer session-token');return new Response('data: {"type":"delta","text":"partial"}\n\n',{headers:{'Content-Type':'text/event-stream'}});}});
  const received:string[]=[];
  await expect((async()=>{for await(const event of api.streamMessage('id',{content:'hi',modelId:'real',requestId:'unique'}))if(event.type==='delta')received.push(event.text);})()).rejects.toThrow('connection ended');
  expect(received).toEqual(['partial']);expect(calls).toBe(1);
});
it('retains useful server errors and credentials include for browser cookies',async()=>{
 const api=new ApiClient({baseUrl:'/api',fetch:async(_url,options)=>{expect(options?.credentials).toBe('include');return Response.json({error:{code:'UNAVAILABLE',message:'No compatible model'}},{status:409});}});
 await expect(api.request('/generations',{method:'POST',body:{}})).rejects.toMatchObject({status:409,code:'UNAVAILABLE',message:'No compatible model'});
});
