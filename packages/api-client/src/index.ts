import {parseSSE} from '@omnichat/core';
import type {SendMessageInput, StreamEvent} from '@omnichat/types';

export class ApiError extends Error {
  constructor(public status:number, public code:string, message:string) { super(message); this.name = 'ApiError'; }
}
export interface ApiClientOptions {baseUrl:string; token?:()=>string|null|undefined; fetch?:typeof fetch;}
export type RequestOptions = Omit<RequestInit,'body'> & {body?:unknown};
export class ApiClient {
  private options:ApiClientOptions;
  constructor(options:ApiClientOptions) {this.options=options;}
  private async response(path:string, options:RequestOptions = {}):Promise<Response> {
    const headers = new Headers(options.headers);
    const token = this.options.token?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let body:BodyInit|undefined;
    if (options.body !== undefined) {
      if (typeof FormData !== 'undefined' && options.body instanceof FormData) body=options.body;
      else {headers.set('Content-Type','application/json');body=JSON.stringify(options.body);}
    }
    const response=await (this.options.fetch ?? globalThis.fetch)(`${this.options.baseUrl.replace(/\/$/,'')}/${path.replace(/^\//,'')}`,{...options,body,headers,credentials:token?'omit':'include'});
    if (!response.ok) {
      const payload=await response.json().catch(()=>null) as {error?:{code?:string;message?:string}}|null;
      throw new ApiError(response.status,payload?.error?.code ?? 'REQUEST_FAILED',payload?.error?.message ?? `Request failed (${response.status}).`);
    }
    return response;
  }
  async request<T>(path:string, options:RequestOptions = {}):Promise<T> {
    const response=await this.response(path,options);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  async download(path:string):Promise<Blob> {return (await this.response(path)).blob();}
  async *streamMessage(conversationId:string,input:SendMessageInput,signal?:AbortSignal):AsyncGenerator<StreamEvent> {
    const response=await this.response(`/conversations/${encodeURIComponent(conversationId)}/messages`,{method:'POST',body:input,signal,headers:{Accept:'text/event-stream'}});
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ApiError(502,'INVALID_STREAM','The server did not return an event stream.');
    let terminal=false;
    for await (const frame of parseSSE(response.body)) {
      let event:StreamEvent;
      try {event=JSON.parse(frame.data) as StreamEvent;} catch {throw new ApiError(502,'INVALID_STREAM','A stream event could not be decoded.');}
      if (!event || !['meta','delta','usage','notice','done','error'].includes(event.type)) continue;
      if (event.type==='done' || event.type==='error') terminal=true;
      yield event;
    }
    if (!terminal && !signal?.aborted) throw new ApiError(502,'STREAM_INTERRUPTED','The connection ended before generation completed. Received text is preserved in history.');
  }
}
