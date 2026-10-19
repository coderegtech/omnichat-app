import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { commandInput, containerName, createContainerArgs, DockerCommandExecutor, dockerHostEnvironment, EXECUTOR_LIMITS, runDocker, snapshotTar, type DockerRunner } from '../src/coding-executor.js';

const id = 'b84e5e35-f237-44b7-b13f-ed5780c8fabc';
const command = { requestId: id, program: 'node' as const, args: ['-e', 'console.log("hello")'], approved: true as const, allowNetwork: false as const };
const files = [{ path: 'src/main.js', content: 'console.log("hello")' }];
const ownedLabels = JSON.stringify({ app: 'omnichat-coding', 'omnichat.command-id': id });
const setupOutput = (args: readonly string[]) => args[0] === 'container' ? ownedLabels : '';

describe('isolated coding command policy', () => {
  it('requires approval, refuses network and disallows host program/path overrides', () => {
    for (const input of [{ ...command, approved: false }, { ...command, allowNetwork: true }, { ...command, program: 'docker' }, { ...command, program: 'C:\\Windows\\cmd.exe' }, { ...command, args: ['x\0y'] }, { ...command, cwd: '/etc' }]) expect(commandInput.safeParse(input).success).toBe(false);
    expect(commandInput.safeParse({ ...command, args: ['-e', 'console.log("; $(whoami)")'] }).success).toBe(true);
    expect(() => containerName('../../other')).toThrow();
    expect(() => createContainerArgs(containerName(id), '--privileged')).toThrow();
  });
  it('uses fixed resource isolation without bind mounts, host network, socket or secret env', () => {
    const args = createContainerArgs(containerName(id), 'node:22-bookworm-slim');
    for (const required of ['--read-only', '--network', 'none', '--cap-drop', 'ALL', 'no-new-privileges', '512m', '--cpus', '1', '--pids-limit', '64', '1000:1000']) expect(args).toContain(required);
    expect(args).not.toContain('--mount'); expect(args).not.toContain('--volume'); expect(args).not.toContain('--privileged');
    expect(args.slice(0, 3)).toEqual(['run', '--pull', 'never']);
    expect(args.join(' ')).not.toContain('docker.sock');
    const env = dockerHostEnvironment({ PATH: '/bin', OMNIROUTE_API_KEY: 'secret', DATABASE_URL: 'secret', SESSION_SECRET: 'secret', HOME: '/home/operator' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/operator' });
    expect(args.at(-1)).toBe('120'); // Self-expiry even if API process dies.
  });
  it('archives only portable regular source files with unprivileged ownership', () => {
    const tar = snapshotTar(files);
    expect(tar.subarray(0, 100).toString().replace(/\0/g, '')).toBe('src');
    expect(tar[156]).toBe('5'.charCodeAt(0));
    expect(parseInt(tar.subarray(108, 116).toString(), 8)).toBe(1000);
    const fileHeader = tar.subarray(512, 1024);
    expect(fileHeader.subarray(0, 100).toString().replace(/\0/g, '')).toBe('src/main.js');
    expect(fileHeader[156]).toBe('0'.charCodeAt(0));
    expect(tar.subarray(1024, 1024 + Buffer.byteLength(files[0]!.content)).toString()).toBe(files[0]!.content);
    for (const path of ['../secret', '/etc/passwd', 'a\\..\\b', '.env', '.ssh/key']) expect(() => snapshotTar([{ path, content: 'x' }])).toThrow();
    expect(() => snapshotTar([{ path: 'src', content: 'x' }, ...files])).toThrow('both a file and a directory');
    expect(() => snapshotTar([{ path: 'large.txt', content: 'x'.repeat(101 * 1024) }])).toThrow();
  });
});

// Explicit local opt-in. It requires an already-present image and never pulls one.
it.runIf(process.env.TEST_CODING_DOCKER === '1')('runs real node tests in the isolated snapshot and removes the container on completion/cancel', async () => {
  const executor = new DockerCommandExecutor({ enabled: true, image: process.env.CODING_EXECUTOR_IMAGE || 'node:22-bookworm-slim' });
  expect(await executor.availability()).toMatchObject({ available: true });
  const job = randomUUID();
  const source = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { answer } from './src/answer.mjs';
test('source, unprivileged writable snapshot, network and environment isolation', () => {
  assert.equal(answer, 42);
  assert.equal(process.getuid(), 1000);
  fs.writeFileSync('local-result.txt', 'only in container');
  assert.equal(fs.readFileSync('local-result.txt', 'utf8'), 'only in container');
  assert.equal(fs.existsSync('/var/run/docker.sock'), false);
  assert.equal(process.env.OMNIROUTE_API_KEY, undefined);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.OMNICHAT_TEST_HOST_SECRET, undefined);
  assert.ok(Object.keys(os.networkInterfaces()).every(name => name === 'lo'));
  assert.throws(() => fs.writeFileSync('/etc/omnichat-write-test', 'no'));
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /CapEff:\\s+0000000000000000/);
  assert.match(status, /NoNewPrivs:\\s+1/);
});`;
  const previous = process.env.OMNICHAT_TEST_HOST_SECRET;
  process.env.OMNICHAT_TEST_HOST_SECRET = 'fixture-not-a-real-secret';
  try {
    const result = await executor.execute(job, { ...command, requestId: job, args: ['--test', 'fixture.test.mjs'] }, [{ path: 'fixture.test.mjs', content: source }, { path: 'src/answer.mjs', content: 'export const answer = 42;' }], new AbortController().signal);
    expect(result, result.output + String(result.error)).toMatchObject({ status: 'complete', exitCode: 0 });
    expect(result.output).toContain('pass 1');
    const missing = await runDocker(['container', 'inspect', containerName(job)], { timeoutMs: 5000, maxOutputBytes: 4096 });
    expect(missing.code).not.toBe(0);
    const cancelledId = randomUUID(); const cancelled = new AbortController();
    const partial = await executor.execute(cancelledId, { ...command, requestId: cancelledId, args: ['-e', 'console.log("partial-before-cancel"); setInterval(() => {}, 1000);'] }, [], cancelled.signal, output => { if (output.includes('partial-before-cancel')) cancelled.abort(); });
    expect(partial).toMatchObject({ status: 'cancelled', output: 'partial-before-cancel\n' });
    expect((await runDocker(['container', 'inspect', containerName(cancelledId)], { timeoutMs: 5000, maxOutputBytes: 4096 })).code).not.toBe(0);
  } finally { if (previous === undefined) delete process.env.OMNICHAT_TEST_HOST_SECRET; else process.env.OMNICHAT_TEST_HOST_SECRET = previous; }
}, 45_000);

describe('Docker executor lifecycle without starting Docker or a paid provider', () => {
  it('stays disabled by default and never pulls missing images', async () => {
    const runner = vi.fn<DockerRunner>();
    expect((await new DockerCommandExecutor({ enabled: false, image: 'node:22-bookworm-slim' }, runner).availability()).available).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    runner.mockResolvedValue({ code: 1, output: 'No such image' });
    expect((await new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner).availability()).available).toBe(false);
    expect(runner.mock.calls[0]![0]).toEqual(['image', 'inspect', '--format', '{{.Os}}', 'node:22-bookworm-slim']);
  });
  it('copies the snapshot through stdin, executes exact argv and always removes the container', async () => {
    const runner = vi.fn<DockerRunner>().mockImplementation(async (args, options) => {
      if (args[0] === 'exec' && args.includes('node')) { options.onOutput?.('hello\n'); return { code: 0, output: 'hello\n' }; }
      return { code: 0, output: setupOutput(args) };
    });
    const executor = new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner);
    const output = vi.fn(); const result = await executor.execute(id, command, files, new AbortController().signal, output);
    expect(result).toEqual({ status: 'complete', output: 'hello\n', exitCode: 0, error: null });
    expect(runner.mock.calls.map(call => call[0][0])).toEqual(['run', 'exec', 'exec', 'container', 'rm']);
    expect(runner.mock.calls[1]![0]).toEqual(['exec', '--interactive', '--workdir', '/workspace', '--user', '1000:1000', containerName(id), 'tar', '--extract', '--file=-', '--directory=/workspace', '--no-same-owner']);
    expect(runner.mock.calls[1]![1].input).toBeInstanceOf(Buffer);
    expect(runner.mock.calls[2]![0]).toEqual(['exec', '--workdir', '/workspace', '--user', '1000:1000', containerName(id), 'node', ...command.args]);
    expect(runner.mock.calls[2]![1].maxOutputBytes).toBe(EXECUTOR_LIMITS.outputBytes);
    expect(output).toHaveBeenLastCalledWith('hello\n');
  });
  it('preserves partial output on cancellation and cleans up failed copy operations', async () => {
    const controller = new AbortController();
    const runner = vi.fn<DockerRunner>().mockImplementation(async (args, options) => {
      if (args[0] === 'exec' && args.includes('node')) { options.onOutput?.('partial'); controller.abort(); throw new Error('Aborted'); }
      return { code: 0, output: setupOutput(args) };
    });
    const executor = new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner);
    const result = await executor.execute(id, command, files, controller.signal);
    expect(result.status).toBe('cancelled'); expect(result.output).toBe('partial'); expect(runner.mock.calls.at(-1)![0]).toEqual(['rm', '--force', '--volumes', containerName(id)]);
    runner.mockClear().mockImplementation(async args => ({ code: args.includes('tar') ? 1 : 0, output: args.includes('tar') ? 'copy failed' : setupOutput(args) }));
    const failed = await executor.execute(id, command, files, new AbortController().signal);
    expect(failed.status).toBe('error'); expect(failed.error).toContain('source snapshot');
    expect(runner.mock.calls.map(call => call[0][0])).toEqual(['run', 'exec', 'container', 'rm']);
  });
  it('rejects unsafe files before creating a container and fails closed on cleanup error', async () => {
    const runner = vi.fn<DockerRunner>().mockImplementation(async args => ({ code: args[0] === 'rm' ? 1 : 0, output: args[0] === 'rm' ? 'daemon failure' : setupOutput(args) }));
    const executor = new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner);
    await expect(executor.execute(id, command, [{ path: '../escape', content: '' }], new AbortController().signal)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
    const result = await executor.execute(id, command, files, new AbortController().signal);
    expect(result.status).toBe('error'); expect(result.error).toContain('could not be removed');
  });
  it('checks ownership labels before cleanup and never removes unrelated containers', async () => {
    const runner = vi.fn<DockerRunner>().mockResolvedValue({ code: 0, output: JSON.stringify({ app: 'another-app' }) });
    const executor = new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner);
    await expect(executor.remove(id)).rejects.toThrow('ownership labels');
    expect(runner.mock.calls.map(call => call[0][0])).toEqual(['container']);
    runner.mockClear().mockResolvedValue({ code: 1, output: 'No such container' });
    await expect(executor.remove(id)).resolves.toBeUndefined();
    expect(runner.mock.calls).toHaveLength(1);
  });
  it('applies the overall sixty-second timeout and keeps received text', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => { expect(milliseconds).toBe(60_000); return timeout.signal; });
    const runner = vi.fn<DockerRunner>().mockImplementation(async (args, options) => {
      if (args[0] === 'exec' && args.includes('node')) { options.onOutput?.('before timeout'); timeout.abort(); throw new Error('timeout'); }
      return { code: 0, output: setupOutput(args) };
    });
    try {
      const result = await new DockerCommandExecutor({ enabled: true, image: 'node:22-bookworm-slim' }, runner).execute(id, command, files, new AbortController().signal);
      expect(result.status).toBe('error'); expect(result.output).toBe('before timeout'); expect(result.error).toContain('60-second');
      expect(runner.mock.calls.at(-1)![0][0]).toBe('rm');
    } finally { timeoutSpy.mockRestore(); }
  });
});
