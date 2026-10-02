import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ArtifactCard } from './ArtifactCard';
import { ArtifactEditor } from './ArtifactEditor';
import { ArtifactPanel } from './ArtifactPanel';
import { LiveDataAsk, LiveDataBar, LiveDataList } from './LiveData';
import { SealedFrame } from './SealedFrame';

const message = (source: unknown, data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  });

describe('SealedFrame: live data (ADR 0046)', () => {
  it('passes a declared source on only from its own frame, and answers only it', async () => {
    const onData = vi.fn(async () => ({ ok: true, status: 200, body: '{"t":21}', at: 1 }));
    renderNacre(<SealedFrame src="/frame" title="Weather" onData={onData} />);
    const frame = screen.getByTitle('Weather') as HTMLIFrameElement;
    const win = frame.contentWindow as Window;
    const post = vi.spyOn(win, 'postMessage');
    const ask = {
      conch: 'artifact',
      data: { id: 'd1', source: 'weather', params: { city: 'berlin' } },
    };

    // From anywhere else — this page, another window, nowhere — nothing is asked.
    message(window, ask);
    message(null, ask);
    message({}, ask);
    expect(onData).not.toHaveBeenCalled();

    // From its own frame: asked, and the answer goes back to it alone.
    message(win, ask);
    expect(onData).toHaveBeenCalledWith({ source: 'weather', params: { city: 'berlin' } });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          conch: 'artifact-data',
          id: 'd1',
          result: { ok: true, status: 200, body: '{"t":21}', at: 1 },
        },
        '*',
      ),
    );
  });

  it('refuses requests that aren’t a name and short values', () => {
    const onData = vi.fn(async () => ({}));
    renderNacre(<SealedFrame src="/frame" title="Weather" onData={onData} />);
    const win = (screen.getByTitle('Weather') as HTMLIFrameElement).contentWindow;
    for (const data of [
      { id: 'd1', source: 'https://evil.example' },
      { id: 'd2', source: 'weather', params: { q: 'x'.repeat(65) } },
      { id: 'd3', source: 'weather', params: { q: { nested: true } } },
      { id: 'd4', source: 'weather', params: ['a'] },
      { id: 'x'.repeat(33), source: 'weather' },
      { source: 'weather' },
    ])
      message(win, { conch: 'artifact', data });
    message(win, { data: { id: 'd5', source: 'weather' } });
    expect(onData).not.toHaveBeenCalled();
  });

  it('never answers a page that loaded again (one that tried to leave)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const onData = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    renderNacre(<SealedFrame src="/frame" title="Weather" onData={onData} />);
    const frame = screen.getByTitle('Weather') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.load(frame);
    message(frame.contentWindow, { conch: 'artifact', data: { id: 'd1', source: 'weather' } });
    fireEvent.load(frame);
    await act(async () => answer({ ok: true }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Conch stopped this page')).toBeInTheDocument();
  });

  it('tells the page to read again when asked', () => {
    const { rerender } = renderNacre(
      <SealedFrame src="/frame" title="Weather" onData={async () => ({})} refresh={0} />,
    );
    const post = vi.spyOn(
      (screen.getByTitle('Weather') as HTMLIFrameElement).contentWindow as Window,
      'postMessage',
    );
    rerender(<SealedFrame src="/frame" title="Weather" onData={async () => ({})} refresh={1} />);
    expect(post).toHaveBeenCalledWith({ conch: 'artifact-data', refresh: true }, '*');
  });
});

describe('ArtifactEditor', () => {
  const editor = (over: Partial<Parameters<typeof ArtifactEditor>[0]> = {}) => (
    <ArtifactEditor
      kind="table"
      title="Budget"
      value={'Item,Cost\nRent,1200'}
      onChange={() => undefined}
      preview={<p>The table</p>}
      dirty={false}
      onSave={() => undefined}
      onCancel={() => undefined}
      layout="switch"
      {...over}
    />
  );

  it('saves only a change that has no problem, and says why not in words', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = renderNacre(editor({ onSave }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByText('No changes yet')).toBeInTheDocument();
    rerender(
      editor({ onSave, dirty: true, problem: 'Line 2 has 3 values, but the header has 2.' }),
    );
    expect(save).toBeDisabled();
    expect(screen.getByText('Line 2 has 3 values, but the header has 2.')).toBeInTheDocument();
    expect(screen.getByText('Can’t save yet')).toBeInTheDocument();
    rerender(editor({ onSave, dirty: true }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull());
    expect(container.querySelector('.cm-content')).toHaveAttribute('aria-label', 'Code of Budget');
    await expectAccessible(container);
  });

  it('on a narrow screen, switches between the code and the preview', async () => {
    const user = userEvent.setup();
    renderNacre(editor());
    expect(screen.getByText('The table')).not.toBeVisible();
    expect(screen.queryByRole('region', { name: 'Preview of Budget' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Preview' }));
    expect(screen.getByRole('region', { name: 'Preview of Budget' })).toBeVisible();
    expect(screen.getByText('The table')).toBeVisible();
  });

  it('beside a wide panel, both at once', () => {
    renderNacre(editor({ layout: 'split' }));
    expect(screen.queryByRole('radio', { name: 'Preview' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Preview of Budget' })).toBeVisible();
  });

  it('the panel puts its own actions away while editing; the card says it’s yours', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    const panel = (editing?: boolean) => (
      <ArtifactPanel
        title="Budget"
        kind="table"
        versions={[
          { n: 1, when: 'Today, 9:41 AM' },
          { n: 2, when: 'Today, 9:45 AM', edited: true, note: 'Edited by you' },
        ]}
        version={2}
        preview={<p>Table</p>}
        source="a,b"
        downloadHref="/d"
        onPinnedChange={() => undefined}
        onEdit={onEdit}
        editing={editing ? editor() : undefined}
      />
    );
    const { rerender } = renderNacre(panel());
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
    rerender(panel(true));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pin as an app' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();

    rerender(
      <ArtifactCard title="Budget" kind="table" version={2} action="edited" note="Edited by you" />,
    );
    expect(
      screen.getByRole('button', { name: /Table · edited by you · version 2/ }),
    ).toBeInTheDocument();
  });
});

describe('Live data', () => {
  it('the bar says when it read, and a failure calmly', async () => {
    const onRefresh = vi.fn();
    const onStop = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = renderNacre(
      <LiveDataBar
        state="live"
        updatedAt={Date.now() - 2 * 60_000}
        everySeconds={600}
        onRefresh={onRefresh}
        sources={[{ host: 'api.example.com' }]}
        onStop={onStop}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Live · Updated 2 min ago · every 10 min');
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(onRefresh).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reads from' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Where this page reads from' })).getByRole(
        'button',
        { name: 'Stop' },
      ),
    );
    expect(onStop).toHaveBeenCalledWith('api.example.com');
    await expectAccessible(container);

    rerender(
      <LiveDataBar
        state="failed"
        updatedAt={Date.now() - 12 * 60_000}
        problem="api.example.com took too long to answer."
        onRefresh={onRefresh}
        sources={[]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t update: api.example.com took too long to answer. Showing what it had from 12 min ago.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks once, showing exactly where; this computer takes a second yes', async () => {
    const onAllow = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = renderNacre(
      <LiveDataAsk
        title="Weather now"
        host="api.example.com"
        urls={['https://api.example.com/now?city={city}']}
        tainted="This chat read evil.example, which could be trying to steer me."
        onAllow={onAllow}
        onDecline={() => undefined}
      />,
    );
    const ask = screen.getByRole('group', {
      name: /Let “Weather now” read live data from api.example.com/,
    });
    expect(within(ask).getByText('https://api.example.com/now?city={city}')).toBeInTheDocument();
    expect(within(ask).getByText(/Only allow a site you know/)).toBeInTheDocument();
    await expectAccessible(container);
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalledWith('api.example.com', false);

    rerender(
      <LiveDataAsk
        title="Dev status"
        host="localhost:3000"
        urls={['http://localhost:3000/status']}
        local
        onAllow={onAllow}
        onDecline={() => undefined}
      />,
    );
    const allow = screen.getByRole('button', { name: 'Allow' });
    expect(allow).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Let it read from this computer/ }));
    await user.click(allow);
    expect(onAllow).toHaveBeenLastCalledWith('localhost:3000', true);
  });

  it('lists every OK, each a press from taken back', async () => {
    const onRevoke = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = renderNacre(
      <LiveDataList
        approvals={[
          { artifactId: 'a_1', title: 'Weather now', host: 'api.example.com', when: 'Oct 2' },
          { artifactId: 'a_2', title: 'Dev', host: 'localhost:3000', when: 'Oct 1', local: true },
        ]}
        onRevoke={onRevoke}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('This computer')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Take back api.example.com from Weather now' }),
    );
    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ host: 'api.example.com' }));
    await expectAccessible(container);
    rerender(<LiveDataList approvals={[]} onRevoke={onRevoke} />);
    expect(screen.getByText('No page reads live data')).toBeInTheDocument();
  });
});
