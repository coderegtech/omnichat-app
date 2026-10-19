export interface ServerSentEvent { event?: string; data: string; id?: string; }

/** Incremental WHATWG SSE decoder. Handles CR/LF split across chunks, UTF-8,
 * comments, multiline data, terminal frames, and bounded frame memory. */
export async function* parseSSE(stream: ReadableStream<Uint8Array>, maxFrameBytes = 2_000_000): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [], event: string | undefined, id: string | undefined;
  let frameSize = 0;
  const line = (value: string): ServerSentEvent | undefined => {
    if (value === '') {
      const result = data.length ? { data: data.join('\n'), ...(event ? {event} : {}), ...(id !== undefined ? {id} : {}) } : undefined;
      data = []; event = undefined; frameSize = 0;
      return result;
    }
    frameSize += value.length;
    if (frameSize > maxFrameBytes) throw new Error('SSE frame exceeds the configured limit.');
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon === -1 ? value : value.slice(0, colon);
    let content = colon === -1 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    if (field === 'event') event = content;
    if (field === 'id' && !content.includes('\0')) id = content;
  };
  try {
    while (true) {
      const {value,done} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream:true});
      let index = 0, start = 0;
      while (index < buffer.length) {
        const c = buffer[index];
        if (c !== '\n' && c !== '\r') {index++; continue;}
        if (c === '\r' && index === buffer.length - 1 && !done) break;
        const result = line(buffer.slice(start, index));
        if (c === '\r' && buffer[index + 1] === '\n') index++;
        start = ++index;
        if (result) yield result;
      }
      buffer = buffer.slice(start);
      if (buffer.length + frameSize > maxFrameBytes) throw new Error('SSE frame exceeds the configured limit.');
      if (done) {
        if (buffer) { const result = line(buffer); if (result) yield result; }
        const result = line(''); if (result) yield result;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function encodeSSE(data: unknown): string { return `data: ${JSON.stringify(data)}\n\n`; }
