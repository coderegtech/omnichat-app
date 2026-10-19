import type { Message, StreamEvent } from '@omnichat/types';

export function visibleBranch(messages: Message[], leafId?: string): Message[] {
  if (!messages.length) return [];
  const byId = new Map(messages.map(m => [m.id, m]));
  let current = byId.get(leafId ?? messages[messages.length - 1]!.id);
  const result: Message[] = []; const seen = new Set<string>();
  while (current && !seen.has(current.id)) { seen.add(current.id); result.unshift(current); current = current.parentId ? byId.get(current.parentId) : undefined; }
  return result;
}

export function applyEvent(message: Message, event: StreamEvent): Message {
  if (event.type === 'delta') return { ...message, content: message.content + event.text };
  if (event.type === 'done') return event.message;
  if (event.type === 'usage') return { ...message, inputTokens: event.inputTokens, outputTokens: event.outputTokens };
  if (event.type === 'error') return { ...message, status: 'error', error: event.message };
  if (event.type === 'meta') return { ...message, id: event.assistantMessageId, parentId: event.userMessageId };
  return message;
}
