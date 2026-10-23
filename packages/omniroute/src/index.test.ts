import { describe,it,expect } from 'vitest';
import { OmniRoute, normalizeModel, gatewayFailure } from './index.js';

describe('OmniRoute protocol adapter',()=>{
  it('preserves unknown metadata and explicitly labels the untyped chat compatibility rule',()=>{
    const model=normalizeModel({id:'provider/model',owned_by:'provider'})!;
    expect(model.contextWindow).toBeUndefined();expect(model.capabilities.vision).toBeUndefined();
    expect(model.availability).toBe('unknown');expect(model.metadataSource).toBe('compatibility');
    expect(model.capabilities.chat).toBe(true);
  });
  it('never classifies typed non-chat models as chat',()=>{
    expect(normalizeModel({id:'paint',type:'image'})?.capabilities).toEqual({images:true});
  });
  it('requires credentials unless local no-auth is explicitly enabled',async()=>{
    const gateway=new OmniRoute({baseUrl:'https://gateway.example/v1'});
    expect((await gateway.discover()).connection.status).toBe('unconfigured');
    expect(()=>new OmniRoute({baseUrl:'https://gateway.example/v1',allowNoAuth:true})).toThrow();
  });
  it('incrementally parses fragmented UTF-8 SSE and ignores undisclosed reasoning',async()=>{
    const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello 🌍","reasoning_content":"private"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
    const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}});
    const gateway=new OmniRoute({baseUrl:'http://localhost/v1',allowNoAuth:true,fetch:async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}})});
    const chunks=[];for await(const chunk of gateway.chat({},new AbortController().signal))chunks.push(chunk);
    expect(chunks.map(c=>c.text??'').join('')).toBe('Hello 🌍');expect(chunks.at(-1)?.inputTokens).toBe(4);
  });
  it('rejects a truncated SSE response instead of claiming completion',async()=>{
    const gateway=new OmniRoute({baseUrl:'http://localhost/v1',allowNoAuth:true,fetch:async()=>new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{headers:{'content-type':'text/event-stream'}})});
    const chunks:string[]=[];
    await expect((async()=>{for await(const chunk of gateway.chat({},new AbortController().signal))if(chunk.text)chunks.push(chunk.text);})()).rejects.toThrow('before completion');
    expect(chunks).toEqual(['partial']);
  });
  it('accepts a non-streaming fallback and sends Bearer authentication server-side',async()=>{
    let authorization:string|null=null;
    const gateway=new OmniRoute({baseUrl:'https://gateway.example/v1',apiKey:'test-only-key',fetch:async(_url,init)=>{authorization=new Headers(init?.headers).get('authorization');return Response.json({choices:[{message:{content:'Complete'}}],usage:{completion_tokens:2}});}});
    const chunks=[];for await(const chunk of gateway.chat({},new AbortController().signal))chunks.push(chunk);
    expect(authorization).toBe('Bearer test-only-key');expect(chunks[0]?.text).toBe('Complete');
  });
  it('sanitizes gateway errors without exposing upstream text or credentials',async()=>{
    const gateway=new OmniRoute({baseUrl:'https://gateway.example/v1',apiKey:'test-only-key',fetch:async()=>new Response('secret upstream details',{status:401})});
    const result=await gateway.discover();expect(result.connection.error).not.toContain('secret');expect(result.models).toEqual([]);
  });
  it('explains rate limits with the gateway reason and reset time',async()=>{
    const limited=new Response(JSON.stringify({error:{message:'[codex] All accounts rate limited (reset after 40m 35s)',retry_after:2435}}),{status:429,headers:{'retry-after':'2435'}});
    expect(await gatewayFailure(limited)).toBe('OmniRoute is rate limited: [codex] All accounts rate limited (reset after 40m 35s). Try again in about 41 minutes, or choose a model from another provider.');
    expect(await gatewayFailure(new Response('<html>busy</html>',{status:503}))).toBe('OmniRoute returned HTTP 503. Check its provider diagnostics.');
    expect(await gatewayFailure(new Response(JSON.stringify({error:'bad\nmodel'}),{status:400}))).toBe('OmniRoute returned HTTP 400: bad model');
  });
});
