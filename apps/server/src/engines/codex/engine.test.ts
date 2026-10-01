import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProviderKeys } from '../../providers/keys';
import { SettingsStore } from '../../settings/store';
import type { EngineEvent, EngineMcpServer, TurnInput } from '../types';
import {
  CodexEngine,
  configKey,
  mcpOverrides,
  parseMcpList,
  parseModels,
  promptFor,
  sandboxFor,
  sealedNotice,
  sealFor,
  turnArgs,
} from './engine';
import { fakeCodex, type FakeCodex } from '../../test/fakeCodex';

const TRANSCRIPT = [
  '{"type":"thread.started","thread_id":"thread-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"a1","type":"agent_message","text":"All done."}}',
  '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":7}}',
  '',
].join('\n');

const originalHome = process.env.CODEX_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalHome;
});

async function engineFor(codex: FakeCodex): Promise<CodexEngine> {
  process.env.CODEX_HOME = codex.home;
  const settings = new SettingsStore(await mkdtemp(join(tmpdir(), 'conch-home-')));
  return new CodexEngine(settings, new ProviderKeys(settings), codex.bin);
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: 'Fix the bug',
    systemAppend: '',
    cwd: process.cwd(),
    tools: [],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('Codex turns', () => {
  it('streams a turn and ends with one result', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', transcript: TRANSCRIPT });
    const engine = await engineFor(codex);
    const events = await collect(engine.runTurn(turn({ systemAppend: 'You are Pearl.' })));

    expect(events).toEqual([
      { type: 'notice', code: 'sandbox', message: expect.stringContaining('only read') },
      { type: 'session', resumeId: 'thread-1' },
      { type: 'text', messageId: 'a1', delta: 'All done.' },
      { type: 'message-done', messageId: 'a1' },
      { type: 'done', outcome: 'success', usage: { inputTokens: 100, outputTokens: 7 } },
    ]);

    const exec = (await codex.calls()).find((call) => call[0] === 'exec');
    expect(exec?.slice(0, 5)).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'sandbox_mode="read-only"',
    ]);
    // Conch's briefing rides at the top of the prompt, which comes last.
    expect(exec?.at(-1)).toBe(
      '<conch-instructions>\nYou are Pearl.\n</conch-instructions>\n\nFix the bug',
    );
  });

  it('resumes a thread without repeating the sandbox notice', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', transcript: TRANSCRIPT });
    const engine = await engineFor(codex);
    const events = await collect(
      engine.runTurn(
        turn({
          resumeId: 'thread-1',
          systemAppend: 'You are Pearl.',
          options: { effort: 'high', fastMode: false, permissionMode: 'acceptEdits' },
          model: undefined,
        } as Partial<TurnInput>),
      ),
    );
    expect(events.some((event) => event.type === 'notice')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });

    const exec = (await codex.calls()).find((call) => call[0] === 'exec');
    expect(exec?.slice(0, 3)).toEqual(['exec', 'resume', 'thread-1']);
    // `exec resume` takes no --sandbox, so the mode travels as config — every
    // turn, or a resumed thread would fall back to whatever config.toml says.
    expect(exec).toContain('sandbox_mode="workspace-write"');
    expect(exec).toContain('model_reasoning_effort="high"');
    // This process hasn't briefed the thread yet, so it says who it is once.
    expect(exec?.at(-1)).toContain('You are Pearl.');
  });

  it('passes the chosen model and never a key on the command line', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', transcript: TRANSCRIPT });
    const engine = await engineFor(codex);
    await collect(
      engine.runTurn(
        turn({
          options: {
            model: 'gpt-5.3-codex',
            effort: 'auto',
            fastMode: false,
            permissionMode: 'bypassPermissions',
          },
        }),
      ),
    );
    const exec = (await codex.calls()).find((call) => call[0] === 'exec') ?? [];
    expect(exec).toContain('-m');
    expect(exec).toContain('gpt-5.3-codex');
    expect(exec).toContain('sandbox_mode="danger-full-access"');
    expect(exec.some((arg) => arg.includes('model_reasoning_effort'))).toBe(false);
  });

  it('carries an integration’s token in the environment, never in the arguments', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', transcript: TRANSCRIPT });
    const engine = await engineFor(codex);
    await collect(
      engine.runTurn(
        turn({
          mcpServers: {
            notion: {
              type: 'http',
              url: 'https://mcp.notion.com/mcp',
              headers: { Authorization: 'Bearer secret-token-xyz' },
            },
          },
          disallowedTools: ['mcp__notion__delete_page'],
        }),
      ),
    );
    const exec = (await codex.calls()).find((call) => call[0] === 'exec') ?? [];
    expect(exec).toContain('mcp_servers.notion.url="https://mcp.notion.com/mcp"');
    expect(exec).toContain('mcp_servers.notion.bearer_token_env_var="CODEX_MCP_TOKEN_NOTION"');
    expect(exec).toContain('mcp_servers.notion.disabled_tools=["delete_page"]');
    expect(exec.join(' ')).not.toContain('secret-token-xyz');
    expect(await codex.env()).toContain('CODEX_MCP_TOKEN_NOTION=secret-token-xyz');
  });

  it('says which integrations it had to leave out', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', transcript: TRANSCRIPT });
    const engine = await engineFor(codex);
    const events = await collect(
      engine.runTurn(
        turn({
          mcpServers: {
            github: {
              type: 'http',
              url: 'https://api.githubcopilot.com/mcp/',
              headers: { 'X-Api-Key': 'plain-secret' },
            },
          },
        }),
      ),
    );
    expect(events[0]).toEqual({
      type: 'mcp-status',
      failed: [{ name: 'github', error: expect.stringContaining('visible to other programs') }],
    });
    const exec = (await codex.calls()).find((call) => call[0] === 'exec') ?? [];
    expect(exec.join(' ')).not.toContain('plain-secret');
    expect(exec.join(' ')).not.toContain('mcp_servers.github');
  });

  it('stops the child and reports an interrupted turn', async () => {
    const codex = await fakeCodex({
      signedIn: true,
      authMode: 'chatgpt',
      transcript: '{"type":"thread.started","thread_id":"thread-2"}\n',
      hangSeconds: 5,
    });
    const engine = await engineFor(codex);
    const abort = new AbortController();
    const events: EngineEvent[] = [];
    for await (const event of engine.runTurn(turn({ signal: abort.signal }))) {
      events.push(event);
      if (event.type === 'session') abort.abort();
    }
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'interrupted' });
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  });

  it('explains a crash with what Codex printed', async () => {
    const codex = await fakeCodex({
      signedIn: true,
      authMode: 'chatgpt',
      transcript: '{"type":"thread.started","thread_id":"thread-3"}\n',
      execStderr: 'error: stream disconnected before completion',
      execCode: 3,
    });
    const engine = await engineFor(codex);
    const events = await collect(engine.runTurn(turn()));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'done', outcome: 'error' });
    expect(last?.type === 'done' && last.error).toContain('exit code 3');
    expect(last?.type === 'done' && last.error).toContain('stream disconnected');
  });

  it('refuses to start a turn when Codex isn’t ready', async () => {
    const codex = await fakeCodex({ signedIn: false });
    const engine = await engineFor(codex);
    const events = await collect(engine.runTurn(turn()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'done', outcome: 'error' });
  });
});

describe('Codex capabilities', () => {
  it('reads the model catalogue and offers only the modes Codex honours', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt' });
    const engine = await engineFor(codex);
    const capabilities = await engine.capabilities();
    expect(capabilities.permissionModes).toEqual(['plan', 'acceptEdits', 'bypassPermissions']);
    expect(capabilities.commands).toEqual([]);
    expect(capabilities.models[0]).toEqual({
      id: 'gpt-5.3-codex',
      label: 'GPT-5.3 Codex',
      description: 'Best for hard problems.',
      // `ultra` is a Codex level Conch has no word for, so it's dropped.
      efforts: ['low', 'medium', 'high', 'xhigh'],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
  });

  it('offers no models at all rather than guessed ones', async () => {
    const codex = await fakeCodex({ signedIn: true, authMode: 'chatgpt', models: 'not json' });
    const engine = await engineFor(codex);
    expect((await engine.capabilities()).models).toEqual([]);
  });

  it('lists Codex’s own MCP servers, and nothing when it can’t', async () => {
    const codex = await fakeCodex({
      signedIn: true,
      authMode: 'chatgpt',
      mcpList: '{"docs":{"url":"https://example.test/mcp","enabled":true},"old":{"enabled":false}}',
    });
    const engine = await engineFor(codex);
    expect(await engine.mcpStatus()).toEqual([
      {
        name: 'docs',
        status: 'connected',
        source: 'engine',
        toolCount: 0,
        url: 'https://example.test/mcp',
      },
      { name: 'old', status: 'disabled', source: 'engine', toolCount: 0, url: undefined },
    ]);

    const older = await fakeCodex({ signedIn: true, authMode: 'chatgpt', mcpJsonFails: true });
    expect(await (await engineFor(older)).mcpStatus()).toEqual([]);
  });
});

describe('Codex arguments', () => {
  it('maps every permission mode to the safer sandbox', () => {
    expect(sandboxFor('plan')).toBe('read-only');
    expect(sandboxFor('default')).toBe('read-only');
    // Codex can't judge risk either: a mode it doesn't offer never becomes a licence to write.
    expect(sandboxFor('auto')).toBe('read-only');
    expect(sandboxFor('acceptEdits')).toBe('workspace-write');
    expect(sandboxFor('bypassPermissions')).toBe('danger-full-access');
  });

  it('keeps a prompt that looks like an option out of the options', () => {
    const args = turnArgs({ prompt: '--help me', sandbox: 'read-only' });
    expect(args.slice(-2)).toEqual(['--', '--help me']);
    expect(turnArgs({ prompt: 'hello', sandbox: 'read-only' }).at(-1)).toBe('hello');
  });

  it('sends a long prompt (a big paste) on stdin, never as one huge argument', () => {
    const long = 'x'.repeat(200_000);
    const args = turnArgs({ prompt: long, sandbox: 'read-only', resumeId: 'thread-1' });
    expect(args.at(-1)).toBe('-');
    expect(args.some((arg) => arg.length > 1000)).toBe(false);
  });

  it('sends the briefing once, and again only when it changes', () => {
    expect(promptFor({ prompt: 'hi', systemAppend: '  ', resumeId: undefined })).toBe('hi');
    // A new thread always gets it.
    expect(promptFor({ prompt: 'hi', systemAppend: 'Be kind.', resumeId: undefined })).toContain(
      '<conch-instructions>',
    );
    // A resumed thread that already has this briefing doesn't get it twice.
    expect(promptFor({ prompt: 'hi', systemAppend: 'Be kind.', resumeId: 't1' }, 'Be kind.')).toBe(
      'hi',
    );
    // A memory saved, or an integration broken, changes it: say so.
    expect(
      promptFor(
        { prompt: 'hi', systemAppend: 'Be kind. Ada likes tea.', resumeId: 't1' },
        'Be kind.',
      ),
    ).toContain('<conch-instructions updated="true">');
  });
});

describe('Codex sealed (ADR 0031)', () => {
  const seal = { allowWrite: ['/work', '/Users/me/.npm'], denyRead: ['/Users/me/.ssh'] };

  it('unsealed: as before; a chat that read something untrusted runs in the work folder', () => {
    expect(sealFor('danger-full-access', undefined, false)).toEqual({
      sandbox: 'danger-full-access',
      overrides: [],
      sealed: false,
    });
    expect(sealFor('danger-full-access', undefined, true).sandbox).toBe('workspace-write');
  });

  it('Full trust under a seal is the work folder, the caches and the network — never keys', () => {
    const { sandbox, overrides } = sealFor('danger-full-access', seal, false);
    expect(sandbox).toBe('workspace-write');
    expect(overrides).toEqual([
      'sandbox_workspace_write.writable_roots=["/work","/Users/me/.npm"]',
      'sandbox_workspace_write.network_access=true',
      'default_permissions="conch"',
      'permissions.conch.extends=":workspace"',
      'permissions.conch.filesystem={"/work"="write","/Users/me/.npm"="write","/Users/me/.ssh"="deny"}',
      'permissions.conch.network={enabled=true}',
    ]);
  });

  it('tainted: no network; read-only stays read-only, still denied keys', () => {
    expect(sealFor('danger-full-access', seal, true).overrides).toContain(
      'permissions.conch.network={enabled=false}',
    );
    const readOnly = sealFor('read-only', seal, false);
    expect(readOnly.sandbox).toBe('read-only');
    expect(readOnly.overrides).toEqual([
      'default_permissions="conch"',
      'permissions.conch.extends=":read-only"',
      'permissions.conch.filesystem={"/Users/me/.ssh"="deny"}',
      'permissions.conch.network={enabled=false}',
    ]);
  });

  it('an older Codex gets only what it reads, and the notice doesn’t claim keys are safe', () => {
    const old = sealFor('danger-full-access', seal, false, false);
    expect(old.overrides.some((o) => o.startsWith('permissions.'))).toBe(false);
    expect(old.overrides).toContain('sandbox_workspace_write.network_access=true');
    expect(sealedNotice('workspace-write', true, false)).toMatch(
      /can still read where your keys live/,
    );
    expect(sealedNotice('workspace-write', true)).toMatch(
      /can’t read where your keys and passwords live/,
    );
  });

  it('a path that would break out of its TOML string stays inside it', () => {
    const tricky = sealFor('workspace-write', { allowWrite: ['/w/"]x'], denyRead: [] }, false);
    expect(tricky.overrides[0]).toBe('sandbox_workspace_write.writable_roots=["/w/\\"]x"]');
  });
});

describe('Codex integration overrides', () => {
  const http = (url: string, headers?: Record<string, string>): EngineMcpServer => ({
    type: 'http',
    url,
    ...(headers && { headers }),
  });

  it('keeps every secret in the environment', () => {
    const { args, env, skipped } = mcpOverrides({
      Linear: http('https://mcp.linear.app/mcp', { authorization: 'Bearer lin_oauth_123' }),
    });
    expect(skipped).toEqual([]);
    expect(args.filter((arg) => arg !== '-c')).toEqual([
      'mcp_servers.linear.url="https://mcp.linear.app/mcp"',
      'mcp_servers.linear.bearer_token_env_var="CODEX_MCP_TOKEN_LINEAR"',
    ]);
    expect(env).toEqual({ CODEX_MCP_TOKEN_LINEAR: 'lin_oauth_123' });
    expect(args.join(' ')).not.toContain('lin_oauth_123');
  });

  it('passes a program and its environment by name', () => {
    const { args, env, skipped } = mcpOverrides(
      {
        'home-assistant': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'hass-mcp'],
          env: { HASS_TOKEN: 'super-secret', HASS_URL: 'http://homeassistant.local:8123' },
        },
      },
      ['mcp__home-assistant__call_service', 'mcp__other__thing'],
    );
    expect(skipped).toEqual([]);
    expect(args.filter((arg) => arg !== '-c')).toEqual([
      'mcp_servers.home_assistant.command="npx"',
      'mcp_servers.home_assistant.args=["-y","hass-mcp"]',
      'mcp_servers.home_assistant.env_vars=["HASS_TOKEN","HASS_URL"]',
      'mcp_servers.home_assistant.disabled_tools=["call_service"]',
    ]);
    expect(env.HASS_TOKEN).toBe('super-secret');
    expect(args.join(' ')).not.toContain('super-secret');
  });

  it('skips what it can’t carry safely, and says so in plain words', () => {
    const { args, env, skipped } = mcpOverrides({
      extra: http('https://example.test/mcp', { 'X-Secret': 'nope' }),
      basic: http('https://example.test/mcp', { Authorization: 'Basic abc123' }),
      newline: http('https://example.test/mcp', { Authorization: 'Bearer a\nb' }),
      'not-a-url': http('file:///etc/passwd'),
      hijack: {
        type: 'stdio',
        command: 'node',
        args: [],
        env: { NODE_OPTIONS: '--require /tmp/evil.js' },
      },
      empty: { type: 'stdio', command: '  ', args: [] },
    });
    expect(args).toEqual([]);
    expect(env).toEqual({});
    expect(skipped.map((s) => s.name)).toEqual([
      'extra',
      'basic',
      'newline',
      'not-a-url',
      'hijack',
      'empty',
    ]);
    expect(skipped[0]?.error).toContain('visible to other programs');
    expect(skipped[2]?.error).toContain('characters Conch won’t pass on');
    expect(skipped[3]?.error).toContain('web address');
    expect(skipped[4]?.error).toContain('name Conch won’t pass to a program');
  });

  it('never lets two integrations share one config key or one variable', () => {
    const { args, env, skipped } = mcpOverrides({
      'my server': http('https://one.test/mcp', { Authorization: 'Bearer one' }),
      'my.server': http('https://two.test/mcp', { Authorization: 'Bearer two' }),
    });
    expect(skipped).toEqual([]);
    expect(args).toContain(
      'mcp_servers.my_server.bearer_token_env_var="CODEX_MCP_TOKEN_MY_SERVER"',
    );
    expect(args).toContain(
      'mcp_servers.my_server_2.bearer_token_env_var="CODEX_MCP_TOKEN_MY_SERVER_2"',
    );
    expect(env).toEqual({
      CODEX_MCP_TOKEN_MY_SERVER: 'one',
      CODEX_MCP_TOKEN_MY_SERVER_2: 'two',
    });

    const clash = mcpOverrides({
      first: { type: 'stdio', command: 'a', args: [], env: { TOKEN: 'one' } },
      second: { type: 'stdio', command: 'b', args: [], env: { TOKEN: 'two' } },
    });
    expect(clash.skipped.map((s) => s.name)).toEqual(['second']);
    expect(clash.env).toEqual({ TOKEN: 'one' });
  });

  it('reduces a name to something a config key can hold', () => {
    expect(configKey('Home Assistant')).toBe('home_assistant');
    expect(configKey('../../etc/passwd')).toBe('etc_passwd');
    expect(configKey('!!!')).toBe('server');
  });
});

describe('Codex output parsing', () => {
  it('finds models in a list, in a wrapper, or by id', () => {
    expect(parseModels('[{"id":"a","name":"A"}]')[0]).toMatchObject({ id: 'a', label: 'A' });
    expect(parseModels('banner\n{"data":[{"slug":"b"}]}\n')[0]?.id).toBe('b');
    expect(parseModels('{"gpt-x":{"description":"hi"}}')[0]).toMatchObject({
      id: 'gpt-x',
      label: 'gpt-x',
      description: 'hi',
    });
    expect(parseModels('{"id":"c"}\n{"id":"d"}')).toHaveLength(2);
    expect(parseModels('Name    Reasoning\ngpt-x   high')).toEqual([]);
    expect(parseModels('')).toEqual([]);
  });

  it('never throws on Codex’s MCP list', () => {
    expect(parseMcpList('[{"name":"docs","tools":[1,2]}]')).toEqual([
      { name: 'docs', status: 'connected', source: 'engine', toolCount: 2, url: undefined },
    ]);
    expect(parseMcpList('NAME  COMMAND\ndocs  npx')).toEqual([]);
    expect(parseMcpList('')).toEqual([]);
  });
});
