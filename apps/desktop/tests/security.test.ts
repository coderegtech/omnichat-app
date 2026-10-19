import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererUrl, isTrustedFrame, externalUrl, savePayload, notificationPayload, contentSecurityPolicy } from '../src/security.ts';

test('packaged renderer requires credential-free HTTPS and exact origin matching', () => {
  assert.throws(() => rendererUrl('http://localhost:3000', true));
  assert.throws(() => rendererUrl('https://user:pass@example.com', true));
  assert.throws(() => rendererUrl('https://example.com/?token=secret', true));
  assert.equal(rendererUrl(undefined, false).origin, 'http://localhost:3000');
  assert.equal(isTrustedFrame('https://chat.example.com/x', 'https://chat.example.com'), true);
  assert.equal(isTrustedFrame('https://chat.example.com.evil.test', 'https://chat.example.com'), false);
  assert.equal(isTrustedFrame('data:text/html,hi', 'https://chat.example.com'), false);
});
test('external link protocol attacks and invalid IPC payloads are rejected', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:pass@example.com']) assert.throws(() => externalUrl(url));
  assert.throws(() => savePayload({ content: 'x'.repeat(10 * 1024 * 1024 + 1), format: 'markdown' }));
  assert.throws(() => savePayload({ content: 'x', format: 'exe' }));
  assert.throws(() => notificationPayload({ title: 'ok', body: { invalid: true } }));
  assert.equal(savePayload({ name: '../../test', content: 'hello', format: 'markdown' }).name.includes('/'), false);
});
test('production CSP blocks eval, frames, objects and cross-origin connect', () => {
  const policy = contentSecurityPolicy('https://chat.example.com', false);
  assert.ok(!policy.includes('unsafe-eval'));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("frame-src 'none'"));
  assert.match(policy, /connect-src 'self'\s*;/);
});
