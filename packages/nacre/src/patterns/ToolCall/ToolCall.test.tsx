import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { formatDuration, parseToolName, ToolCall } from './ToolCall';

describe('ToolCall', () => {
  it('expands and collapses to reveal input and output', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <ToolCall
        name="Bash"
        summary="pnpm test"
        status="success"
        duration={2140}
        input='{"command":"pnpm test"}'
        output="18 passed"
      />,
    );
    const trigger = screen.getByRole('button', { name: /Bash.*pnpm test.*Completed/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('18 passed')).toBeNull();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('18 passed');
    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument();
    await expectAccessible(container);
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('is a static row when there is nothing to expand', () => {
    renderNacre(<ToolCall name="Read" summary="a.ts" status="running" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });

  it('a call that was declined is neutral and says why, in place of its time', async () => {
    const { container } = renderNacre(
      <ToolCall
        name="Bash"
        summary="curl x"
        status="declined"
        outcome="You said no"
        duration={30}
        output="The user declined this action."
      />,
    );
    const root = container.querySelector('[data-status="declined"]');
    expect(root).not.toBeNull();
    expect(screen.getByRole('button', { name: /Bash.*curl x.*You said no/ })).toBeInTheDocument();
    expect(screen.queryByText('30ms')).toBeNull();
    await expectAccessible(container);
  });

  it('keeps a quiet note about the answer in its details', async () => {
    const user = userEvent.setup();
    renderNacre(
      <ToolCall name="Bash" summary="git push" status="success" note="You allowed this" />,
    );
    await user.click(screen.getByRole('button', { name: /git push/ }));
    expect(screen.getByText('You allowed this')).toBeInTheDocument();
  });

  it('labels errors and supports controlled open state', () => {
    renderNacre(<ToolCall name="Bash" status="error" output="boom" open />);
    expect(screen.getByRole('region', { name: 'Error' })).toHaveTextContent('boom');
  });

  it('prettifies MCP tool names', () => {
    renderNacre(<ToolCall name="mcp__github__create_pull_request" />);
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('create pull request')).toBeInTheDocument();
    expect(parseToolName('Bash')).toEqual({ tool: 'Bash' });
  });

  it('splits the first nonempty MCP server and tool, and keeps malformed names intact', () => {
    expect(parseToolName('mcp__my_server__read_file')).toEqual({
      server: 'my_server',
      tool: 'read file',
    });
    expect(parseToolName('mcp_____read')).toEqual({ server: '_', tool: 'read' });
    expect(parseToolName('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b  c' });
    for (const name of ['mcp____read', 'mcp__server__', 'mcp__server', 'mcp__a__b\n']) {
      expect(parseToolName(name)).toEqual({ tool: name });
    }
  });

  it('does not retry every separator in a long malformed MCP name', () => {
    const name = `mcp__a__${'a__a'.repeat(30_000)}\nb`;
    const began = Date.now();
    expect(parseToolName(name)).toEqual({ tool: name });
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it('formats durations', () => {
    expect(formatDuration(42)).toBe('42ms');
    expect(formatDuration(2140)).toBe('2.1s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('draws what the tool found under the row, open, with the raw output still behind the disclosure', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <ToolCall
        name="Find files"
        status="success"
        output='{"files":[]}'
        view={<section aria-label="Files, 1 file">Q4 launch deck</section>}
      />,
    );
    expect(screen.getByRole('region', { name: 'Files, 1 file' })).toHaveTextContent(
      'Q4 launch deck',
    );
    expect(container.querySelector('[data-status]')).toHaveAttribute('data-view');
    expect(screen.queryByRole('region', { name: 'Output' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Find files/ }));
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('{"files":[]}');
    expect(screen.getByRole('region', { name: 'Files, 1 file' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
