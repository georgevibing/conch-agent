import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderNacre } from '../../test/render';
import { SealedFrame, type SealedCallResult } from './SealedFrame';

const message = (source: unknown, data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  });

const call = (id: string, tool: unknown, input?: unknown) => ({
  conch: 'artifact',
  call: { id, tool, input },
});

const ok: SealedCallResult = { ok: true, text: 'Logged: fern watered.' };

type OnCall = (
  tool: string,
  input: Record<string, unknown>,
  activated: boolean,
) => Promise<SealedCallResult>;

/** Pretends the window has (or hasn't) transient user activation right now. */
function activation(isActive: boolean | undefined) {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: isActive === undefined ? undefined : { isActive, hasBeenActive: isActive },
  });
}

function frame(title = 'Plant diary') {
  const el = screen.getByTitle(title) as HTMLIFrameElement;
  return { el, win: el.contentWindow as Window };
}

afterEach(() => activation(undefined));

describe('SealedFrame: a Conch app page calling its tools (ADR 0061)', () => {
  it('calls only for its own frame, and answers only that frame', async () => {
    const onCall = vi.fn(async () => ok);
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    const ask = call('c1', 'log_watering', { plant: 'fern' });

    // This page, another window, nowhere: nothing is called.
    message(window, ask);
    message(null, ask);
    message({}, ask);
    expect(onCall).not.toHaveBeenCalled();

    message(win, ask);
    expect(onCall).toHaveBeenCalledWith('log_watering', { plant: 'fern' }, false);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith({ conch: 'app-call', id: 'c1', result: ok }, '*'),
    );
  });

  it('says a press happened only while the person is pressing inside this frame', () => {
    const onCall = vi.fn(async () => ok);
    renderNacre(
      <>
        <button type="button">Elsewhere in Conch</button>
        <SealedFrame src="/frame" title="Plant diary" onCall={onCall} />
      </>,
    );
    const { el, win } = frame();
    el.tabIndex = 0;

    // Activation from a click somewhere else in Conch: not the page's press.
    activation(true);
    screen.getByRole('button', { name: 'Elsewhere in Conch' }).focus();
    message(win, call('c1', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, false);

    // A click in the frame focuses it, and the window is active: a press.
    el.focus();
    message(win, call('c2', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, true);

    // The activation has run out: a change has to ask again.
    activation(false);
    message(win, call('c3', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, false);

    // And the page's own word for it is never taken.
    message(win, { conch: 'artifact', call: { id: 'c4', tool: 'log_watering', activated: true } });
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, false);
  });

  it('never lends a press in Conch itself to the page, even if the page takes focus back', () => {
    const onCall = vi.fn(async () => ok);
    let now = 100_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    renderNacre(
      <>
        <button type="button">Elsewhere in Conch</button>
        <SealedFrame src="/frame" title="Plant diary" onCall={onCall} />
      </>,
    );
    const { el, win } = frame();
    el.tabIndex = 0;
    activation(true);

    // A click in Conch makes the window active; the page grabs focus and calls.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere in Conch' }));
    el.focus();
    message(win, call('s1', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, false);
    // A key in Conch is the same.
    now += 6000;
    fireEvent.keyDown(window, { key: 'Enter' });
    message(win, call('s2', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, false);

    // Long after anything was pressed in Conch, a press in the page counts.
    now += 6000;
    message(win, call('s3', 'log_watering'));
    expect(onCall).toHaveBeenLastCalledWith('log_watering', {}, true);
    vi.restoreAllMocks();
  });

  it('turns away malformed calls, answering when it can say which one', async () => {
    const onCall = vi.fn(async () => ok);
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const bad of [
      call('b1', 'Log-Watering'),
      call('b2', 'a'.repeat(21)),
      call('b3', 42),
      call('b4', 'log_watering', ['fern']),
      call('b5', 'log_watering', 'fern'),
      call('b6', 'log_watering', new Map([['plant', 'fern']])),
      call('b7', 'log_watering', cyclic),
      call('b8', 'log_watering', { note: 'x'.repeat(70_000) }),
      call('b9', 'log_watering', new Date()),
    ])
      message(win, bad);
    // No id worth answering: dropped.
    for (const id of [undefined, 7, '', 'x'.repeat(33), 'has space', '../x'])
      message(win, { conch: 'artifact', call: { id, tool: 'log_watering' } });
    // Not a call at all.
    message(win, { call: { id: 'n1', tool: 'log_watering' } });
    message(win, { conch: 'artifact', call: 'log_watering' });
    expect(onCall).not.toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(9));
    expect(post).toHaveBeenCalledWith(
      {
        conch: 'app-call',
        id: 'b8',
        result: expect.objectContaining({ ok: false, reason: 'error' }),
      },
      '*',
    );
  });

  it('passes on plain JSON only', () => {
    const onCall = vi.fn<OnCall>(async () => ok);
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { win } = frame();
    message(win, call('j1', 'find_plants', { when: { after: 1 }, list: [1, 'a', null] }));
    message(win, call('j2', 'find_plants', Object.create(null)));
    message(win, call('j3', 'find_plants'));
    expect(onCall.mock.calls.map((c) => c[1])).toEqual([
      { when: { after: 1 }, list: [1, 'a', null] },
      {},
      {},
    ]);
  });

  it('holds at most eight calls at once, and says so to the ninth', async () => {
    const waiting: ((r: SealedCallResult) => void)[] = [];
    const onCall = vi.fn(() => new Promise<SealedCallResult>((resolve) => waiting.push(resolve)));
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    for (let i = 0; i < 10; i++) message(win, call(`m${i}`, 'find_plants'));
    expect(onCall).toHaveBeenCalledTimes(8);
    expect(post).toHaveBeenCalledWith(
      {
        conch: 'app-call',
        id: 'm8',
        result: {
          ok: false,
          reason: 'error',
          message: 'Too many calls at once. Wait for one to finish, then try again.',
        },
      },
      '*',
    );
    // One finishes: there's room again.
    await act(async () => waiting[0]?.(ok));
    message(win, call('m10', 'find_plants'));
    expect(onCall).toHaveBeenCalledTimes(9);
  });

  it('answers a failure in words the page can show', async () => {
    const onCall = vi.fn(async () => {
      throw new Error('socket closed');
    });
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    message(win, call('e1', 'find_plants'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          conch: 'app-call',
          id: 'e1',
          result: {
            ok: false,
            reason: 'error',
            message: 'Conch couldn’t reach the app. Try again.',
          },
        },
        '*',
      ),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain('socket closed');
  });

  it('never answers a page that loaded again', async () => {
    let finish: (r: SealedCallResult) => void = () => undefined;
    const onCall = vi.fn(() => new Promise<SealedCallResult>((resolve) => (finish = resolve)));
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onCall={onCall} />);
    const { el, win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    fireEvent.load(el);
    message(win, call('r1', 'find_plants'));
    // It navigated away (or reloaded) while the call was out.
    fireEvent.load(el);
    await act(async () => finish(ok));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Conch stopped this page')).toBeInTheDocument();
  });

  it('ignores calls when it isn’t a Conch app’s page', () => {
    const onData = vi.fn(async () => ({}));
    renderNacre(<SealedFrame src="/frame" title="Plant diary" onData={onData} />);
    const { win } = frame();
    const post = vi.spyOn(win, 'postMessage');
    message(win, call('x1', 'find_plants'));
    expect(post).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
  });
});
