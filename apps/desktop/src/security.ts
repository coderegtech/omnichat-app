export function rendererUrl(value: string | undefined, packaged: boolean): URL {
  const url = new URL(value || 'http://localhost:3000');
  if (url.username || url.password || url.search || url.hash) throw new Error('Renderer URL must not contain credentials, a query, or a fragment.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !packaged)) throw new Error('Use HTTPS for the desktop renderer; HTTP loopback is development-only.');
  return url;
}

export function isTrustedFrame(frameUrl: string, origin: string): boolean {
  try { return new URL(frameUrl).origin === origin; } catch { return false; }
}

export function externalUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Invalid external URL');
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only ordinary HTTP(S) links may be opened.');
  return url.href;
}

export function savePayload(input: unknown): { name: string; content: string; format: 'markdown' | 'json' } {
  if (!input || typeof input !== 'object') throw new Error('Invalid export');
  const value = input as Record<string, unknown>;
  if (typeof value.content !== 'string' || Buffer.byteLength(value.content, 'utf8') > 10 * 1024 * 1024) throw new Error('Export exceeds 10 MB.');
  if (value.format !== 'markdown' && value.format !== 'json') throw new Error('Invalid export format.');
  const name = typeof value.name === 'string' ? value.name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) : 'conversation';
  return { name: name || 'conversation', content: value.content, format: value.format };
}

export function notificationPayload(input: unknown): { title: string; body: string } {
  if (!input || typeof input !== 'object') throw new Error('Invalid notification');
  const value = input as Record<string, unknown>;
  if (typeof value.title !== 'string' || typeof value.body !== 'string' || value.title.length > 80 || value.body.length > 300) throw new Error('Notification text is too long.');
  return { title: value.title, body: value.body };
}

export function contentSecurityPolicy(origin: string, development: boolean): string {
  const socket = origin.replace(/^http/, 'ws');
  // Next.js hydration uses inline scripts; no remote script origins or eval in production.
  return [`default-src 'self'`, `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, `font-src 'self' data:`, `connect-src 'self' ${development ? socket : ''}`, `media-src 'self' blob: https:`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`].join('; ');
}
