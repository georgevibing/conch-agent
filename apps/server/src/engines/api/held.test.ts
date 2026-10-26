import { describe, expect, it } from 'vitest';

import type { Callable } from './engine';
import { appOf, holdBack } from './held';

const tool = (wire: string, display = `mcp__conch__${wire}`, app = false): Callable => ({
  spec: {
    name: wire,
    description: `Does ${wire.replace(/_/g, ' ')}.`,
    schema: { type: 'object', properties: {} },
  },
  display,
  ...(app && { app }),
  run: async (args) => ({ text: `${wire} ran with ${JSON.stringify(args)}`, isError: false }),
});

/** `own` of Conch's tools, then each app's, in the order a turn builds them. */
function toolset(own: number, apps: Record<string, string[]>): Map<string, Callable> {
  const all = new Map<string, Callable>();
  for (let i = 0; i < own; i++) all.set(`conch_tool_${i}`, tool(`conch_tool_${i}`));
  for (const [server, names] of Object.entries(apps))
    for (const name of names) {
      const display = `mcp__${server}__${name}`;
      all.set(display, tool(display, display, true));
    }
  return all;
}

const github = ['search_code', 'get_file_contents', 'list_pull_requests', 'create_issue'];
const cloudflare = ['search', 'execute', 'docs'];

describe('holdBack', () => {
  it('sends everything as it is when it fits', () => {
    const all = toolset(3, { github });
    const held = holdBack(all, { max: 10 });
    expect([...held.tools.keys()]).toEqual([...all.keys()]);
    expect(held.held.size).toBe(0);
    expect(held.note).toBe('');
  });

  it('never drops a tool: what does not fit waits behind find_tools', () => {
    const all = toolset(10, { github, cloudflare });
    const held = holdBack(all, { max: 8 });
    expect(held.tools.size).toBeLessThanOrEqual(8);
    expect(held.tools.has('find_tools')).toBe(true);
    const sent = [...held.tools.keys()].filter((k) => k !== 'find_tools');
    expect(new Set([...sent, ...held.held.keys()])).toEqual(new Set(all.keys()));
  });

  it('keeps apps a share of the room when Conch’s own tools would fill it', () => {
    const held = holdBack(toolset(200, { github, cloudflare }), { max: 30 });
    const apps = [...held.tools.values()].filter((t) => t.app);
    expect(apps.length).toBe(github.length + cloudflare.length);
  });

  it('sends the tools of the app the person named first', () => {
    const held = holdBack(toolset(20, { cloudflare, github }), {
      max: 12,
      said: 'Use GitHub to read indiestand-api',
    });
    for (const name of github) expect(held.tools.has(`mcp__github__${name}`)).toBe(true);
  });

  it('says which apps it holds, so the model looks before it gives up', () => {
    const held = holdBack(toolset(200, { github }), { max: 20 });
    expect(held.held.size).toBeGreaterThan(0);
    expect(held.note).toContain('find_tools');
    expect(held.note).toMatch(
      /Never tell the person an app or a tool isn’t available|isn't available/,
    );
  });

  it('loads what find_tools finds into the same list', async () => {
    const held = holdBack(toolset(200, { github }), { max: 20, said: '' });
    const hidden = [...held.held.keys()].find((k) => k.startsWith('mcp__github__'));
    expect(hidden).toBeUndefined();
    const own = [...held.held.keys()][0] ?? '';
    const find = held.tools.get('find_tools');
    const found = await find?.run({ query: own.replace(/_/g, ' ') }, 'f1');
    expect(found?.text).toContain('Loaded');
    expect(held.tools.has(own)).toBe(true);
  });

  it('keeps a stable list and runs held-back tools through use_tool', async () => {
    const all = toolset(200, { github });
    const first = holdBack(all, { max: 20, stable: true, said: 'github' });
    const again = holdBack(all, { max: 20, stable: true, said: 'something else' });
    expect([...first.tools.keys()]).toEqual([...again.tools.keys()]);
    expect(first.tools.has('use_tool')).toBe(true);

    const hidden = [...first.held.keys()][0] ?? '';
    const found = await first.tools
      .get('find_tools')
      ?.run({ query: hidden.replace(/_/g, ' ') }, 'f');
    expect(found?.text).toContain('use_tool');
    expect(first.tools.has(hidden)).toBe(false);

    const call = first.resolve('use_tool', { name: hidden, arguments: { a: 1 } });
    expect(call?.tool.display).toBe(all.get(hidden)?.display);
    expect(call?.args).toEqual({ a: 1 });
    const result = await call?.tool.run(call.args, 'u1');
    expect(result?.text).toBe(`${hidden} ran with {"a":1}`);
  });

  it('answers a use_tool call for a name it doesn’t know with how to find one', async () => {
    const held = holdBack(toolset(200, {}), { max: 20, stable: true });
    const call = held.resolve('use_tool', { name: 'nope' });
    const result = await call?.tool.run(call.args, 'u2');
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain('find_tools');
  });
});

describe('appOf', () => {
  it('reads the app from a tool’s shown name', () => {
    expect(appOf('mcp__github__get_file')).toBe('github');
    expect(appOf('mcp__github-2__get_file')).toBe('github-2');
    expect(appOf('mcp__conch__remember')).toBeUndefined();
    expect(appOf('Bash')).toBeUndefined();
  });
});
