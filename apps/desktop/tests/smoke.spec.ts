import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import path from 'node:path';

test('isolated renderer exposes only narrow bridge and rejects executable exports', async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>OmniChat test fixture</title><h1>Isolated fixture</h1>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const app = await electron.launch({ args: [path.resolve('dist/main.cjs')], env: { ...process.env, OMNICHAT_DESKTOP_URL: `http://127.0.0.1:${port}` } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading')).toHaveText('Isolated fixture');
    const security = await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process, methods: Object.keys((window as any).omnichatDesktop) }));
    expect(security.require).toBe('undefined'); expect(security.process).toBe('undefined');
    expect(security.methods).not.toContain('invoke'); expect(security.methods).not.toContain('ipcRenderer');
    await expect(page.evaluate(() => (window as any).omnichatDesktop.saveText({ content: 'x', format: 'exe' }))).rejects.toThrow();
    await page.evaluate(() => { window.open('https://example.com/'); });
    expect(app.windows()).toHaveLength(1);
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
    for (const metric of metrics) if (metric.sandboxed !== undefined) expect(metric.sandboxed).toBe(true);
  } finally { await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
