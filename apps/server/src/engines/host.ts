/** Shared, permission-checked host tools for engines that supply only inference. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, readdir } from 'node:fs/promises';

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import { sandboxSupport, secretPlaces } from '../conversations/sandbox';
import { PROTECTED_MESSAGE, touchesProtected } from '../lib/protect';
import { SEALED_HINT } from './trust';
import type { HostTool, TurnInput } from './types';

const MAX_FILE = 1024 * 1024;
/** Serialize Conch edits to one canonical file across tasks; external changes still face the precondition. */
const mutations = new Map<string, Promise<unknown>>();
async function mutateFile<T>(path: string, run: () => Promise<T>): Promise<T> {
  const next = (mutations.get(path) ?? Promise.resolve()).catch(() => undefined).then(run);
  mutations.set(path, next);
  try {
    return await next;
  } finally {
    if (mutations.get(path) === next) mutations.delete(path);
  }
}
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/**
 * A path as the file system really names it, even when it does not exist yet: the deepest
 * existing ancestor is resolved and the rest re-attached. Paths compared with a realpath'd
 * workspace must be canonical too, or a symlinked prefix (macOS's /var → /private/var, a
 * linked home folder) lets a protected file slip past the check.
 */
async function canonical(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await canonical(parent), basename(absolute));
  }
}

/** Every protected place, in both the form it was given and its canonical form. */
export async function forbiddenPlaces(input: FileAccess): Promise<string[]> {
  const given = [...(input.protectedPaths ?? []), ...secretPlaces().map((p) => p.path)].map((p) =>
    resolve(p),
  );
  return [...new Set([...given, ...(await Promise.all(given.map(canonical)))])];
}

/** Only ambient process plumbing, never provider credentials or arbitrary inherited variables. */
export function hostEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot', 'WINDIR']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

export type FileAccess = Pick<TurnInput, 'cwd' | 'readableDirs' | 'protectedPaths'>;

export async function hostPath(input: FileAccess, raw: string, writing = false): Promise<string> {
  const workspace = await realpath(input.cwd);
  const path = resolve(workspace, raw);
  const roots = [
    workspace,
    ...(!writing ? await Promise.all((input.readableDirs ?? []).map((p) => realpath(p))) : []),
  ];
  if (!roots.some((root) => within(root, path)))
    throw new Error('Use a file inside this conversation’s work folder.');
  const forbidden = await forbiddenPlaces(input);
  const parent = await realpath(dirname(path));
  if (!roots.some((root) => within(root, parent)))
    throw new Error('That link leaves the work folder.');
  const actual = resolve(parent, relative(dirname(path), path));
  if (forbidden.some((p) => within(p, actual))) throw new Error(PROTECTED_MESSAGE);
  const stat = await lstat(actual).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' && writing) return undefined;
    throw error;
  });
  if (stat?.isSymbolicLink() || (stat?.isFile() && stat.nlink > 1))
    throw new Error('Linked files are not available to this tool.');
  return actual;
}

/** A model asking for 1s to run `pnpm check` only gets it killed: no command gets less than this. */
const MIN_COMMAND_MS = 10_000;

/** A separate runtime per command: its global sandbox policy cannot cross conversations. */
const WORKER = `
import { spawn } from 'node:child_process';
let data = ''; for await (const part of process.stdin) data += part;
const { module, command, cwd, config } = JSON.parse(data);
const { SandboxManager } = await import(module);
try {
  await SandboxManager.initialize(config);
  const wrapped = await SandboxManager.wrapWithSandbox(command);
  const child = spawn(wrapped, { shell: '/bin/sh', cwd, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
  process.exitCode = await new Promise((done) => { child.once('error', () => done(1)); child.once('exit', (code) => done(code ?? 1)); });
} catch { console.error('The command sandbox could not start. Check Settings → Health.'); process.exitCode = 1; }
finally { await SandboxManager.reset(); }
`;

/** Commands in this turn run sealed: this computer can, and sealing is on (it hands the turn its box). */
export function sealable(input: Pick<TurnInput, 'sandbox'>): boolean {
  return Boolean(input.sandbox) && sandboxSupport().available;
}

/**
 * Run a command for the assistant. Sealed by the operating system when this
 * computer can (no network, no secrets, writes only in the work folder).
 * `unsealed`: it runs as you, with your access — the person said yes to that
 * (or chose Full trust), and it's how a repository is cloned or a package
 * installed. A computer that can't seal commands runs every one that way.
 */
export async function runHostCommand(
  input: TurnInput,
  command: string,
  timeoutMs: number,
  { unsealed = false }: { unsealed?: boolean } = {},
): Promise<string> {
  input.signal.throwIfAborted();
  // No box for this turn: this computer can't make one, or sealing is off in Settings.
  const unboxed = unsealed || !sealable(input);
  if (unboxed) {
    // A command that names Conch's keys or your sign-ins is refused. Only a
    // speed bump: unsealed, a command runs with your access, which is why it asks first.
    const places = [...(input.protectedPaths ?? []), ...secretPlaces().map((p) => p.path)];
    if (touchesProtected({ command }, places)) throw new Error(PROTECTED_MESSAGE);
  }
  const child = unboxed
    ? spawn(command, {
        cwd: input.cwd,
        env: hostEnvironment(),
        // The system's own shell: sh where there is one, cmd on Windows.
        shell: process.platform === 'win32' ? true : '/bin/sh',
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    : spawn(process.execPath, ['--input-type=module', '-e', WORKER], {
        cwd: input.cwd,
        env: hostEnvironment(),
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
  let output = '';
  let timedOut = false;
  const stop = () => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      /* Already exited. */
    }
  };
  const timer = setTimeout(
    () => {
      timedOut = true;
      stop();
    },
    Math.max(timeoutMs, MIN_COMMAND_MS),
  ).unref();
  input.signal.addEventListener('abort', stop, { once: true });
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-64_000);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  if (!unboxed && child.stdin) {
    child.stdin.on('error', () => {});
    child.stdin.end(
      JSON.stringify({
        module: import.meta.resolve('@anthropic-ai/sandbox-runtime'),
        command,
        cwd: input.cwd,
        config: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: {
            allowWrite: [input.cwd],
            denyWrite: [...(input.protectedPaths ?? []), resolve(input.cwd, '.git')],
            denyRead: [
              ...(input.sandbox?.denyRead ?? []),
              ...(input.protectedPaths ?? []),
              ...secretPlaces().map((p) => p.path),
            ],
          },
        },
      }),
    );
  }
  try {
    const code = await new Promise<number | null>((done, fail) => {
      child.once('error', fail);
      child.once('close', done);
    });
    input.signal.throwIfAborted();
    if (timedOut)
      throw new Error(
        `The command took longer than ${Math.round(timeoutMs / 1000)}s and was stopped. For a long one (a big clone, an install), set timeout_ms higher.`,
      );
    if (code !== 0)
      throw new Error(
        `Command exited with code ${code ?? 'unknown'}.\n${output}${unboxed ? '' : SEALED_HINT}`,
      );
    return output || 'Command completed with no output.';
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', stop);
    stop();
  }
}

export const HOST_NAMES = new Set(['Read', 'LS', 'Write', 'Edit', 'Bash']);

export function hostComputerTools(input: TurnInput): HostTool[] {
  const file = z.string().min(1).max(4096);
  const read = async (raw: string) => {
    const path = await hostPath(input, raw);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_FILE)
        throw new Error('Choose a regular text file smaller than 1 MB.');
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  };
  const write = async (raw: string, content: string) => {
    const path = await hostPath(input, raw, true);
    input.signal.throwIfAborted();
    // No truncation until the opened descriptor itself has passed the hard-link check.
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink > 1)
        throw new Error('Linked or non-regular files cannot be changed.');
      await handle.truncate(0);
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return `Saved ${raw}.`;
  };
  const digest = (content: string) => createHash('sha256').update(content).digest('hex');
  const contents = async (path: string) => {
    try {
      return await read(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const edited = (content: string, args: Record<string, unknown>) => {
    const old = String(args.old_string);
    if (!content.includes(old) || content.indexOf(old) !== content.lastIndexOf(old))
      throw new Error('The text must match exactly once. Read the file and try again.');
    return content.replace(old, String(args.new_string));
  };
  const mutation = async (
    args: Record<string, unknown>,
    checkpoint: Record<string, string> | undefined,
    edit: boolean,
  ) => {
    const path = String(args.file_path);
    return mutateFile(await hostPath(input, path, true), async () => {
      const before = await contents(path);
      if (checkpoint && (before === undefined ? 'absent' : digest(before)) !== checkpoint.before)
        return {
          text: 'The file changed before this edit. Read its current contents and try again.',
          isError: true,
          effect: 'not-executed' as const,
        };
      const after = edit ? edited(before ?? '', args) : String(args.content);
      if (checkpoint && digest(after) !== checkpoint.after)
        return {
          text: 'The prepared edit no longer matches this file. Read it again.',
          isError: true,
          effect: 'not-executed' as const,
        };
      return write(path, after);
    });
  };
  const tools: HostTool[] = [
    {
      name: 'Read',
      description: 'Read a text file in the work folder (maximum 1 MB).',
      input: { file_path: file },
      run: async (args) => read(String(args.file_path)),
    },
    {
      name: 'LS',
      description: 'List a directory inside the work folder.',
      input: { path: file.default('.') },
      run: async (args) => {
        const path = resolve(input.cwd, String(args.path));
        const root = await realpath(input.cwd);
        const actual = await realpath(path);
        if (!within(root, actual)) throw new Error('That directory is outside the work folder.');
        if ((await forbiddenPlaces(input)).some((p) => within(p, actual)))
          throw new Error(PROTECTED_MESSAGE);
        return (await readdir(actual, { withFileTypes: true }))
          .slice(0, 500)
          .map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`)
          .join('\n');
      },
    },
    {
      name: 'Write',
      description:
        'Create or replace a text file in an existing work-folder directory. Changes are undoable.',
      input: { file_path: file, content: z.string().max(MAX_FILE) },
      run: async (args, context) => mutation(args, context?.checkpoint, false),
    },
    {
      name: 'Edit',
      description: 'Replace one unique exact text match in a work-folder file.',
      input: {
        file_path: file,
        old_string: z.string().min(1).max(MAX_FILE),
        new_string: z.string().max(MAX_FILE),
      },
      run: async (args, context) => mutation(args, context?.checkpoint, true),
    },
    {
      name: 'Bash',
      description: sealable(input)
        ? 'Run a command in the work folder, sealed by the operating system: no network, no secrets, and writes stay in the work folder (not .git). For a command that needs more (the network for git clone or an install, or files elsewhere), set dangerouslyDisableSandbox: true; it then runs with the person’s own access, and they are asked first unless they chose Full trust, where git, installs and work in their other folders run that way by themselves. Never tell the person the session is read-only: ask for what you need.'
        : 'Run a command in the work folder. This computer can’t seal commands, so each one runs with the person’s own access (the network included), and they are asked first unless they chose Full trust.',
      input: {
        command: z.string().min(1).max(32_000),
        timeout_ms: z.number().int().min(100).max(600_000).default(30_000),
        dangerouslyDisableSandbox: z.boolean().optional(),
      },
      run: async (args: Record<string, unknown>) =>
        runHostCommand(input, String(args.command), Number(args.timeout_ms), {
          unsealed: args.dangerouslyDisableSandbox === true,
        }),
    },
  ];
  for (const tool of tools) {
    if (!['Read', 'LS', 'Write', 'Edit'].includes(tool.name)) continue;
    const effect = ['Write', 'Edit'].includes(tool.name) ? 'write' : 'read';
    const observations = new Map<string, string>();
    const originalRun = tool.run;
    tool.run = async (args, context) => {
      if (context) observations.delete(context.operationId);
      const result = await originalRun(args, context);
      if (effect === 'read' && context)
        observations.set(
          context.operationId,
          createHash('sha256')
            .update(typeof result === 'string' ? result : result.text)
            .digest('hex'),
        );
      return result;
    };
    tool.verification = {
      effect,
      ...(effect === 'write'
        ? {
            sequential: true,
            prepare: async (args: Record<string, unknown>) => {
              const before = await contents(String(args.file_path));
              const after =
                tool.name === 'Edit' ? edited(before ?? '', args) : String(args.content);
              return {
                before: before === undefined ? 'absent' : digest(before),
                after: digest(after),
              };
            },
          }
        : {}),
      identity: (args) =>
        `${tool.name}:${resolve(input.cwd, String(args.file_path ?? args.path ?? '.'))}`,
      scope: async (args) => {
        const workspace = await realpath(input.cwd);
        const path =
          tool.name === 'LS'
            ? await realpath(resolve(workspace, String(args.path ?? '.')))
            : await hostPath(input, String(args.file_path), effect === 'write');
        if (!within(workspace, path) && effect === 'write')
          throw new Error('This operation leaves its work folder.');
        return {
          account: `local:${workspace}`,
          authorization: `${effect}:${path}:${input.options.permissionMode}`,
          expiresAt: Date.now() + 10 * 60_000,
        };
      },
      reconcile: async (args, operationId, checkpoint) => {
        if (effect === 'read') {
          const digest = observations.get(operationId);
          observations.delete(operationId);
          return digest
            ? {
                state: 'confirmed',
                receipt: {
                  provider: 'conch-files',
                  id: digest,
                  label: `Read ${String(args.file_path ?? args.path ?? '.')}`,
                },
              }
            : { state: 'absent' };
        }
        try {
          const actual = await read(String(args.file_path));
          if (
            checkpoint
              ? digest(actual) !== checkpoint.after
              : tool.name !== 'Write' || actual !== args.content
          )
            return { state: 'unknown' };
          const proof = digest(actual);
          return {
            state: 'confirmed',
            receipt: {
              provider: 'conch-files',
              id: proof,
              label: `Verified ${String(args.file_path)}`,
            },
          };
        } catch {
          return { state: 'unknown' };
        }
      },
    };
  }
  return tools;
}

/** Same policy before every call, including full-trust modes. */
export async function authorizeTool(
  input: TurnInput,
  name: string,
  args: Record<string, unknown>,
  id: string,
): Promise<string | undefined> {
  input.signal.throwIfAborted();
  if (input.disallowedTools?.includes(name)) return 'The user turned this tool off.';
  // A computer that can't seal commands runs each one outside the box: the guard
  // and the question say so, as they would for a command that asked to leave it.
  const request = {
    toolName: name,
    toolUseId: id,
    input:
      name === 'Bash' && !sealable(input) ? { ...args, dangerouslyDisableSandbox: true } : args,
  };
  const guard = await input.guard?.(request);
  if (guard?.decision === 'deny') return guard.message;
  if (
    HOST_NAMES.has(name) &&
    input.options.permissionMode === 'plan' &&
    !['Read', 'LS'].includes(name)
  )
    return 'Plan mode cannot change files or run commands.';
  const ask =
    guard?.decision === 'ask' ||
    (HOST_NAMES.has(name) &&
      !['Read', 'LS'].includes(name) &&
      input.options.permissionMode !== 'bypassPermissions' &&
      // Auto: the guard above already asked for anything serious (ADR 0100).
      input.options.permissionMode !== 'auto' &&
      !(input.options.permissionMode === 'acceptEdits' && ['Write', 'Edit'].includes(name)));
  if (ask && (await input.requestPermission(request, input.signal)) === 'deny')
    return 'The user declined this action.';
  input.signal.throwIfAborted();
  return undefined;
}
