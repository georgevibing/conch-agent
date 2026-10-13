import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { BrowserApproval } from './BrowserApproval';
import { BrowserFill } from './BrowserFill';
import { BrowserHandoff } from './BrowserHandoff';
import { BrowserStatusCard } from './BrowserStatusCard';
import { BrowserTrail } from './BrowserTrail';
import { BrowserWindow, type BrowserWindowTab } from './BrowserWindow';
import { hotelsPage, trailSteps } from './fixtures';
import { browserShortcut, keyInput, pointOn, wheelDelta } from './input';

const tab: BrowserWindowTab = {
  url: 'https://www.staylight.example/lisbon',
  title: 'Hotels in Lisbon',
  canGoBack: true,
  control: 'idle',
};

function stubRect(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      width: 640,
      height: 400,
      right: 740,
      bottom: 450,
      x: 100,
      y: 50,
    }) as DOMRect;
}

describe('browser keys', () => {
  it('reads ⌘ as Ctrl off a Mac, and leaves the page its own keys', () => {
    const key = (init: Partial<KeyboardEvent>) => ({
      key: '',
      code: '',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...init,
    });
    expect(browserShortcut(key({ key: 't', ctrlKey: true }), false)).toEqual({ kind: 'new' });
    expect(browserShortcut(key({ key: 't', metaKey: true }), true)).toEqual({ kind: 'new' });
    // Ctrl+T on a Mac is the page's.
    expect(browserShortcut(key({ key: 't', ctrlKey: true }), true)).toBeUndefined();
    expect(browserShortcut(key({ key: '[', metaKey: true }), true)).toEqual({ kind: 'back' });
    expect(browserShortcut(key({ key: '1', code: 'Digit1', ctrlKey: true }), false)).toEqual({
      kind: 'nth',
      index: 0,
    });
    // Copy, paste, select all: the page's.
    for (const k of ['c', 'v', 'a', 'r'])
      expect(browserShortcut(key({ key: k, ctrlKey: true }), false)).toBeUndefined();
    expect(browserShortcut(key({ key: 'f', metaKey: true }), true)).toEqual({ kind: 'find' });
    expect(browserShortcut(key({ key: 'f', ctrlKey: true }), false)).toEqual({ kind: 'find' });
  });
});

describe('the page’s own question, find on page and Stop (ADR 0131)', () => {
  const asking: BrowserWindowTab = {
    ...tab,
    control: 'user',
    dialog: { id: 'd1', kind: 'confirm', message: 'Remove the mug?', site: 'shop.example' },
  };

  it('shows the site’s question while you drive, answered OK or Cancel', async () => {
    const onDialog = vi.fn();
    const onInput = vi.fn();
    const { container } = renderNacre(
      <BrowserWindow tab={asking} frame={hotelsPage} onDialog={onDialog} onInput={onInput} />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'shop.example says' });
    expect(dialog).toHaveTextContent('Remove the mug?');
    // OK has the focus: Enter answers it.
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    // The page is frozen: your hands wait for the answer.
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Page/ }), { button: 0 });
    expect(onInput).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDialog).toHaveBeenCalledWith('d1', false, undefined);
    await expectAccessible(container);
  });

  it('Escape is Cancel; a text box sends its words', async () => {
    const onDialog = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderNacre(
      <BrowserWindow tab={asking} frame={hotelsPage} onDialog={onDialog} />,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onDialog).toHaveBeenLastCalledWith('d1', false, undefined);
    rerender(
      <BrowserWindow
        tab={{
          ...asking,
          dialog: {
            id: 'd2',
            kind: 'prompt',
            message: 'Name it',
            value: 'Gifts',
            site: 'x.example',
          },
        }}
        frame={hotelsPage}
        onDialog={onDialog}
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    await user.clear(box);
    await user.type(box, 'Birthday{Enter}');
    expect(onDialog).toHaveBeenLastCalledWith('d2', true, 'Birthday');
  });

  it('only while you drive: the assistant answers its own', () => {
    renderNacre(
      <BrowserWindow tab={{ ...asking, control: 'agent' }} frame={hotelsPage} onDialog={vi.fn()} />,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('⌘F opens find on page: as you type, Enter for the next, Escape closes', async () => {
    const onFind = vi.fn();
    const user = userEvent.setup();
    const { rerender, container } = renderNacre(
      <BrowserWindow tab={tab} frame={hotelsPage} onFind={onFind} />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Take over the page/ }), {
      key: 'f',
      code: 'KeyF',
      ctrlKey: !/Mac|iPhone|iPad/.test(navigator.platform),
      metaKey: /Mac|iPhone|iPad/.test(navigator.platform),
    });
    const box = screen.getByRole('textbox', { name: 'Find on page' });
    expect(box).toHaveFocus();
    await user.type(box, 'pearl');
    await vi.waitFor(() => expect(onFind).toHaveBeenLastCalledWith('pearl'));
    rerender(
      <BrowserWindow
        tab={tab}
        frame={hotelsPage}
        onFind={onFind}
        found={{ text: 'pearl', matches: 3, current: 1 }}
      />,
    );
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onFind).toHaveBeenLastCalledWith('pearl', 'next');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onFind).toHaveBeenLastCalledWith('pearl', 'previous');
    await expectAccessible(container);
    await user.keyboard('{Escape}');
    expect(onFind).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('opens find from outside (the command palette)', () => {
    renderNacre(<BrowserWindow tab={tab} frame={hotelsPage} onFind={vi.fn()} findKey={1} />);
    expect(screen.getByRole('search', { name: 'Find on page' })).toBeInTheDocument();
  });

  it('has Stop while the assistant works', async () => {
    const onStop = vi.fn();
    const { rerender } = renderNacre(
      <BrowserWindow tab={{ ...tab, control: 'agent' }} frame={hotelsPage} onStop={onStop} />,
    );
    expect(screen.queryByRole('button', { name: 'Stop Conch' })).toBeNull();
    rerender(
      <BrowserWindow
        tab={{ ...tab, control: 'agent' }}
        frame={hotelsPage}
        running
        onStop={onStop}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop Conch' }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('input mapping', () => {
  it('turns pointer positions into 0–1 of the screen, clamped', () => {
    const rect = { left: 100, top: 50, width: 640, height: 400 };
    expect(pointOn(rect, 420, 250)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointOn(rect, 0, 900)).toEqual({ x: 0, y: 1 });
  });

  it('keeps printable keys as text and shortcuts as keys', () => {
    const base = { code: 'KeyA', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(keyInput('down', { ...base, key: 'a' })).toMatchObject({ key: 'a', text: 'a' });
    expect(keyInput('down', { ...base, key: 'a', ctrlKey: true })).toMatchObject({
      key: 'a',
      text: undefined,
      modifiers: { ctrl: true },
    });
    expect(keyInput('down', { ...base, key: 'Enter', code: 'Enter' })).toMatchObject({
      text: undefined,
    });
    expect(keyInput('down', { ...base, key: 'Process', isComposing: true })).toBeUndefined();
  });

  it('scales wheel deltas from lines and view size to page pixels', () => {
    expect(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 2)).toEqual({
      deltaX: 0,
      deltaY: 240,
    });
  });
});

describe('BrowserWindow', () => {
  it('is accessible, and says who is driving', async () => {
    const { container } = renderNacre(
      <BrowserWindow tab={{ ...tab, control: 'agent' }} frame={hotelsPage} name="Conch" />,
    );
    expect(screen.getByRole('region', { name: 'Browser' })).toBeInTheDocument();
    expect(screen.getByText('Conch is browsing')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Address: https:\/\/www\.staylight\.example\/lisbon/ }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('takes the wheel when you click the page, without passing that click on', async () => {
    const onTakeOver = vi.fn();
    const onInput = vi.fn();
    renderNacre(
      <BrowserWindow tab={tab} frame={hotelsPage} onTakeOver={onTakeOver} onInput={onInput} />,
    );
    const page = screen.getByRole('button', { name: /^Take over the page/ });
    fireEvent.pointerDown(page, { button: 0, clientX: 200, clientY: 200 });
    expect(onTakeOver).toHaveBeenCalledOnce();
    expect(onInput).not.toHaveBeenCalled();
  });

  it('takes the wheel from the keyboard too', async () => {
    const user = userEvent.setup();
    const onTakeOver = vi.fn();
    renderNacre(<BrowserWindow tab={tab} frame={hotelsPage} onTakeOver={onTakeOver} />);
    screen.getByRole('button', { name: /^Take over the page/ }).focus();
    await user.keyboard('{Enter}');
    expect(onTakeOver).toHaveBeenCalledOnce();
  });

  it('sends your mouse, keys, paste and wheel to the page while you drive', () => {
    const onInput = vi.fn();
    renderNacre(
      <BrowserWindow tab={{ ...tab, control: 'user' }} frame={hotelsPage} onInput={onInput} />,
    );
    const page = screen.getByRole('button', { name: /^Page: / });
    stubRect(page.parentElement as HTMLElement);
    const keys = screen.getByRole('textbox', { name: 'Type into the page' });
    fireEvent.pointerDown(page, { button: 0, clientX: 420, clientY: 250, detail: 1 });
    expect(onInput).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'mouse',
        action: 'down',
        x: 0.5,
        y: 0.5,
        button: 'left',
        clickCount: 1,
      }),
    );
    expect(keys).toHaveFocus();
    fireEvent.keyDown(keys, { key: 'h', code: 'KeyH' });
    expect(onInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'key', key: 'h', text: 'h' }),
    );
    fireEvent.paste(keys, { clipboardData: { getData: () => 'hello there' } });
    expect(onInput).toHaveBeenLastCalledWith({ type: 'text', text: 'hello there' });
    fireEvent.wheel(page, { deltaY: 100, deltaMode: 0, clientX: 420, clientY: 250 });
    expect(onInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'wheel', deltaY: 200 }),
    );
  });

  it('on a touch screen: a tap clicks and brings the keyboard up, a drag scrolls, two fingers zoom', async () => {
    const onInput = vi.fn();
    const onTakeOver = vi.fn();
    const { rerender } = renderNacre(
      <BrowserWindow tab={tab} frame={hotelsPage} onInput={onInput} onTakeOver={onTakeOver} />,
    );
    const finger = (id: number, x: number, y = 250) => ({
      pointerType: 'touch',
      pointerId: id,
      button: 0,
      clientX: x,
      clientY: y,
    });
    // Not driving: a tap takes the wheel when it lifts, so a pinch never does.
    let page = screen.getByRole('button', { name: /^Take over the page/ });
    fireEvent.pointerDown(page, finger(1, 420));
    expect(onTakeOver).not.toHaveBeenCalled();
    fireEvent.pointerUp(page, finger(1, 420));
    expect(onTakeOver).toHaveBeenCalledOnce();
    // Nobody was driving: the tap is also the click it meant to be.
    expect(onInput.mock.calls.map(([input]) => input.action)).toEqual(['down', 'up']);
    onInput.mockClear();

    rerender(
      <BrowserWindow tab={{ ...tab, control: 'user' }} frame={hotelsPage} onInput={onInput} />,
    );
    page = screen.getByRole('button', { name: /^Page: / });
    const layer = page.parentElement as HTMLElement;
    stubRect(layer);
    stubRect(layer.parentElement?.parentElement as HTMLElement);
    const keys = screen.getByRole('textbox', { name: 'Type into the page' });
    (document.activeElement as HTMLElement | null)?.blur();

    // A finger whose lift never arrived doesn't turn the next tap into half a pinch.
    fireEvent.pointerDown(page, { ...finger(9, 100), isPrimary: true });
    // A tap: a click where it landed, and the keys take the focus within the tap.
    fireEvent.pointerDown(page, { ...finger(1, 420), isPrimary: true });
    expect(onInput).not.toHaveBeenCalled();
    fireEvent.pointerUp(page, finger(1, 420));
    expect(onInput.mock.calls.map(([input]) => input.action)).toEqual(['down', 'up']);
    expect(onInput).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.5, y: 0.5 }));
    expect(keys).toHaveFocus();

    // A drag scrolls the page, in its own pixels.
    onInput.mockClear();
    fireEvent.pointerDown(page, finger(1, 420, 250));
    fireEvent.pointerMove(page, finger(1, 420, 230));
    fireEvent.pointerMove(page, finger(1, 420, 180));
    fireEvent.pointerUp(page, finger(1, 420, 180));
    expect(onInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'wheel', deltaY: 100 }),
    );
    expect(onInput.mock.calls.some(([input]) => input.action === 'down')).toBe(false);

    // Two fingers pinch the view, and nothing reaches the page.
    onInput.mockClear();
    fireEvent.pointerDown(page, finger(1, 300));
    fireEvent.pointerDown(page, finger(2, 540));
    fireEvent.pointerMove(page, finger(2, 780));
    fireEvent.pointerUp(page, finger(2, 780));
    fireEvent.pointerUp(page, finger(1, 300));
    expect(onInput).not.toHaveBeenCalled();
    const reset = screen.getByRole('button', { name: /^Zoomed to 200%/ });
    expect(layer.style.transform).toContain('scale(2)');
    fireEvent.click(reset);
    expect(screen.queryByRole('button', { name: /^Zoomed to/ })).not.toBeInTheDocument();
  });

  it('on a touch screen, the keyboard stays up only when a tap landed somewhere that takes typing', () => {
    const driving = { ...tab, control: 'user' as const };
    const { rerender } = renderNacre(<BrowserWindow tab={driving} frame={hotelsPage} />);
    const page = screen.getByRole('button', { name: /^Page: / });
    stubRect(page.parentElement as HTMLElement);
    const keys = screen.getByRole('textbox', { name: 'Type into the page' });
    const finger = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 420, clientY: 250 };
    fireEvent.pointerDown(page, finger);
    fireEvent.pointerUp(page, finger);
    expect(keys).toHaveFocus();
    // A field: it stays.
    rerender(
      <BrowserWindow tab={driving} frame={hotelsPage} typing={{ editable: true, key: 1 }} />,
    );
    expect(keys).toHaveFocus();
    // A link or a button: the keyboard goes.
    rerender(
      <BrowserWindow tab={driving} frame={hotelsPage} typing={{ editable: false, key: 2 }} />,
    );
    expect(keys).not.toHaveFocus();
    // The keyboard goes over the page; the app doesn't shrink for it.
    expect(keys.closest('[data-nc-keyboard-over]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /^Address/ }).closest('[data-nc-keyboard-over]'),
    ).not.toBeNull();
  });

  it('lets you leave the page with Shift+Escape, and hand back', async () => {
    const user = userEvent.setup();
    const onHandBack = vi.fn();
    const onInput = vi.fn();
    renderNacre(
      <BrowserWindow
        tab={{ ...tab, control: 'user' }}
        frame={hotelsPage}
        onInput={onInput}
        onHandBack={onHandBack}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Type into the page' })).toHaveFocus();
    await user.keyboard('{Shift>}{Escape}{/Shift}');
    const handBack = screen.getByRole('button', { name: 'Hand back' });
    expect(handBack).toHaveFocus();
    await user.click(handBack);
    expect(onHandBack).toHaveBeenCalledOnce();
  });

  it('asks for an address and opens it', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderNacre(<BrowserWindow tab={null} onNavigate={onNavigate} />);
    await user.click(screen.getByRole('button', { name: 'Open a page yourself' }));
    await user.type(screen.getByRole('textbox', { name: 'Address' }), 'example.com{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('example.com');
  });

  it('shows install progress and problems on the screen', async () => {
    const { rerender, container } = renderNacre(
      <BrowserWindow
        tab={null}
        phase="installing"
        install={{ percent: 30, label: 'Downloading Chromium · 30%' }}
      />,
    );
    expect(screen.getByText('Getting a browser ready')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    const onAction = vi.fn();
    rerender(
      <BrowserWindow
        tab={null}
        phase="problem"
        problem={{
          message: 'Needs libraries.',
          command: 'sudo apt install x',
          actionLabel: 'Repair',
          onAction,
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Needs libraries.');
    expect(screen.getByText('sudo apt install x')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows the chat’s tabs, switches, closes and opens them', async () => {
    const user = userEvent.setup();
    const onTab = vi.fn();
    const { container, rerender } = renderNacre(
      <BrowserWindow
        tab={{ ...tab, tabs: [{ id: 't1', title: 'Hotels', url: tab.url, active: true }] }}
        onTab={onTab}
      />,
    );
    // One tab: the strip is there (as in any browser), but one tab can't be closed.
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hotels' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /^Close tab/ })).not.toBeInTheDocument();
    rerender(
      <BrowserWindow
        tab={{
          ...tab,
          tabs: [
            { id: 't1', title: 'Hotels', url: tab.url, active: false },
            { id: 't2', title: '', url: 'https://accounts.example.com/signin', active: true },
          ],
        }}
        onTab={onTab}
      />,
    );
    const strip = screen.getByRole('navigation', { name: 'Tabs' });
    expect(screen.getByRole('button', { name: 'accounts.example.com' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('button', { name: 'Hotels' }));
    expect(onTab).toHaveBeenLastCalledWith('switch', 't1');
    await user.click(screen.getByRole('button', { name: 'Close tab: Hotels' }));
    expect(onTab).toHaveBeenLastCalledWith('close', 't1');
    // The middle button closes a tab too.
    fireEvent(
      screen.getByRole('button', { name: 'Hotels' }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    expect(onTab).toHaveBeenLastCalledWith('close', 't1');
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(onTab).toHaveBeenLastCalledWith('new');
    // …and the address is ready to type for it.
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveFocus();
    expect(strip).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows each tab’s icon, and a spinner while it loads', () => {
    const icon = 'data:image/png;base64,iVBORw0KGgo=';
    const { container } = renderNacre(
      <BrowserWindow
        tab={{
          ...tab,
          loading: true,
          tabs: [
            { id: 't1', title: 'Hotels', url: tab.url, active: false, icon },
            { id: 't2', title: 'Maps', url: 'https://maps.example', active: true, loading: true },
          ],
        }}
        onTab={() => undefined}
      />,
    );
    expect(container.querySelector(`img[src="${icon}"]`)).toBeInTheDocument();
    // Loading: Stop in place of Reload.
    expect(screen.getByRole('button', { name: 'Stop loading' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('has a browser’s keys for tabs, the address and history', () => {
    const onTab = vi.fn();
    const onHistory = vi.fn();
    renderNacre(
      <BrowserWindow
        tab={{
          ...tab,
          canGoForward: false,
          tabs: [
            { id: 't1', title: 'Hotels', url: tab.url, active: true },
            { id: 't2', title: 'Maps', url: 'https://maps.example', active: false },
            { id: 't3', title: 'Mail', url: 'https://mail.example', active: false },
          ],
        }}
        onTab={onTab}
        onHistory={onHistory}
      />,
    );
    const window = screen.getByRole('region', { name: 'Browser' });
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(onTab).toHaveBeenLastCalledWith('switch', 't2');
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(onTab).toHaveBeenLastCalledWith('switch', 't3');
    fireEvent.keyDown(window, { key: '9', code: 'Digit9', ctrlKey: true });
    expect(onTab).toHaveBeenLastCalledWith('switch', 't3');
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(onTab).toHaveBeenLastCalledWith('close', 't1');
    fireEvent.keyDown(window, { key: 'T', ctrlKey: true, shiftKey: true });
    expect(onTab).toHaveBeenLastCalledWith('reopen');
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(onHistory).toHaveBeenLastCalledWith('back');
    // Nowhere forward to go: nothing happens.
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(onHistory).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue(tab.url);
  });

  it('opens your tabs again', () => {
    renderNacre(<BrowserWindow tab={null} phase="restoring" />);
    expect(screen.getByText('Opening your tabs…')).toBeInTheDocument();
  });

  it('says when it’s your own Chrome or a browser in the cloud', () => {
    const { rerender } = renderNacre(<BrowserWindow tab={{ ...tab, backend: 'chrome' }} />);
    expect(screen.getByText('In your Chrome')).toBeInTheDocument();
    rerender(<BrowserWindow tab={{ ...tab, backend: 'steel' }} />);
    expect(screen.getByText('In the cloud')).toBeInTheDocument();
  });

  it('shows the handoff and hands back with “I’m done”', async () => {
    const user = userEvent.setup();
    const onHandBack = vi.fn();
    renderNacre(
      <BrowserWindow
        tab={{ ...tab, control: 'user', handoff: { reason: 'Sign in to your account' } }}
        onHandBack={onHandBack}
      />,
    );
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’m done' }));
    expect(onHandBack).toHaveBeenCalledOnce();
  });
});

describe('BrowserTrail', () => {
  it('names a human wait, stays accessible, and resumes browsing in place', async () => {
    const { container, rerender } = renderNacre(
      <BrowserTrail
        onShow={() => undefined}
        steps={[
          {
            id: 'one',
            status: 'waiting',
            label: 'Waiting for your approval',
            url: 'https://example.com',
          },
        ]}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Waiting for your approval' })).not.toHaveLength(
      0,
    );
    expect(screen.getByRole('button', { name: 'Show browser' })).toBeInTheDocument();
    expect(container.querySelector('[data-status="running"]')).not.toBeInTheDocument();
    await expectAccessible(container);
    rerender(
      <BrowserTrail
        steps={[
          { id: 'one', status: 'running', label: 'Reading the page', url: 'https://example.com' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Browsing example.com' })).toBeInTheDocument();
  });

  it('summarises the browsing and opens every step', async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    const { container } = renderNacre(<BrowserTrail steps={trailSteps} onShow={onShow} />);
    expect(screen.getByRole('button', { name: /Browsing staylight\.example/ })).toBeInTheDocument();
    expect(screen.getByText('Clicking “See availability”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Browsing staylight\.example/ }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(trailSteps.length);
    await user.click(screen.getByRole('button', { name: 'Watch' }));
    expect(onShow).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('BrowserApproval', () => {
  it('asks about a site once, with this chat or always', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <BrowserApproval
        kind="site"
        site="booking.com"
        action="Click “Search”"
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Let Conch use booking.com?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Always for booking.com' }));
    expect(onDecide).toHaveBeenCalledWith('allow-always');
    await expectAccessible(container);
  });

  it('confirms something significant without an “always”', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    renderNacre(
      <BrowserApproval
        kind="high-stakes"
        site="shop.example"
        action="Click “Place order”"
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Click “Place order”?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Don’t' }));
    expect(onDecide).toHaveBeenCalledWith('deny');
  });

  it('asks before every upload, without an “always”', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <BrowserApproval
        kind="upload"
        site="jobs.example"
        action="Upload “cv.pdf”"
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Upload “cv.pdf” to jobs.example?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(onDecide).toHaveBeenCalledWith('allow');
    await expectAccessible(container);
  });

  it('never offers “always” for a site in your own Chrome', () => {
    renderNacre(<BrowserApproval kind="site" site="bank.example" action="x" ownChrome />);
    expect(screen.getByText(/in your own Chrome, where you’re signed in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
  });

  it('settles into a quiet line once answered', () => {
    renderNacre(
      <BrowserApproval kind="site" site="booking.com" action="x" decision="allow-always" />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Always allowed on booking.com');
  });

  it('asks once for a sign-in from Passwords, with the account', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <BrowserApproval
        kind="fill"
        fill="sign-in"
        site="example.com"
        action="Sign in as ada@example.com"
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Sign in as ada@example.com on example.com?')).toBeInTheDocument();
    expect(screen.getByText(/for this whole sign-in/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onDecide).toHaveBeenCalledWith('allow');
    await expectAccessible(container);
  });

  it('lets you pick one of several accounts in one tap, with no “always”', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const onChoose = vi.fn();
    const { container } = renderNacre(
      <BrowserApproval
        kind="fill"
        fill="sign-in"
        site="google.com"
        action="Sign in"
        savedFor="accounts.google.com"
        accounts={[
          { id: 'a', title: 'Google', account: 'ada@gmail.com' },
          { id: 'b', title: 'Google (work)', account: 'ada@work.example' },
        ]}
        onDecide={onDecide}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByText(/saved for accounts.google.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ada@work.example/ }));
    expect(onChoose).toHaveBeenCalledWith('b');
    expect(onDecide).toHaveBeenCalledWith('allow');
    await expectAccessible(container);
  });

  it('names the site a provider’s sign-in is for (ADR 0133)', async () => {
    const { container } = renderNacre(
      <BrowserApproval
        kind="fill"
        fill="sign-in"
        site="accounts.google.com"
        action="Sign in to “Product Hunt” with Google as ada@gmail.com"
        signingInTo="Product Hunt"
        onDecide={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Sign in to “Product Hunt” with Google as ada@gmail.com?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /types it in on accounts\.google\.com from your Passwords, for the whole sign-in to Product Hunt/,
      ),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('asks every time before making a new password or filling a card', () => {
    const { rerender } = renderNacre(
      <BrowserApproval
        kind="fill"
        fill="new-password"
        site="shop.example"
        action="Make a strong password for shop.example"
      />,
    );
    expect(screen.getByText('Make a strong password for shop.example?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make and save it' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
    rerender(
      <BrowserApproval kind="fill" fill="card" site="shop.example" action="Fill in “Visa”" />,
    );
    expect(screen.queryByRole('button', { name: /Always/ })).not.toBeInTheDocument();
  });
});

describe('BrowserFill', () => {
  it('fills from one of the saved accounts, by name', async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    const { container } = renderNacre(
      <BrowserFill
        offer={{
          field: 'password',
          site: 'example.com',
          items: [{ id: 'pw_1', title: 'Example', account: 'ada@example.com' }],
        }}
        onFill={onFill}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Fill your password from Passwords')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ada@example.com/ }));
    expect(onFill).toHaveBeenCalledWith('pw_1');
    await expectAccessible(container);
  });

  it('offers a strong password on a sign-up', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    renderNacre(
      <BrowserFill
        offer={{ field: 'new-password', site: 'shop.example', items: [] }}
        onGenerate={onGenerate}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use a strong password' }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('warns on a look-alike page and offers nothing', async () => {
    const { container } = renderNacre(
      <BrowserFill
        offer={{
          field: 'password',
          site: 'paypa1.com',
          items: [{ id: 'x', title: 'Should not show' }],
          lookalike: 'paypal.com',
        }}
        onFill={vi.fn()}
      />,
    );
    expect(screen.getByText('This isn’t paypal.com.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Should not show/ })).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says how a site signs in with Google, and presses its button (ADR 0133)', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const { container } = renderNacre(
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'producthunt.com',
          items: [{ id: 'ph', title: 'Product Hunt', account: 'ada@gmail.com' }],
          signIn: {
            via: 'provider',
            provider: 'google',
            name: 'Google',
            account: 'ada@gmail.com',
            button: 'Continue with Google',
            with: { id: 'g1', title: 'Google', account: 'ada@gmail.com' },
          },
        }}
        onSignIn={onSignIn}
        onFill={vi.fn()}
      />,
    );
    const bar = screen.getByRole('group', { name: 'Passwords' });
    expect(bar).toHaveTextContent('Product Hunt signs in with Google · ada@gmail.com');
    expect(bar).toHaveTextContent('Conch fills Google’s sign-in from “Google”.');
    // Nothing to fill on Product Hunt itself.
    expect(screen.queryByRole('button', { name: /Fill from/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(onSignIn).toHaveBeenCalledWith('ph', undefined);
    await expectAccessible(container);
  });

  it('asks which, when the item doesn’t say whose account', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const { container } = renderNacre(
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'producthunt.com',
          items: [{ id: 'ph', title: 'Product Hunt' }],
          signIn: {
            via: 'provider',
            name: 'another account',
            buttons: ['Continue with Google', 'Continue with Apple'],
          },
        }}
        onSignIn={onSignIn}
      />,
    );
    expect(screen.getByRole('group', { name: 'Passwords' })).toHaveTextContent(
      'Product Hunt signs in with another account Which one do you use?',
    );
    const ways = within(screen.getByRole('list', { name: 'Ways to sign in on this page' }));
    await user.click(ways.getByRole('button', { name: 'Continue with Apple' }));
    expect(onSignIn).toHaveBeenCalledWith('ph', 'Continue with Apple');
    await expectAccessible(container);
  });

  it('a passkey kept in 1Password: said plainly, with nothing to press', async () => {
    const { container } = renderNacre(
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'shop.example',
          items: [{ id: 's', title: 'Shop' }],
          signIn: { via: 'passkey', name: 'Shop', usable: false, keptIn: '1Password' },
        }}
        onSignIn={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Passwords' })).toHaveTextContent(
      'Shop’s passkey is in 1Password, which this browser can’t use.',
    );
    expect(screen.queryByRole('button', { name: /passkey/i })).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('a passkey Conch holds, a company sign-in, and Google’s page for a site', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onFill = vi.fn();
    const { rerender } = renderNacre(
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'shop.example',
          items: [{ id: 's', title: 'Shop' }],
          signIn: { via: 'passkey', name: 'Shop', usable: true },
        }}
        onSignIn={onSignIn}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use your passkey' }));
    expect(onSignIn).toHaveBeenLastCalledWith('s', undefined);
    rerender(
      <BrowserFill
        offer={{
          field: 'username',
          site: 'linear.app',
          items: [{ id: 'l', title: 'Linear', account: 'ada@acme.example' }],
          signIn: { via: 'sso', name: 'Acme SSO', account: 'ada@acme.example' },
        }}
        onFill={onFill}
      />,
    );
    expect(screen.getByRole('group', { name: 'Passwords' })).toHaveTextContent(
      'Linear signs in through Acme SSO',
    );
    // The work email still fills from the item.
    await user.click(screen.getByRole('button', { name: 'Fill from “Linear”, ada@acme.example' }));
    expect(onFill).toHaveBeenCalledWith('l');
    rerender(
      <BrowserFill
        offer={{
          field: 'username',
          site: 'accounts.google.com',
          for: 'Product Hunt',
          items: [{ id: 'g1', title: 'Google', account: 'ada@gmail.com' }],
        }}
        onFill={onFill}
      />,
    );
    expect(screen.getByText(/For Product Hunt/)).toBeInTheDocument();
  });

  it('shows only while you drive', () => {
    const offer = { field: 'password' as const, site: 'example.com', items: [] };
    const { rerender } = renderNacre(<BrowserWindow tab={tab} fill={{ offer }} />);
    expect(screen.queryByRole('group', { name: 'Passwords' })).not.toBeInTheDocument();
    rerender(<BrowserWindow tab={{ ...tab, control: 'user' }} fill={{ offer }} />);
    expect(screen.getByRole('group', { name: 'Passwords' })).toBeInTheDocument();
  });
});

describe('BrowserHandoff', () => {
  it('waits for you, then settles', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { rerender, container } = renderNacre(
      <BrowserHandoff
        reason="Sign in to Staylight"
        state="waiting"
        onDone={onDone}
        onShow={() => {}}
      />,
    );
    expect(screen.getByRole('group', { name: 'Your turn in the browser' })).toHaveTextContent(
      'Sign in to Staylight',
    );
    await user.click(screen.getByRole('button', { name: 'I’m done' }));
    expect(onDone).toHaveBeenCalledOnce();
    await expectAccessible(container);
    rerender(<BrowserHandoff reason="Sign in to Staylight" state="done" />);
    expect(screen.getByRole('note')).toHaveTextContent('You took care of it');
    rerender(<BrowserHandoff reason="Sign in to Staylight" state="done" auto />);
    expect(screen.getByRole('note')).toHaveTextContent('You got through, so Conch carried on');
  });
});

describe('BrowserStatusCard', () => {
  it('reports health, and says nothing about repairing while it’s healthy', async () => {
    const { container } = renderNacre(
      <BrowserStatusCard
        phase="running"
        browserName="Microsoft Edge"
        version="154.0.1"
        onRepair={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Running');
    expect(screen.getByText(/Microsoft Edge 154, on its own profile/)).toBeInTheDocument();
    // Repair everything in Settings → Health looks after it; the card has no button of its own.
    expect(screen.queryByRole('button', { name: 'Repair' })).toBeNull();
    // What it fixed on its own is listed in Settings → Health, not on the card.
    expect(screen.queryByRole('region', { name: 'Fixed on its own' })).toBeNull();
    await expectAccessible(container);
  });

  it('with a real problem, says it in a line and offers one repair', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    const { container, rerender } = renderNacre(
      <BrowserStatusCard
        phase="problem"
        problem={{ message: 'The browser won’t start.' }}
        onRepair={onRepair}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Needs a hand');
    expect(screen.getByText('The browser won’t start.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Repair' }));
    expect(onRepair).toHaveBeenCalledOnce();
    await expectAccessible(container);
    // While the repair runs, the button stays where it was, busy.
    rerender(
      <BrowserStatusCard
        phase="repairing"
        problem={{ message: 'The browser won’t start.' }}
        onRepair={onRepair}
      />,
    );
    expect(screen.getByRole('button', { name: /Repair/ })).toHaveAttribute('aria-busy', 'true');
  });
});
