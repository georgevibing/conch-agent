import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { BrowserApproval } from './BrowserApproval';
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
  it('reports health and offers one repair', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    const { container } = renderNacre(
      <BrowserStatusCard
        phase="running"
        browserName="Microsoft Edge"
        version="154.0.1"
        onRepair={onRepair}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Running');
    expect(screen.getByText(/Microsoft Edge 154, on its own profile/)).toBeInTheDocument();
    // What it fixed on its own is listed in Settings → Health, not on the card.
    expect(screen.queryByRole('region', { name: 'Fixed on its own' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Repair' }));
    expect(onRepair).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});
