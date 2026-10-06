import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextMenu } from '../../components/ContextMenu';
import { expectAccessible, renderNacre } from '../../test/render';
import { ChatListSection } from './ChatListSection';
import { ChatRow } from './ChatRow';
import { FolderMark } from './FolderMark';
import { edgeScroll, EDGE_SPEED, HOLD_MS, HOLD_SLOP, SETTLE_MS, touchDrag } from './touchDrag';

const touch = { pointerType: 'touch', isPrimary: true, pointerId: 7 };

let vibrate: ReturnType<typeof vi.fn>;
let under: Element | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  // jsdom lays nothing out: say what's under the finger.
  document.elementFromPoint = () => under;
});

afterEach(() => {
  touchDrag.cancel();
  under = null;
  vi.useRealTimers();
});

function list(onDrop = vi.fn(), onSelect = vi.fn()) {
  renderNacre(
    <>
      <ChatListSection
        kind="folder"
        label="Work"
        icon={<FolderMark glyph="briefcase" color="blue" />}
        collapsible
        onDropChats={onDrop}
        dropHint="Drop to move to Work"
        empty="Hold a chat to drag it here."
      />
      <ChatListSection label="Today" onDropChats={() => undefined}>
        <ChatRow
          dragIds={['c1']}
          contextMenu={<ContextMenu.Item onSelect={onSelect}>Rename</ContextMenu.Item>}
        >
          <a href="#c1">Offsite agenda</a>
        </ChatRow>
      </ChatListSection>
    </>,
  );
  return {
    folder: screen.getByRole('region', { name: 'Work' }),
    item: screen.getByText('Offsite agenda').closest('li') as HTMLElement,
    onDrop,
  };
}

/** A finger held on the row until it lifts. */
function hold(item: HTMLElement, x = 40, y = 200) {
  fireEvent.pointerDown(item, { ...touch, clientX: x, clientY: y });
  act(() => vi.advanceTimersByTime(HOLD_MS));
}

describe('holding a chat on a phone', () => {
  it('lifts it, carries it to a folder that lights up, and drops it there', () => {
    const { folder, item, onDrop } = list();
    hold(item);
    expect(item).toHaveAttribute('data-held', 'lifted');
    expect(vibrate).toHaveBeenCalled();

    // Moving off: a copy follows the finger, and every place that takes chats invites.
    fireEvent.pointerMove(item, { ...touch, clientX: 60, clientY: 120 });
    expect(item).toHaveAttribute('data-held', 'dragging');
    expect(folder).toHaveAttribute('data-drop-ready');
    expect(folder).not.toHaveAttribute('data-drop-over');

    under = within(folder).getByRole('button', { name: /Work/ });
    fireEvent.pointerMove(item, { ...touch, clientX: 60, clientY: 40 });
    expect(folder).toHaveAttribute('data-drop-over');
    expect(within(folder).getByText('Drop to move to Work')).toBeInTheDocument();

    fireEvent.pointerUp(item, { ...touch, clientX: 60, clientY: 40 });
    expect(folder).not.toHaveAttribute('data-drop-over');
    expect(folder).not.toHaveAttribute('data-drop-ready');
    // The copy settles into the folder first: moving the chats at once would
    // take their row (which draws the copy) out of the list mid-animation.
    expect(item).toHaveAttribute('data-held', 'dropped');
    expect(onDrop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(onDrop).toHaveBeenCalledWith(['c1']);
    act(() => vi.runOnlyPendingTimers());
    expect(item).not.toHaveAttribute('data-held');
  });

  it('let go anywhere that takes nothing, it goes back and nothing moves', () => {
    const { item, onDrop } = list();
    hold(item);
    fireEvent.pointerMove(item, { ...touch, clientX: 300, clientY: 500 });
    fireEvent.pointerUp(item, { ...touch, clientX: 300, clientY: 500 });
    expect(onDrop).not.toHaveBeenCalled();
    expect(item).toHaveAttribute('data-held', 'returning');
    act(() => vi.runOnlyPendingTimers());
    expect(item).not.toHaveAttribute('data-held');
  });

  it('a finger that moves before it lifts is scrolling, and is left alone', () => {
    const { item } = list();
    fireEvent.pointerDown(item, { ...touch, clientX: 40, clientY: 200 });
    fireEvent.pointerMove(item, { ...touch, clientX: 40, clientY: 200 - HOLD_SLOP - 4 });
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(item).not.toHaveAttribute('data-held');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('let go without moving opens the row’s menu, as a hold always did', () => {
    const { item } = list();
    hold(item);
    fireEvent.pointerUp(item, { ...touch, clientX: 40, clientY: 200 });
    expect(item).not.toHaveAttribute('data-held');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('keeps the phone’s own long-press menu for the hold, and a right-click for the mouse', () => {
    const { item } = list();
    fireEvent.pointerDown(item, { ...touch, clientX: 40, clientY: 200 });
    // Android's own long press, while the finger is still down.
    fireEvent.contextMenu(item, { clientX: 40, clientY: 200 });
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    fireEvent.pointerUp(item, { ...touch, clientX: 40, clientY: 200 });
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.contextMenu(item, { clientX: 40, clientY: 200 });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('a mouse drags the browser’s way: holding it does nothing', () => {
    const { item } = list();
    fireEvent.pointerDown(item, { pointerType: 'mouse', isPrimary: true, pointerId: 1 });
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(item).not.toHaveAttribute('data-held');
  });

  it('a tap after a hold is not a press of the link', () => {
    const { item } = list();
    hold(item);
    fireEvent.pointerMove(item, { ...touch, clientX: 300, clientY: 500 });
    fireEvent.pointerUp(item, { ...touch, clientX: 300, clientY: 500 });
    const link = within(item).getByRole('link');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});

describe('a folder in the list', () => {
  it('reads as a place: its name like a row, its empty note in place of chats', async () => {
    const { container } = renderNacre(
      <nav aria-label="Conversations">
        <ChatListSection
          kind="folder"
          label="Work"
          icon={<FolderMark glyph="briefcase" color="blue" />}
          collapsible
          count={0}
          empty="Drag chats here."
        />
      </nav>,
    );
    const folder = screen.getByRole('region', { name: 'Work' });
    expect(folder).toHaveAttribute('data-kind', 'folder');
    expect(within(folder).getByText('Drag chats here.')).toBeInTheDocument();
    vi.useRealTimers();
    await expectAccessible(container);
  });
});

describe('edgeScroll', () => {
  it('scrolls only near an edge, faster the closer the finger is', () => {
    expect(edgeScroll(300, 0, 600)).toBe(0);
    expect(edgeScroll(50, 0, 600)).toBeLessThan(0);
    expect(edgeScroll(2, 0, 600)).toBeLessThan(edgeScroll(50, 0, 600));
    expect(edgeScroll(598, 0, 600)).toBe(EDGE_SPEED);
    expect(edgeScroll(-40, 0, 600)).toBe(-EDGE_SPEED);
    expect(edgeScroll(10, 0, 0)).toBe(0);
  });
});
