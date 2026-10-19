import type { Conversation, Message } from '@omnichat/types';

/** Select only the chosen branch. Ancestry is bounded and fails on corruption. */
export function messageAncestry<T extends {id:string;parentId:string|null}>(messages:T[], leafId:string|null):T[] {
  const byId = new Map(messages.map(message => [message.id,message]));
  const seen = new Set<string>(); const result:T[] = [];
  let current = leafId;
  while (current) {
    if (seen.has(current)) throw new Error('Conversation ancestry contains a cycle.');
    seen.add(current);
    const message = byId.get(current);
    if (!message) throw new Error('Conversation parent does not exist.');
    result.unshift(message); current = message.parentId;
  }
  return result;
}

/** Character-based safety budget, not a claimed token count. Keep complete turns.
 * Provider tokenization differs. Servers should apply a conservative limit. */
export function trimContext<T extends {role:string;content:string}>(messages:T[], maxCharacters:number):{messages:T[];omitted:number} {
  if (!Number.isFinite(maxCharacters) || maxCharacters < 1) throw new Error('Invalid context budget.');
  const system = messages.filter(m => m.role === 'system');
  const history = messages.filter(m => m.role !== 'system');
  let used = system.reduce((n,m) => n + m.content.length,0);
  if (used > maxCharacters) throw new Error('System instructions exceed the context budget.');
  const selected:T[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]!;
    if (used + message.content.length > maxCharacters) {
      if (i === history.length - 1) throw new Error('The latest message exceeds the context budget.');
      break;
    }
    selected.unshift(message); used += message.content.length;
  }
  while (selected[0]?.role === 'assistant') selected.shift();
  return {messages:[...system,...selected],omitted:history.length-selected.length};
}

export function exportMarkdown(conversation:Pick<Conversation,'title'>, messages:Pick<Message,'role'|'content'|'modelId'|'createdAt'>[]):string {
  return `# ${conversation.title.replace(/[\r\n]/g,' ')}\n\n` + messages.map(m => `## ${m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'You' : 'System'}${m.modelId ? ` · ${m.modelId}` : ''}\n\n${m.content}\n\n_${m.createdAt}_`).join('\n\n---\n\n') + '\n';
}

export const defaultSettings = {theme:'dark' as const,defaultModel:null,favoriteModels:[] as string[],systemPrompt:'',streaming:true,animations:true};
