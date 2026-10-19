import {describe,it,expect} from 'vitest';
import {parseSSE} from './sse';
const encoder=new TextEncoder();
function stream(chunks:Uint8Array[]) { return new ReadableStream<Uint8Array>({start(controller){chunks.forEach(chunk=>controller.enqueue(chunk));controller.close();}}); }
async function decode(chunks:Uint8Array[]) {const result=[];for await(const frame of parseSSE(stream(chunks)))result.push(frame);return result;}
describe('SSE protocol boundaries',()=>{
  it('decodes every byte split including emoji, CRLF and multiline data',async()=>{
    const bytes=encoder.encode(': heartbeat\r\nevent: message\r\nid: 7\r\ndata: {"text":"🌿"}\r\ndata: continuation\r\n\r\ndata: [DONE]\n\n');
    for(let split=1;split<bytes.length;split++) expect(await decode([bytes.slice(0,split),bytes.slice(split)])).toEqual([{event:'message',id:'7',data:'{"text":"🌿"}\ncontinuation'},{id:'7',data:'[DONE]'}]);
  });
  it('flushes the final frame and ignores comments',async()=>expect(await decode([encoder.encode(': ping\n\ndata: last')])).toEqual([{data:'last'}]));
  it('bounds untrusted frame size',async()=>{await expect((async()=>{for await(const _ of parseSSE(stream([encoder.encode('data: '+'a'.repeat(30))]),10)) { /* consume */ }})()).rejects.toThrow('limit');});
  it('cancels the reader when consumer stops early',async()=>{let cancelled=false;const input=new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode('data: first\n\n'));},cancel(){cancelled=true;}});for await(const _ of parseSSE(input))break;expect(cancelled).toBe(true);});
});
