export type Capability = 'chat' | 'vision' | 'tools' | 'reasoning' | 'streaming' | 'temperature' | 'images' | 'imageEdits' | 'video' | 'music' | 'search' | 'embeddings' | 'transcription' | 'speech';
export interface Model { id:string; name:string; provider:string; protocol?:string; contextWindow?:number; maxOutputTokens?:number; inputModalities?:string[]; outputModalities?:string[]; capabilities:Partial<Record<Capability,boolean>>; availability:'unknown'|'available'|'unavailable'; metadataSource:'gateway'|'compatibility'; supportedSizes?:string[]; pricing?:Record<string,unknown>; }
export interface EndpointStatus { id:string; label:string; path:string; available:boolean; reason?:string; modelCount?:number; }
export interface ConnectionStatus { status:'connected'|'disconnected'|'unconfigured'; checkedAt:string; lastSuccessAt?:string; error?:string; version?:string; }
export interface ModelRegistry { models:Model[]; connection:ConnectionStatus; endpoints:EndpointStatus[]; }
export interface User { id:string; email:string; name:string; }
export interface Conversation { id:string; title:string; modelId:string|null; pinned:boolean; folderId:string|null; createdAt:string; updatedAt:string; systemPrompt?:string|null; temperature?:number|null; maxTokens?:number|null; }
export interface Message { id:string; conversationId:string; parentId:string|null; role:'user'|'assistant'|'system'; content:string; modelId:string|null; status:'pending'|'streaming'|'complete'|'cancelled'|'error'; createdAt:string; inputTokens?:number|null; outputTokens?:number|null; error?:string|null; attachments?:Attachment[]; }
export type StreamEvent = {type:'meta';conversationId:string;userMessageId:string;assistantMessageId:string} | {type:'delta';text:string} | {type:'usage';inputTokens?:number;outputTokens?:number} | {type:'notice';message:string} | {type:'done';message:Message} | {type:'error';code:string;message:string};
export interface SendMessageInput {content:string; modelId:string; requestId:string; parentId?:string|null; attachmentIds?:string[]; regenerate?:boolean; stream?:boolean; }
export interface Folder {id:string;name:string;}
export interface UserSettings {theme:'dark'|'light'|'system';defaultModel:string|null;favoriteModels:string[];systemPrompt:string;streaming:boolean;animations:boolean;temperature?:number|null;maxTokens?:number|null;}
export interface Attachment {id:string;name:string;mimeType:string;size:number;createdAt:string;extractedText?:string|null;}
export interface GeneratedAsset {id:string;url:string;mimeType:string;}
export interface GenerationJob {id:string;kind:'images'|'imageEdits'|'video'|'music'|'speech'|'transcription';modelId:string;prompt:string;status:'queued'|'running'|'complete'|'failed'|'cancelled';createdAt:string;updatedAt:string;assets:GeneratedAsset[];error?:string|null;}
export interface ListResult<T> {items:T[];nextCursor?:string|null;}
export interface SearchResult {title:string;url:string;snippet?:string;}

export interface CodingProject {id:string;name:string;description:string;source:'imported'|'linked';localPath?:string|null;createdAt:string;updatedAt:string;}
export interface CodingFile {id:string;path:string;content:string;revision:number;updatedAt:string;}
export type CodingAction =
  | {id?:string;type:'write_file';path:string;content:string;baseRevision:number|null}
  | {id?:string;type:'delete_file';path:string;baseRevision:number}
  | {id?:string;type:'run_command';program:'node'|'npm'|'pnpm';args:string[]};
export interface CodingRun {id:string;projectId:string;requestId:string;prompt:string;modelId:string;status:'running'|'awaiting_review'|'applied'|'complete'|'cancelled'|'error'|'rejected';summary:string;actions:CodingAction[];error?:string|null;createdAt:string;updatedAt:string;}
export interface CodingCommand {id:string;projectId:string;requestId:string;program:'node'|'npm'|'pnpm';args:string[];status:'queued'|'running'|'complete'|'error'|'cancelled';output:string;exitCode?:number|null;error?:string|null;createdAt:string;updatedAt:string;}
export interface CodingProjectDetail {project:CodingProject;files:CodingFile[];runs:CodingRun[];}
