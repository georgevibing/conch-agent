import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from '../../components/IconButton';
import { expectAccessible, renderNacre } from '../../test/render';
import { AppIcon } from '../ConchApps/AppIcon';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { AppDock, DockGlyph } from './AppDock';
import { ChatListSection } from './ChatListSection';
import { ChatRow } from './ChatRow';
import { CHAT_DRAG_TYPE } from './drag';
import { FolderDialog } from './FolderDialog';
import { FolderMark } from './FolderMark';
import { MarkPicker } from './MarkPicker';
import { SelectionBar } from './SelectionBar';
import { SWIPE_FLICK_SPEED, swipeOffset, swipeOutcome } from './swipe';
import { TidyCard } from './TidyCard';

const more = (title: string) => (
  <IconButton size="sm" label={`Options for ${title}`} tooltip={false}>
    <MoreHorizontal />
  </IconButton>
);

function chatDrop(ids: string[]) {
  return {
    types: [CHAT_DRAG_TYPE, 'text/plain'],
    getData: (type: string) => (type === CHAT_DRAG_TYPE ? JSON.stringify(ids) : ''),
    dropEffect: 'none',
  };
}

describe('ChatList', () => {
  it('composes into an accessible sidebar list', async () => {
    const { container } = renderNacre(
      <nav aria-label="Conversations">
        <AppDock
          items={[
            {
              key: 'tally',
              label: 'Tally',
              icon: <AppIcon glyph="wallet" color="green" />,
              source: 'Page of the Tally app',
              active: true,
              onOpen: () => undefined,
            },
            {
              key: 'notes',
              label: 'Trip notes',
              icon: <DockGlyph icon={<MoreHorizontal />} />,
              source: 'Made in a chat',
              onOpen: () => undefined,
            },
          ]}
        />
        <ChatListSection label="Pinned" onDropChats={() => undefined} dropHint="Drop to pin">
          <ChatRow status="working" menu={more('Board deck')}>
            <a href="#a">Board deck</a>
          </ChatRow>
        </ChatListSection>
        <ChatListSection
          label="Work"
          icon={<FolderMark glyph="briefcase" color="blue" />}
          collapsible
          count={1}
          actions={more('Work')}
        >
          <ChatRow status="unread" menu={more('Hiring post')}>
            <a href="#b">Hiring post</a>
          </ChatRow>
        </ChatListSection>
        <ChatListSection label="Today">
          <ChatRow
            active
            leading={<IntegrationLogo brand="telegram" name="Telegram" size="xs" />}
            menu={more('Groceries')}
          >
            <a href="#c">Groceries</a>
          </ChatRow>
          <ChatRow status="waiting" contextMenu={<span />}>
            <a href="#d">Dentist</a>
          </ChatRow>
        </ChatListSection>
        <TidyCard count={4} days={30} onTidy={() => undefined} onDismiss={() => undefined} />
      </nav>,
    );
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Groceries/ })).toHaveAttribute('aria-current', 'page');
    await expectAccessible(container);
  });

  it('folds a group away from the keyboard, keeping its count beside the label', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderNacre(
      <ChatListSection label="Work" collapsible count={2} onOpenChange={onOpenChange}>
        <ChatRow>
          <a href="#a">Hiring post</a>
        </ChatRow>
      </ChatListSection>,
    );
    const toggle = screen.getByRole('button', { name: /Work/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Hiring post' })).toBeInTheDocument();
    // Open: no count.
    expect(toggle).not.toHaveTextContent('2');

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAccessibleName('Work, 2 chats');

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('says where each chat is, after its title', () => {
    renderNacre(
      <ChatListSection label="Today">
        <ChatRow status="waiting">
          <a href="#a">Dentist</a>
        </ChatRow>
        <ChatRow status="unread">
          <a href="#b">Reading list</a>
        </ChatRow>
        <ChatRow status="working">
          <a href="#c">Board deck</a>
        </ChatRow>
        <ChatRow status="error">
          <a href="#d">Venue prices</a>
        </ChatRow>
      </ChatListSection>,
    );
    expect(screen.getByRole('link', { name: 'Dentist, Needs you' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reading list, New' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board deck, Working' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Venue prices, Didn’t finish' })).toBeInTheDocument();
  });

  it('ticks rows while choosing, by click or Space, and never opens them', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e: { defaultPrevented: boolean }) => e.defaultPrevented);
    function Demo() {
      const [selected, setSelected] = useState(false);
      return (
        <ul>
          <ChatRow selecting selected={selected} onSelectedChange={setSelected} menu={more('Trip')}>
            <a href="#trip" onClick={onNavigate}>
              Trip
            </a>
          </ChatRow>
        </ul>
      );
    }
    renderNacre(<Demo />);
    const box = screen.getByRole('checkbox', { name: 'Trip' });
    expect(box).not.toBeChecked();
    // The ⋯ steps aside while choosing.
    expect(screen.queryByRole('button', { name: 'Options for Trip' })).not.toBeInTheDocument();

    // The link steps out of the tab order; the tick box is the stop.
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toBeChecked();

    await user.click(screen.getByRole('link', { name: 'Trip' }));
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('asks to start choosing on a Shift- or ⌘-click instead of opening', async () => {
    const user = userEvent.setup();
    const onSelectRequest = vi.fn();
    const onNavigate = vi.fn();
    renderNacre(
      <ul>
        <ChatRow onSelectRequest={onSelectRequest}>
          <a href="#trip" onClick={onNavigate}>
            Trip
          </a>
        </ChatRow>
      </ul>,
    );
    const link = screen.getByRole('link', { name: 'Trip' });
    await user.keyboard('{Shift>}');
    await user.click(link);
    await user.keyboard('{/Shift}');
    expect(onSelectRequest).toHaveBeenCalledTimes(1);
    expect(onSelectRequest.mock.calls[0]?.[0]).toMatchObject({ shiftKey: true });
    expect(onNavigate).not.toHaveBeenCalled();

    await user.keyboard('{Meta>}');
    await user.click(link);
    await user.keyboard('{/Meta}');
    expect(onSelectRequest).toHaveBeenCalledTimes(2);

    await user.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('takes dropped chats, lighting up while they are over it', () => {
    const onDropChats = vi.fn();
    renderNacre(
      <ChatListSection label="Pinned" onDropChats={onDropChats} dropHint="Drop to pin">
        <ChatRow>
          <a href="#a">Trip</a>
        </ChatRow>
      </ChatListSection>,
    );
    const section = screen.getByRole('region', { name: 'Pinned' });
    const dataTransfer = chatDrop(['a', 'b']);
    fireEvent.dragEnter(section, { dataTransfer });
    fireEvent.dragOver(section, { dataTransfer });
    expect(section).toHaveAttribute('data-drop-over');
    expect(within(section).getByText('Drop to pin')).toBeInTheDocument();
    expect(dataTransfer.dropEffect).toBe('move');

    fireEvent.drop(section, { dataTransfer });
    expect(onDropChats).toHaveBeenCalledWith(['a', 'b']);
    expect(section).not.toHaveAttribute('data-drop-over');
  });

  it('ignores drags that are not chats', () => {
    const onDropChats = vi.fn();
    renderNacre(<ChatListSection label="Pinned" onDropChats={onDropChats} />);
    const section = screen.getByRole('region', { name: 'Pinned' });
    const dataTransfer = { types: ['Files'], getData: () => '', dropEffect: 'none' };
    fireEvent.dragEnter(section, { dataTransfer });
    expect(section).not.toHaveAttribute('data-drop-over');
    fireEvent.drop(section, { dataTransfer });
    expect(onDropChats).not.toHaveBeenCalled();
  });

  it('puts a dragged row’s chats on the drag', () => {
    const setData = vi.fn();
    renderNacre(
      <ul>
        <ChatRow dragIds={['a', 'b']}>
          <a href="#a">Trip</a>
        </ChatRow>
      </ul>,
    );
    const item = screen.getByRole('listitem');
    fireEvent.dragStart(item, { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith(CHAT_DRAG_TYPE, JSON.stringify(['a', 'b']));
    expect(setData).toHaveBeenCalledWith('text/plain', 'Trip');
    expect(item).toHaveAttribute('data-dragging');
    fireEvent.dragEnd(item);
    expect(item).not.toHaveAttribute('data-dragging');
  });

  it('counts what is chosen, and Escape puts the bar away', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { container } = renderNacre(
      <SelectionBar count={3} onDone={onDone}>
        <IconButton size="sm" label="Archive">
          <MoreHorizontal />
        </IconButton>
      </SelectionBar>,
    );
    expect(screen.getByText('3 selected')).toHaveAttribute('aria-live', 'polite');
    await user.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(2);
    await expectAccessible(container);
  });

  it('makes a folder with a name, a colour and a glyph', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    renderNacre(<FolderDialog open onOpenChange={onOpenChange} mode="new" onSave={onSave} />);
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();

    // No name, no folder: Enter does nothing and the button waits.
    const create = within(dialog).getByRole('button', { name: 'Create folder' });
    expect(create).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();

    await user.type(name, '  Work  ');
    await user.click(within(dialog).getByRole('radio', { name: 'Green' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Briefcase' }));
    await user.click(name);
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith({ name: 'Work', glyph: 'briefcase', color: 'green' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edits a folder, starting from what it is', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderNacre(
      <FolderDialog
        open
        onOpenChange={() => undefined}
        mode="edit"
        initial={{ name: 'Home', glyph: 'house', color: 'teal' }}
        onSave={onSave}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit folder' });
    expect(within(dialog).getByRole('radio', { name: 'Teal' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'House' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Home', glyph: 'house', color: 'teal' });
  });

  it('picks a look from the keyboard', async () => {
    const user = userEvent.setup();
    function Demo() {
      const [look, setLook] = useState({ glyph: 'folder', color: 'blue' } as const);
      return (
        <>
          <MarkPicker
            value={look}
            onChange={(next) => setLook(next as typeof look)}
            aria-label="Look"
          />
          <output>{`${look.color} ${look.glyph}`}</output>
        </>
      );
    }
    const { container } = renderNacre(<Demo />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveFocus();
    // Held, as a person's finger is when Radix checks the radio it moved to.
    await user.keyboard('{ArrowRight>}');
    expect(screen.getByRole('radio', { name: 'Indigo' })).toHaveFocus();
    await user.keyboard('{/ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('indigo folder');

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Folder' })).toHaveFocus();
    await user.keyboard('{ArrowRight>}');
    expect(screen.getByRole('radio', { name: 'Briefcase' })).toHaveFocus();
    await user.keyboard('{/ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('indigo briefcase');
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Icon' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens a pinned app from the dock, saying where it is from', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderNacre(
      <AppDock
        items={[
          {
            key: 'tally',
            label: 'Tally',
            icon: <AppIcon glyph="wallet" color="green" />,
            source: 'Page of the Tally app',
            active: true,
            onOpen,
          },
          {
            key: 'runs',
            label: 'Running log',
            icon: <AppIcon glyph="activity" color="orange" />,
            source: 'Page of the Running log app',
            status: 'unread',
            onOpen: () => undefined,
          },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Pinned apps' })).toBeInTheDocument();
    const tally = screen.getByRole('button', { name: 'Tally' });
    expect(tally).toHaveAccessibleDescription('Page of the Tally app');
    expect(tally).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Running log' })).toHaveAccessibleDescription(
      'Page of the Running log app, New',
    );
    await user.click(tally);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers to tidy up, in a month or in days', () => {
    const { rerender } = renderNacre(
      <TidyCard count={9} days={30} onTidy={() => undefined} onDismiss={() => undefined} />,
    );
    expect(screen.getByText('9 chats you haven’t opened in a month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive them' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    rerender(<TidyCard count={1} days={14} onTidy={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByText('1 chat you haven’t opened in 14 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive it' })).toBeInTheDocument();
  });

  it('marks where a dragged chat would land, and passes drag handlers to the row', () => {
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    const onDoubleClick = vi.fn();
    const { rerender } = renderNacre(
      <ul>
        <ChatRow onDragOver={onDragOver} onDrop={onDrop} onDoubleClick={onDoubleClick}>
          <a href="#a">Trip</a>
        </ChatRow>
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(item).not.toHaveAttribute('data-drop-before');
    fireEvent.dragOver(item, { dataTransfer: chatDrop(['b']) });
    fireEvent.drop(item, { dataTransfer: chatDrop(['b']) });
    fireEvent.doubleClick(item);
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
    rerender(
      <ul>
        <ChatRow dropBefore>
          <a href="#a">Trip</a>
        </ChatRow>
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute('data-drop-before');
  });

  it('shows the editing field in place of the link', () => {
    renderNacre(
      <ul>
        <ChatRow editing={<input aria-label="Conversation title" defaultValue="Trip" />}>
          <a href="#a">Trip</a>
        </ChatRow>
      </ul>,
    );
    expect(screen.getByRole('textbox', { name: 'Conversation title' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('swipeOutcome', () => {
  const width = 300;

  it('springs back from a short, slow swipe', () => {
    expect(swipeOutcome(60, 0.1, width)).toBeNull();
    expect(swipeOutcome(-100, -0.2, width)).toBeNull();
    expect(swipeOutcome(0, 2, width)).toBeNull();
  });

  it('commits past 40% of the row', () => {
    expect(swipeOutcome(120, 0, width)).toBe('start');
    expect(swipeOutcome(-121, 0, width)).toBe('end');
  });

  it('commits a quick flick from a shorter swipe, but not a twitch', () => {
    expect(swipeOutcome(40, SWIPE_FLICK_SPEED, width)).toBe('start');
    expect(swipeOutcome(-40, -0.9, width)).toBe('end');
    expect(swipeOutcome(10, 2, width)).toBeNull();
  });

  it('cancels when flicked back the other way, even from far', () => {
    expect(swipeOutcome(200, -0.8, width)).toBeNull();
  });

  it('does nothing without a width', () => {
    expect(swipeOutcome(200, 1, 0)).toBeNull();
  });
});

describe('swipeOffset', () => {
  it('follows the finger towards a side with an action, up to the row', () => {
    expect(swipeOffset(80, 300, { start: true, end: false })).toBe(80);
    expect(swipeOffset(500, 300, { start: true, end: false })).toBe(300);
  });

  it('resists towards a side without one', () => {
    expect(swipeOffset(-60, 300, { start: true, end: false })).toBe(-10);
    expect(swipeOffset(-600, 300, { start: true, end: false })).toBe(-12);
  });
});
