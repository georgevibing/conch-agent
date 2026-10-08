import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';
import { drawnAsFile, fileAsked, isFileTool } from './FileToolItem';

afterEach(() => vi.unstubAllGlobals());

let chat = 'f0';

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: chat, seq, at: 1000 + seq * 1000, ...event },
  } as never);
}

const report = {
  id: 'att_r1',
  name: 'Q3 report.pdf',
  mimeType: 'application/pdf',
  size: 248_000,
  kind: 'file',
  pages: 3,
  preview: 'att_p1',
  createdAt: 5000,
};

async function open(
  name = 'mcp__conch__file_make',
  input: unknown = { format: 'pdf', name: 'Q3 report' },
) {
  chat = `f${Number(chat.slice(1)) + 1}`;
  mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
  });
  renderApp(<ChatView conversationId={chat} />, { route: `/c/${chat}` });
  await screen.findByRole('textbox', { name: 'Message Conch' });
  act(() => {
    push(0, { type: 'user.message', messageId: 'u1', text: 'Make me a report' });
    push(1, { type: 'tool.started', toolUseId: 't1', name, input });
  });
}

describe('a file tool in the chat', () => {
  it('takes the file’s shape while it’s made, then is the file’s card, with no raw call', async () => {
    await open();
    expect(screen.getByRole('figure', { name: 'Q3 report.pdf' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    act(() =>
      push(2, {
        type: 'tool.progress',
        toolName: 'file_make',
        stage: 'generating',
        progress: 0.5,
        detail: 'Laying out pages',
        by: 'Chromium',
      }),
    );
    const bar = screen.getByRole('progressbar', { name: 'Making Q3 report.pdf' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', '50%, Laying out pages');
    // A word without a step keeps the last one.
    act(() =>
      push(3, { type: 'tool.progress', toolName: 'file_make', stage: 'generating', progress: 0.6 }),
    );
    expect(screen.getByText('Laying out pages')).toBeInTheDocument();
    // Drawn as its file, never as a story line.
    expect(screen.queryByText('Making Q3 report.pdf')).toBeNull();

    act(() =>
      push(4, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        durationMs: 1200,
        output: JSON.stringify({
          ...report,
          path: '/Users/someone/.conch/attachments/r1.pdf',
          by: 'Chromium',
        }),
        view: { kind: 'downloads', items: [report] },
      }),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    const card = screen.getByRole('figure', { name: 'Q3 report.pdf' });
    expect(within(card).getByText('PDF · 3 pages · 242 KB')).toBeInTheDocument();
    // Its first page, from the picture the gateway made of it.
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/attachments/att_p1');
    expect(within(card).getByRole('link', { name: 'Download Q3 report.pdf' })).toHaveAttribute(
      'href',
      '/api/attachments/att_r1?download=1',
    );
    await userEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Chromium')).toBeVisible();
    expect(screen.getByText('1.2s')).toBeVisible();
    expect(screen.queryByText(/\/Users\/someone/)).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Look closer' }));
    expect(await screen.findByRole('dialog', { name: 'Q3 report.pdf' })).toBeInTheDocument();
  });

  it('draws a file offered with publish_file as the same card', async () => {
    await open('mcp__conch__publish_file', { file_path: '/w/out/Budget.xlsx' });
    const budget = {
      ...report,
      id: 'att_b1',
      name: 'Budget.xlsx',
      mimeType: 'application/octet-stream',
      pages: undefined,
      preview: undefined,
      sheets: 2,
      size: 18_400,
    };
    act(() =>
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{}',
        view: { kind: 'downloads', items: [budget] },
      }),
    );
    const card = screen.getByRole('figure', { name: 'Budget.xlsx' });
    expect(within(card).getByText('XLSX · 2 sheets · 18 KB')).toBeInTheDocument();
  });

  it('says why it couldn’t be made, calmly', async () => {
    await open();
    act(() =>
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'error',
        output: 'Error: Chromium closed before the PDF was saved.',
      }),
    );
    expect(
      screen.getByText('Couldn’t make it: Chromium closed before the PDF was saved.'),
    ).toBeInTheDocument();
  });

  it('draws a file someone sent as a small card with the same words', async () => {
    chat = `f${Number(chat.slice(1)) + 1}`;
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView conversationId={chat} />, { route: `/c/${chat}` });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() =>
      push(0, {
        type: 'user.message',
        messageId: 'u1',
        text: 'Have a look',
        attachments: [report],
      }),
    );
    const list = screen.getByRole('list', { name: 'Attached' });
    expect(
      within(list).getByRole('button', { name: 'Q3 report.pdf, PDF · 3 pages · 242 KB' }),
    ).toBeInTheDocument();
  });
});

describe('file tool words', () => {
  it('knows the tools and what they’ll make', () => {
    expect(isFileTool('mcp__conch__file_make')).toBe(true);
    expect(isFileTool('file_unzip')).toBe(true);
    expect(isFileTool('publish_file')).toBe(true);
    expect(isFileTool('list_attachments')).toBe(false);
    expect(fileAsked('file_make', { name: 'Q3 report', format: 'pdf' })).toEqual({
      name: 'Q3 report.pdf',
      doing: 'Making it',
    });
    expect(fileAsked('file_convert', { source: '/w/Proposal.docx', to: 'pdf' }).name).toBe(
      'Proposal.pdf',
    );
    expect(fileAsked('file_combine', { sources: [], to: 'zip', name: 'All' })).toEqual({
      name: 'All.zip',
      doing: 'Packing',
    });
    expect(fileAsked('file_unzip', { source: 'att_x' }).name).toBe('An archive');
    const tool = {
      kind: 'tool' as const,
      id: 't',
      name: 'file_make',
      input: {},
      startedAt: 0,
    };
    expect(drawnAsFile({ ...tool, status: 'running' })).toBe(true);
    expect(drawnAsFile({ ...tool, status: 'success', output: '{}' })).toBe(false);
  });
});
