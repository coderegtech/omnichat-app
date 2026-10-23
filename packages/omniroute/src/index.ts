import { parseSSE } from '@omnichat/core';
import type { Capability, Model, ModelRegistry, EndpointStatus, SearchResult } from '@omnichat/types';

type Json = Record<string, any>;
export type ModelOverrides = Record<string, Partial<Omit<Model, 'id'>>>;
export interface GatewayConfig { baseUrl: string; apiKey?: string; allowNoAuth?: boolean; overrides?: ModelOverrides; fetch?: typeof fetch; }
export class GatewayError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

/** Explain a failed gateway response using its own short error text and Retry-After, never raw bodies. */
export async function gatewayFailure(response: Response): Promise<string> {
  let detail = '';
  let retryAfter = Number(response.headers.get('retry-after'));
  try {
    const text = (await response.text()).slice(0, 4096);
    const body = JSON.parse(text) as {error?: {message?: unknown; retry_after?: unknown} | string; message?: unknown};
    const raw = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message;
    if (typeof raw === 'string') detail = raw.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 240);
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = Number(typeof body.error === 'object' ? body.error?.retry_after : undefined);
  } catch { /* Non-JSON or unreadable bodies keep the generic explanation. */ }
  if (response.status === 429) {
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Try again in about ${retryAfter < 90 ? `${Math.ceil(retryAfter)} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}, or choose a model from another provider.` : ' Try again later, or choose a model from another provider.';
    return `OmniRoute is rate limited${detail ? `: ${detail.replace(/[.!]+$/, '')}.` : '.'}${wait}`;
  }
  return detail ? `OmniRoute returned HTTP ${response.status}: ${detail}` : `OmniRoute returned HTTP ${response.status}. Check its provider diagnostics.`;
}
const capabilities: Capability[] = ['chat','vision','tools','reasoning','streaming','temperature','images','imageEdits','video','music','search','embeddings','transcription','speech'];
const stringList = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined;
const positiveNumber = (value: unknown): number | undefined => typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : undefined;

/** The only inferred classification is the documented 3.8.51 untyped chat catalogue;
 * it is explicitly marked compatibility, and never implies provider health. */
export function normalizeModel(raw: Json, overrides: ModelOverrides = {}): Model | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const flags: Model['capabilities'] = {};
  for (const key of capabilities) if (typeof raw.capabilities?.[key] === 'boolean') flags[key] = raw.capabilities[key];
  if(flags.tools===undefined && typeof raw.capabilities?.tool_calling==='boolean') flags.tools=raw.capabilities.tool_calling;
  if(flags.vision===undefined && stringList(raw.input_modalities)?.includes('image')) flags.vision=true;
  const kindMap: Record<string, Capability> = { image: 'images', images: 'images', video: 'video', music:'music', embedding:'embeddings', embeddings:'embeddings', transcription:'transcription', speech:'speech', chat:'chat', search:'search' };
  if (kindMap[raw.type]) flags[kindMap[raw.type]!] = true;
  const fallbackChat = !raw.type && flags.chat === undefined;
  if (fallbackChat) flags.chat = true;
  const base: Model = {
    id:raw.id, name:typeof raw.name === 'string' ? raw.name : raw.id,
    provider:typeof raw.owned_by === 'string' ? raw.owned_by : typeof raw.provider === 'string' ? raw.provider : 'Unknown',
    capabilities:flags, availability:'unknown', metadataSource:fallbackChat ? 'compatibility' : 'gateway',
    protocol:typeof raw.protocol === 'string' ? raw.protocol : undefined,
    contextWindow:positiveNumber(raw.context_length ?? raw.context_window), maxOutputTokens:positiveNumber(raw.max_output_tokens),
    inputModalities:stringList(raw.input_modalities),outputModalities:stringList(raw.output_modalities),
    supportedSizes:stringList(raw.supported_sizes),
    pricing:raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : undefined,
  };
  const override = overrides[raw.id];
  return override ? {...base,...override,id:raw.id,capabilities:{...base.capabilities,...override.capabilities},metadataSource:'compatibility',availability:'unknown'} : base;
}

export type ChatChunk = {text?:string; inputTokens?:number; outputTokens?:number};
export class OmniRoute {
  private fetcher: typeof fetch;
  private registry?: ModelRegistry;
  private refreshed = 0;
  private inFlight?: Promise<ModelRegistry>;
  private searchProviders: string[] = [];
  private base: string;
  constructor(private config: GatewayConfig) {
    this.base = config.baseUrl.replace(/\/+$/, '');
    const url = new URL(this.base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('OMNIROUTE_BASE_URL must be an HTTP(S) URL without credentials.');
    if (config.allowNoAuth && !['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(url.hostname)) throw new Error('No-auth mode is limited to a local gateway.');
    this.fetcher = config.fetch ?? fetch;
  }
  private headers(): Record<string,string> { return this.config.apiKey ? {Authorization:`Bearer ${this.config.apiKey}`} : {}; }
  private configured() { return !!this.config.apiKey || !!this.config.allowNoAuth; }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.configured()) throw new GatewayError('GATEWAY_UNCONFIGURED','Set a server-side OmniRoute key, or explicitly enable local no-auth mode.',409);
    let response: Response;
    try { response = await this.fetcher(`${this.base}${path}`, {...init, headers:{...this.headers(),...init.headers}, signal:init.signal ?? AbortSignal.timeout(15_000)}); }
    catch (error) { if (init.signal?.aborted) throw error; throw new GatewayError('GATEWAY_UNREACHABLE','OmniRoute could not be reached. Check the backend gateway URL.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {await response.body?.cancel();throw new GatewayError(`GATEWAY_${response.status}`,'OmniRoute rejected the configured endpoint key.',502);}
      throw new GatewayError(`GATEWAY_${response.status}`, await gatewayFailure(response), response.status === 429 ? 429 : 502);
    }
    return response;
  }
  async discover(force = false): Promise<ModelRegistry> {
    if (!force && this.registry && Date.now()-this.refreshed < 60_000) return this.registry;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.loadRegistry();
    try { return await this.inFlight; } finally { this.inFlight = undefined; }
  }
  private async loadRegistry(): Promise<ModelRegistry> {
    const now = new Date().toISOString();
    try {
      const response = await this.request('/models');
      const body = await response.json() as Json;
      if (!Array.isArray(body.data)) throw new GatewayError('INVALID_CATALOG','OmniRoute returned an invalid model catalogue.');
      const models = body.data.map((row: Json) => normalizeModel(row,this.config.overrides)).filter((row: Model|null): row is Model => row !== null);
      this.searchProviders = [];
      try { const search = await (await this.request('/search')).json() as Json; if (Array.isArray(search.data)) this.searchProviders = search.data.filter((p:Json) => typeof p.id === 'string' && Array.isArray(p.search_types) && p.search_types.includes('web')).map((p:Json)=>p.id); } catch { /* Optional catalogue absent or unauthorized: stays disabled. */ }
      this.registry = {models,connection:{status:'connected',checkedAt:now,lastSuccessAt:now,version:response.headers.get('x-omniroute-version') ?? undefined},endpoints:this.endpoints(models)};
    } catch (error) {
      this.registry = {models:[],connection:{status:this.configured()?'disconnected':'unconfigured',checkedAt:now,lastSuccessAt:this.registry?.connection.lastSuccessAt,error:error instanceof GatewayError ? error.message : 'Model discovery failed.'},endpoints:this.endpoints([])};
    }
    this.refreshed = Date.now();
    return this.registry;
  }
  private endpoints(models:Model[]):EndpointStatus[] {
    const count=(c:Capability)=>models.filter(m=>m.capabilities[c]===true).length;
    return [
      {id:'chat',label:'Chat completions',path:'/v1/chat/completions',available:count('chat')>0,modelCount:count('chat'),reason:'Catalogue compatibility only; provider health is unknown until a request succeeds.'},
      {id:'images',label:'Image generation',path:'/v1/images/generations',available:count('images')>0,modelCount:count('images'),reason:'Synchronous OpenAI-compatible image response; provider defaults are used unless options are advertised.'},
      {id:'search',label:'Web search',path:'/v1/search',available:models.length>0 && this.searchProviders.length>0,modelCount:this.searchProviders.length,reason:'Requires a configured web-search provider reported by GET /v1/search.'},
      ...([['imageEdits','Image edits','images/edits'],['video','Video generation','videos/generations'],['music','Music generation','music/generations'],['speech','Speech','audio/speech'],['transcription','Transcription','audio/transcriptions'],['embeddings','Embeddings','embeddings'],['responses','Responses','responses'],['completions','Legacy completions','completions'],['messages','Anthropic messages','messages'],['rerank','Rerank','rerank'],['moderations','Moderations','moderations'],['batches','Batch API','batches'],['files','Gateway files','files']] as const).map(([id,label,path])=>({id,label,path:`/v1/${path}`,available:false,modelCount:count(id as Capability),reason:'No validated adapter is enabled. Chat uses the compatible chat endpoint; local files use secure application storage.'})),
    ];
  }
  async *chat(body: Json, signal:AbortSignal): AsyncGenerator<ChatChunk> {
    const response = await this.request('/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const json = await response.json() as Json;
      if (json.error) throw new GatewayError('PROVIDER_ERROR','The provider could not complete this response.');
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new GatewayError('INVALID_RESPONSE','The provider returned no text response.');
      yield {text:content,...usage(json.usage)}; return;
    }
    if (!response.body) throw new GatewayError('EMPTY_STREAM','OmniRoute returned an empty stream.');
    let completed=false;
    for await (const event of parseSSE(response.body)) {
      if (event.data === '[DONE]') {completed=true;break;}
      let json:Json;
      try {json=JSON.parse(event.data);} catch {throw new GatewayError('INVALID_STREAM','A malformed event interrupted the provider stream.');}
      if (json.error) throw new GatewayError('PROVIDER_ERROR','The provider reported an error during generation.');
      const choice=json.choices?.[0];
      if (choice?.finish_reason) completed=true;
      const delta=choice?.delta?.content;
      if (typeof delta==='string' || json.usage) yield {text:typeof delta==='string'?delta:undefined,...usage(json.usage)};
    }
    if (!completed) throw new GatewayError('STREAM_INTERRUPTED','The provider connection ended before completion. Partial text was saved.');
  }
  async images(model:string,prompt:string,options:Record<string,unknown>,signal:AbortSignal):Promise<{url:string;mimeType:string}[]> {
    const response=await this.request('/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,prompt,n:1,...options}),signal});
    const body=await response.json() as Json;
    if (!Array.isArray(body.data)) throw new GatewayError('INVALID_IMAGE_RESPONSE','The image provider returned an unsupported response.');
    const assets=body.data.flatMap((item:Json)=>{
      if(typeof item.b64_json==='string' && /^[A-Za-z0-9+/=\r\n]+$/.test(item.b64_json) && item.b64_json.length < 28_000_000) return [{url:`data:image/png;base64,${item.b64_json}`,mimeType:'image/png'}];
      if(typeof item.url==='string' && /^https:\/\//.test(item.url)) return [{url:item.url,mimeType:'image/png'}];
      if(typeof item.url==='string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(item.url) && item.url.length < 28_000_000) return [{url:item.url,mimeType:item.url.slice(5,item.url.indexOf(';'))}];
      return [];
    });
    if (!assets.length) throw new GatewayError('EMPTY_IMAGE_RESPONSE','No supported image assets were returned.');
    return assets;
  }
  async search(query:string):Promise<SearchResult[]> {
    const registry=await this.discover();
    if (!registry.endpoints.find(e=>e.id==='search')?.available) throw new GatewayError('UNAVAILABLE','No configured web-search provider was discovered.',409);
    const body=await (await this.request('/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,max_results:5,search_type:'web'})})).json() as Json;
    if(!Array.isArray(body.results)) throw new GatewayError('INVALID_SEARCH_RESPONSE','The gateway returned unsupported search results.');
    return body.results.filter((r:Json)=>typeof r.title==='string' && typeof r.url==='string' && /^https?:\/\//.test(r.url)).map((r:Json)=>({title:r.title,url:r.url,snippet:typeof r.snippet==='string'?r.snippet:undefined}));
  }
}
function usage(raw:Json|undefined):ChatChunk {
  const count=(value:unknown)=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 && value<=2147483647?value:undefined;
  return {inputTokens:count(raw?.prompt_tokens),outputTokens:count(raw?.completion_tokens)};
}
