import type { Message } from '@omnichat/types';
import { applyEvent, visibleBranch } from '../src/chat-state';
const message = (id: string, parentId: string | null, content = id): Message => ({ id, parentId, content, conversationId: 'c1', role: id === 'u1' ? 'user' : 'assistant', status: 'complete', modelId: 'fixture', createdAt: '2026-10-16T00:00:00Z' });
test('branch navigation excludes sibling responses and terminates cycles', () => {
  const messages = [message('u1', null), message('a1', 'u1'), message('a2', 'u1')];
  expect(visibleBranch(messages).map(m => m.id)).toEqual(['u1', 'a2']);
  expect(visibleBranch(messages, 'a1').map(m => m.id)).toEqual(['u1', 'a1']);
  expect(visibleBranch([message('x', 'y'), message('y', 'x')])).toHaveLength(2);
});
test('stream errors preserve partial output and done uses authoritative server state', () => {
  let current = message('a1', 'u1', '');
  current = applyEvent(current, { type: 'delta', text: 'Saved partial ' });
  current = applyEvent(current, { type: 'delta', text: 'answer' });
  current = applyEvent(current, { type: 'error', code: 'DISCONNECTED', message: 'Connection lost' });
  expect(current.content).toBe('Saved partial answer'); expect(current.status).toBe('error');
  const saved = { ...current, status: 'cancelled' as const, error: null };
  expect(applyEvent(current, { type: 'done', message: saved })).toEqual(saved);
});
