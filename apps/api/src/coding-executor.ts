import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { validateProjectFiles, validateProjectPath } from '@omnichat/core';
import type { Context } from './app.js';
import { authenticate, HttpError } from './security.js';

export const EXECUTOR_LIMITS = Object.freeze({ timeoutMs: 60_000, outputBytes: 256 * 1024, globalJobs: 2, projectJobs: 1, orphanAgeMs: 180_000 });
const activeStatuses = ['queued', 'running'];
const projectParams = z.object({ id: z.string().uuid() });
const commandParams = projectParams.extend({ commandId: z.string().uuid() });
export const commandInput = z.object({
  requestId: z.string().uuid(), program: z.enum(['node', 'npm', 'pnpm']),
  args: z.array(z.string().max(2048).refine(value => !value.includes('\0'), 'Arguments cannot contain NUL.')).max(32),
  approved: z.literal(true), allowNetwork: z.literal(false),
}).strict().refine(value => value.args.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0) <= 8192, 'Command arguments exceed 8 KB.');

export type ApprovedCommand = z.infer<typeof commandInput>;
export type SourceFile = { path: string; content: string };
export type DockerResult = { code: number; output: string };
export type DockerOptions = { signal?: AbortSignal; timeoutMs: number; maxOutputBytes?: number; input?: Buffer; onOutput?: (text: string) => void };
export type DockerRunner = (args: readonly string[], options: DockerOptions) => Promise<DockerResult>;
type ExecutorConfig = { enabled: boolean; image: string };
type ExecutionResult = { status: 'complete' | 'error' | 'cancelled'; output: string; exitCode: number | null; error: string | null };

function executorConfig(): ExecutorConfig {
  return { enabled: process.env.CODING_EXECUTOR === 'docker', image: process.env.CODING_EXECUTOR_IMAGE || 'node:22-bookworm-slim' };
}

export function dockerHostEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Credentials needed by Docker itself stay on the host. No host variables are
  // forwarded using docker --env or inherited by the command container.
  const keys = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR'];
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

/** Only this fixed Docker executable is ever spawned on the host; user programs are argv inside docker exec. */
export const runDocker: DockerRunner = (args, options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(new Error('Execution cancelled.')); return; }
  const child = spawn(process.platform === 'win32' ? 'docker.exe' : 'docker', [...args], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: dockerHostEnvironment(),
  });
  let output = ''; let bytes = 0; let finished = false; let failure: Error | undefined;
  const limit = options.maxOutputBytes ?? EXECUTOR_LIMITS.outputBytes;
  const terminate = (error: Error) => { if (!failure) failure = error; child.kill('SIGKILL'); };
  const onAbort = () => terminate(new Error('Execution cancelled.'));
  const timer = setTimeout(() => terminate(new Error('Docker operation timed out.')), options.timeoutMs);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const finish = (error?: Error, code?: number | null) => {
    if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
    if (error || failure) reject(error || failure); else resolve({ code: code ?? -1, output });
  };
  const receive = (text: string) => {
    if (failure) return;
    const buffer = Buffer.from(text); const remaining = Math.max(0, limit - bytes);
    let accepted = buffer.subarray(0, remaining).toString('utf8');
    while (Buffer.byteLength(accepted) > remaining) accepted = accepted.slice(0, -1);
    bytes += Buffer.byteLength(accepted); output += accepted;
    try { if (accepted) options.onOutput?.(accepted); }
    catch { terminate(new Error('Command output could not be persisted.')); }
    if (buffer.length > remaining) terminate(new Error(`Output limit of ${limit} bytes exceeded.`));
  };
  child.stdout.setEncoding('utf8').on('data', receive);
  child.stderr.setEncoding('utf8').on('data', receive);
  child.once('error', error => finish(error)); child.once('close', code => finish(undefined, code));
  child.stdin.on('error', () => { /* EPIPE is accompanied by the process exit/error. */ });
  child.stdin.end(options.input);
});

function tarPath(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let i = name.length - 1; i >= 0; i--) if (name[i] === '/') {
    const prefix = name.slice(0, i); const last = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(last) <= 100) return { name: last, prefix };
  }
  throw new Error('A source path is too long for the portable execution archive. Shorten its final filename.');
}

/** USTAR contains only validated regular files/directories, never links, devices or absolute paths. */
export function snapshotTar(files: readonly SourceFile[]): Buffer {
  validateProjectFiles(files);
  const fileNames = new Set(files.map(file => file.path.toLowerCase()));
  const directories = new Set<string>();
  for (const file of files) {
    const parts = validateProjectPath(file.path).split('/');
    for (let i = 1; i < parts.length; i++) {
      const directory = parts.slice(0, i).join('/');
      if (fileNames.has(directory.toLowerCase())) throw new Error('A source path cannot be both a file and a directory.');
      directories.add(directory);
    }
  }
  const records: Buffer[] = [];
  function add(name: string, content: Buffer, directory: boolean) {
    const header = Buffer.alloc(512); const portable = tarPath(name);
    header.write(portable.name, 0, 100, 'utf8'); header.write(portable.prefix, 345, 155, 'utf8');
    const octal = (value: number, at: number, length: number) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', at, length, 'ascii');
    octal(directory ? 0o755 : 0o644, 100, 8); octal(1000, 108, 8); octal(1000, 116, 8); octal(content.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write(directory ? '5' : '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    header.write('omnichat', 265, 8, 'ascii'); header.write('omnichat', 297, 8, 'ascii');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    records.push(header, content);
    if (content.length % 512) records.push(Buffer.alloc(512 - content.length % 512));
  }
  for (const directory of [...directories].sort((a, b) => a.split('/').length - b.split('/').length)) add(directory, Buffer.alloc(0), true);
  for (const file of files) add(file.path, Buffer.from(file.content, 'utf8'), false);
  records.push(Buffer.alloc(1024));
  return Buffer.concat(records);
}

export function containerName(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error('Invalid command identifier.');
  return `omnichat-code-${id}`;
}

export function createContainerArgs(name: string, image: string): string[] {
  if (!/^omnichat-code-[a-f0-9-]{36}$/i.test(name) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,199}$/.test(image)) throw new Error('Invalid executor configuration.');
  return ['run', '--pull', 'never', '--detach', '--name', name, '--label', 'app=omnichat-coding', '--label', `omnichat.command-id=${name.slice('omnichat-code-'.length)}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64', '--ulimit', 'nofile=256:256', '--init', '--stop-timeout', '1',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000', '--tmpfs', '/workspace:rw,nosuid,nodev,size=64m,uid=1000,gid=1000',
    '--user', '1000:1000', '--workdir', '/workspace', '--env', 'HOME=/tmp', '--env', 'CI=1', '--env', 'npm_config_cache=/tmp/npm', '--env', 'npm_config_update_notifier=false',
    '--env', 'COREPACK_ENABLE_NETWORK=0', '--env', 'PNPM_HOME=/tmp/pnpm', '--entrypoint', '/bin/sleep', image, '120'];
}

export class DockerCommandExecutor {
  constructor(private config: ExecutorConfig = executorConfig(), private runner: DockerRunner = runDocker) {}
  async availability(): Promise<{ available: boolean; reason?: string; image: string }> {
    const image = this.config.image;
    if (!this.config.enabled) return { available: false, reason: 'Command execution is disabled. An administrator can enable the isolated Docker executor.', image };
    try {
      createContainerArgs(containerName('00000000-0000-4000-8000-000000000000'), image);
      const result = await this.runner(['image', 'inspect', '--format', '{{.Os}}', image], { timeoutMs: 5000, maxOutputBytes: 4096 });
      if (result.code !== 0) return { available: false, reason: 'Docker is unavailable or the configured image is not present. An administrator must prepare it; OmniChat never pulls images automatically.', image };
      if (result.output.trim() !== 'linux') return { available: false, reason: 'The coding executor requires a Linux container image and Linux-container Docker engine.', image };
      return { available: true, image };
    } catch { return { available: false, reason: 'Docker could not be reached or executor configuration is invalid.', image }; }
  }
  async remove(id: string): Promise<void> {
    const name = containerName(id);
    const inspected = await this.runner(['container', 'inspect', '--format', '{{json .Config.Labels}}', name], { timeoutMs: 5000, maxOutputBytes: 4096 });
    if (inspected.code !== 0) {
      if (/No such (container|object)/i.test(inspected.output)) return;
      throw new Error('The command container could not be inspected for safe cleanup.');
    }
    let labels: Record<string, string> | null;
    try { labels = JSON.parse(inspected.output) as Record<string, string> | null; }
    catch { throw new Error('The command container has invalid ownership labels; cleanup refused.'); }
    if (labels?.app !== 'omnichat-coding' || labels['omnichat.command-id'] !== id) throw new Error('The container ownership labels do not match this command; cleanup refused.');
    const result = await this.runner(['rm', '--force', '--volumes', name], { timeoutMs: 8000, maxOutputBytes: 4096 });
    if (result.code !== 0 && !/No such container/i.test(result.output)) throw new Error('The command container could not be removed. Contact the administrator.');
  }
  async execute(id: string, input: ApprovedCommand, files: readonly SourceFile[], signal: AbortSignal, onOutput: (output: string) => void = () => undefined): Promise<ExecutionResult> {
    const valid = commandInput.parse(input); const name = containerName(id);
    const archive = snapshotTar(files); // Validate before creating any container.
    const overall = AbortSignal.any([signal, AbortSignal.timeout(EXECUTOR_LIMITS.timeoutMs)]);
    let output = ''; let result: ExecutionResult = { status: 'error', output, exitCode: null, error: null };
    try {
      if (!this.config.enabled) throw new Error('The Docker executor is disabled.');
      const created = await this.runner(createContainerArgs(name, this.config.image), { signal: overall, timeoutMs: 15_000, maxOutputBytes: 4096 });
      if (created.code !== 0) throw new Error(`The isolated command container could not start. ${created.output.slice(0, 1000)}`);
      // Docker cp rejects read-only root filesystems even for tmpfs destinations.
      // Extract our regular-file-only archive as UID1000 inside the writable tmpfs.
      const copied = await this.runner(['exec', '--interactive', '--workdir', '/workspace', '--user', '1000:1000', name, 'tar', '--extract', '--file=-', '--directory=/workspace', '--no-same-owner'], { signal: overall, timeoutMs: 15_000, maxOutputBytes: 4096, input: archive });
      if (copied.code !== 0) throw new Error(`The source snapshot could not be copied. ${copied.output.slice(0, 1000)}`);
      const execution = await this.runner(['exec', '--workdir', '/workspace', '--user', '1000:1000', name, valid.program, ...valid.args], {
        signal: overall, timeoutMs: EXECUTOR_LIMITS.timeoutMs, maxOutputBytes: EXECUTOR_LIMITS.outputBytes,
        onOutput: text => { output += text; onOutput(output); },
      });
      result = { status: execution.code === 0 ? 'complete' : 'error', output, exitCode: execution.code, error: execution.code === 0 ? null : `Command exited with code ${execution.code}.` };
    } catch (error) {
      result = { status: signal.aborted ? 'cancelled' : 'error', output, exitCode: null, error: signal.aborted ? 'Cancelled by the user.' : overall.aborted ? 'Command exceeded the 60-second time limit.' : error instanceof Error ? error.message : 'Command execution failed.' };
    } finally {
      try { await this.remove(id); }
      catch (error) { result = { ...result, status: 'error', error: `${result.error ? `${result.error} ` : ''}${error instanceof Error ? error.message : 'Container cleanup failed.'}` }; }
    }
    return result;
  }
}

type StoredCommand = { id: string; projectId: string; requestId: string; program: string; args: unknown; status: string; output: string; exitCode: number | null; error: string | null; createdAt: Date; updatedAt: Date };
const serializeCommand = (row: StoredCommand) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

/** Owner-checked API; commands run against a point-in-time snapshot and never modify project source. */
export function registerCodingCommands(app: FastifyInstance, ctx: Context) {
  const executor = new DockerCommandExecutor();
  const active = new Map<string, { controller: AbortController; output: string; promise: Promise<void> }>();
  let recovering: Promise<void> | undefined;
  let stopping = false;
  async function owned(projectId: string, userId: string) {
    if (!await ctx.db.codingProject.findFirst({ where: { id: projectId, userId }, select: { id: true } })) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  }
  function recoverOrphans(): Promise<void> {
    if (recovering) return recovering;
    recovering = (async () => {
      const stale = await ctx.db.codingCommand.findMany({ where: { status: { in: activeStatuses }, updatedAt: { lt: new Date(Date.now() - EXECUTOR_LIMITS.orphanAgeMs) } }, take: 20, select: { id: true } });
      for (const row of stale) {
        if (active.has(row.id)) continue;
        try { await executor.remove(row.id); }
        catch { continue; } // Keep its capacity reserved until isolation cleanup succeeds.
        await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: { in: activeStatuses }, updatedAt: { lt: new Date(Date.now() - EXECUTOR_LIMITS.orphanAgeMs) } }, data: { status: 'error', error: 'Execution was interrupted by an API restart. Its container was removed; run again only after reviewing the result.' } });
      }
    })().finally(() => { recovering = undefined; });
    return recovering;
  }
  async function run(row: StoredCommand, input: ApprovedCommand, files: SourceFile[], state: { controller: AbortController; output: string }) {
    let pendingSave = Promise.resolve(); let savedAt = 0;
    let checking = false;
    // Another API process can handle cancellation. Never rely solely on a local map.
    const cancellationCheck = setInterval(() => {
      if (checking) return; checking = true;
      void ctx.db.codingCommand.findUnique({ where: { id: row.id }, select: { status: true } })
        .then(record => { if (!record || record.status === 'cancelled') state.controller.abort(); })
        .catch(() => state.controller.abort()).finally(() => { checking = false; });
    }, 500);
    cancellationCheck.unref();
    try {
      const started = await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'running' } });
      if (!started.count) return;
      const result = await executor.execute(row.id, input, files, state.controller.signal, output => {
        state.output = output;
        if (Date.now() - savedAt < 500) return;
        savedAt = Date.now(); const snapshot = output;
        pendingSave = pendingSave.then(async () => { await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: 'running' }, data: { output: snapshot } }); }).catch(() => { state.controller.abort(); });
      });
      await pendingSave;
      const updated = await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: { in: activeStatuses } }, data: result });
      if (!updated.count) await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: 'cancelled' }, data: { output: result.output, exitCode: result.exitCode } });
    } catch (error) {
      await ctx.db.codingCommand.updateMany({ where: { id: row.id, status: { in: activeStatuses } }, data: { status: 'error', output: state.output, error: error instanceof Error ? error.message.slice(0, 2000) : 'The command could not be executed.' } }).catch(() => undefined);
    } finally { clearInterval(cancellationCheck); active.delete(row.id); }
  }
  app.get('/api/projects/:id/executor', async request => {
    const { userId } = await authenticate(request, ctx.db); const { id } = projectParams.parse(request.params); await owned(id, userId);
    return executor.availability();
  });
  app.get('/api/projects/:id/commands', async request => {
    const { userId } = await authenticate(request, ctx.db); const { id } = projectParams.parse(request.params); await owned(id, userId);
    await recoverOrphans();
    return { items: (await ctx.db.codingCommand.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 50 })).map(serializeCommand) };
  });
  app.post('/api/projects/:id/commands', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const { userId } = await authenticate(request, ctx.db); const { id } = projectParams.parse(request.params); await owned(id, userId);
    const input = commandInput.parse(request.body);
    const existing = await ctx.db.codingCommand.findUnique({ where: { projectId_requestId: { projectId: id, requestId: input.requestId } } });
    if (existing) {
      if (existing.program !== input.program || JSON.stringify(existing.args) !== JSON.stringify(input.args)) throw new HttpError(409, 'REQUEST_CONFLICT', 'This request ID already belongs to a different command.');
      return reply.code(200).send(serializeCommand(existing));
    }
    if (stopping) throw new HttpError(503, 'EXECUTOR_STOPPING', 'The API is shutting down.');
    const availability = await executor.availability();
    if (!availability.available) throw new HttpError(409, 'EXECUTOR_UNAVAILABLE', availability.reason!);
    await recoverOrphans();
    const files = await ctx.db.codingFile.findMany({ where: { projectId: id }, select: { path: true, content: true } });
    try { snapshotTar(files); } catch (error) { throw new HttpError(400, 'INVALID_SNAPSHOT', error instanceof Error ? error.message : 'The source snapshot is invalid.'); }
    const reserved = await ctx.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('omnichat-coding-executor-capacity'))`;
      const duplicate = await tx.codingCommand.findUnique({ where: { projectId_requestId: { projectId: id, requestId: input.requestId } } });
      if (duplicate) {
        if (duplicate.program !== input.program || JSON.stringify(duplicate.args) !== JSON.stringify(input.args)) throw new HttpError(409, 'REQUEST_CONFLICT', 'This request ID already belongs to a different command.');
        return { row: duplicate, created: false };
      }
      if (await tx.codingCommand.count({ where: { projectId: id, status: { in: activeStatuses } } }) >= EXECUTOR_LIMITS.projectJobs) throw new HttpError(409, 'COMMAND_ACTIVE', 'This project already has an active command.');
      if (await tx.codingCommand.count({ where: { status: { in: activeStatuses } } }) >= EXECUTOR_LIMITS.globalJobs) throw new HttpError(429, 'EXECUTOR_BUSY', 'The executor is at its two-command capacity. Try again after a running command finishes.');
      return { row: await tx.codingCommand.create({ data: { projectId: id, requestId: input.requestId, program: input.program, args: input.args } }), created: true };
    });
    if (reserved.created) {
      const state = { controller: new AbortController(), output: '', promise: Promise.resolve() };
      active.set(reserved.row.id, state); state.promise = run(reserved.row, input, files, state);
    }
    return reply.code(reserved.created ? 202 : 200).send(serializeCommand(reserved.row));
  });
  app.post('/api/projects/:id/commands/:commandId/cancel', async request => {
    const { userId } = await authenticate(request, ctx.db); const { id, commandId } = commandParams.parse(request.params); await owned(id, userId);
    const row = await ctx.db.codingCommand.findFirst({ where: { id: commandId, projectId: id } });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Command not found.');
    if (!activeStatuses.includes(row.status)) return serializeCommand(row);
    const state = active.get(commandId); state?.controller.abort();
    await ctx.db.codingCommand.updateMany({ where: { id: commandId, status: { in: activeStatuses } }, data: { status: 'cancelled', error: 'Cancelled by the user.', ...(state ? { output: state.output } : {}) } });
    if (!state) await executor.remove(commandId); // The original process also observes the cancelled database state.
    return serializeCommand((await ctx.db.codingCommand.findUniqueOrThrow({ where: { id: commandId } })));
  });
  app.addHook('onClose', async () => {
    stopping = true;
    for (const state of active.values()) state.controller.abort();
    await Promise.allSettled([...active.values()].map(state => state.promise));
  });
}
