import { NacreProvider } from '@conch/nacre';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentViewer, type Viewable } from './AttachmentViewer';

function show(item: Viewable) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NacreProvider scope="local">
        <AttachmentViewer items={[item]} index={0} onIndexChange={() => {}} />
      </NacreProvider>
    </QueryClientProvider>,
  );
}

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('AttachmentViewer', () => {
  it('shows what the readers made of a workbook, asked for by its id', async () => {
    const fetch = answer({
      view: {
        summary: 'A workbook of 1 sheet.',
        parts: [{ kind: 'table', title: 'Team', columns: ['A'], rows: [['Ada']] }],
      },
    });
    vi.stubGlobal('fetch', fetch);
    show({ id: 'att_1', info: { name: 'team.xlsx', kind: 'file', size: 10 } });
    expect(await screen.findByRole('cell', { name: 'Ada' })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/attachments/att_1/view', expect.anything());
  });

  it('says what a file is when nothing reads it, and when the view fails', async () => {
    vi.stubGlobal('fetch', answer({ view: null }));
    const first = show({ id: 'att_2', info: { name: 'Bracket.stl', kind: 'file' } });
    expect(await screen.findByText(/no preview for this kind of file/)).toBeVisible();
    expect(screen.getByText('3D model')).toBeVisible();
    first.unmount();
    vi.stubGlobal('fetch', answer({ error: 'not-found' }, 404));
    show({ id: 'att_3', info: { name: 'Setup.exe', kind: 'file' } });
    expect(await screen.findByText(/no preview for this kind of file/)).toBeVisible();
  });

  it('never asks for a view of what the browser shows itself', () => {
    const fetch = answer({ view: null });
    vi.stubGlobal('fetch', fetch);
    show({ id: 'att_4', info: { name: 'a.png', kind: 'image' } });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/view'), expect.anything());
  });
});
