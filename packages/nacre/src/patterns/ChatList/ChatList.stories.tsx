import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Archive,
  ChartColumn,
  FileText,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { fn } from 'storybook/test';

import { DropdownMenu } from '../../components/DropdownMenu';
import { ContextMenu } from '../../components/ContextMenu';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { AppIcon } from '../ConchApps/AppIcon';
import { APP_COLORS, APP_GLYPHS } from '../ConchApps/glyphs';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { AppDock, DockGlyph, type AppDockItem } from './AppDock';
import { AppFolder } from './AppFolder';
import { ChatListSection } from './ChatListSection';
import { ChatRow, ChatRowSkeleton, type ChatStatus } from './ChatRow';
import { FolderDialog } from './FolderDialog';
import { FolderMark } from './FolderMark';
import { SelectionBar } from './SelectionBar';
import { TidyCard } from './TidyCard';

interface PlaygroundArgs {
  title: string;
  status?: ChatStatus;
  active: boolean;
  selecting: boolean;
  selected: boolean;
  fromTelegram: boolean;
}

const meta = {
  title: 'Patterns/Chat/ChatList',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pieces of the chat list in the sidebar. **Rows** keep today’s calm look (muted text, the open chat lifted onto the surface, ⋯ on hover) and add where each chat is: a breathing pearl while Conch works, an amber dot that softly calls when it needs you, an accent dot and a firmer title for something new, a hollow ring when a turn didn’t finish — each also said aloud, never colour alone. **Groups** hold Pinned and stretches of time under quiet labels, and **folders**, named like rows (a glyph on a wash of its colour, the name at a chat’s size, folding away with a count, with a button to start a chat inside). Pinned pages sit above as a **dock of app icons** under a quiet **Apps** heading, so they read as apps, not chats; past two rows the last tile is **All apps**, an iOS-style **folder** of every app with a search and keyboard moves. Choosing several brings up a **bar**; chats drag onto a folder or Pinned on a computer; on a phone they swipe, and a hold lifts one to be dragged. A quiet **tidy-up** offer sits at the very end, never a warning.',
      },
    },
  },
  args: {
    title: 'Plan a week in Lisbon',
    status: undefined,
    active: false,
    selecting: false,
    selected: false,
    fromTelegram: false,
  },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: [undefined, 'working', 'waiting', 'unread', 'error'],
    },
  },
  decorators: [
    (Story) => (
      <div style={sidebar}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<PlaygroundArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

const sidebar: CSSProperties = {
  inlineSize: '17rem',
  background: 'var(--nc-canvas-raised)',
  borderRadius: 'var(--nc-radius-lg)',
  boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
  paddingBlock: 'var(--nc-space-1)',
};

function RowMenu({ title, pinned }: { title: string; pinned?: boolean }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton size="sm" label={`Options for ${title}`} tooltip={false}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item icon={pinned ? <PinOff /> : <Pin />}>
          {pinned ? 'Unpin' : 'Pin'}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<FolderInput />}>Move to…</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Pencil />}>Rename</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Archive />}>Archive</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={<Trash2 />} tone="danger">
          Delete
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function RowContext({ pinned }: { pinned?: boolean }) {
  return (
    <>
      <ContextMenu.Item icon={pinned ? <PinOff /> : <Pin />}>
        {pinned ? 'Unpin' : 'Pin'}
      </ContextMenu.Item>
      <ContextMenu.Item icon={<FolderInput />}>Move to…</ContextMenu.Item>
      <ContextMenu.Item icon={<Pencil />}>Rename</ContextMenu.Item>
      <ContextMenu.Item icon={<Archive />}>Archive</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item icon={<Trash2 />} tone="danger">
        Delete
      </ContextMenu.Item>
    </>
  );
}

const telegram = <IntegrationLogo brand="telegram" name="Telegram" size="xs" />;

interface Chat {
  id: string;
  title: string;
  status?: ChatStatus;
  leading?: ReactNode;
  active?: boolean;
  pinned?: boolean;
}

function Row({ chat }: { chat: Chat }) {
  return (
    <ChatRow
      status={chat.status}
      leading={chat.leading}
      active={chat.active}
      dragIds={[chat.id]}
      menu={<RowMenu title={chat.title} pinned={chat.pinned} />}
      contextMenu={<RowContext pinned={chat.pinned} />}
      swipeStart={{ label: chat.pinned ? 'Unpin' : 'Pin', icon: <Pin />, onAction: fn() }}
      swipeEnd={{ label: 'Archive', icon: <Archive />, tone: 'danger', onAction: fn() }}
    >
      <a href={`#${chat.id}`}>{chat.title}</a>
    </ChatRow>
  );
}

function FolderActions({ name }: { name: string }) {
  return (
    <>
      <IconButton size="sm" label={`New chat in ${name}`} onClick={fn()}>
        <SquarePen />
      </IconButton>
      <IconButton size="sm" label={`Options for ${name}`} tooltip={false}>
        <MoreHorizontal />
      </IconButton>
    </>
  );
}

export const Playground: Story = {
  render: ({ title, status, active, selecting, selected, fromTelegram }) => (
    <ChatListSection label="Today">
      <ChatRow
        status={status}
        active={active}
        selecting={selecting}
        selected={selected}
        leading={fromTelegram ? telegram : undefined}
        menu={<RowMenu title={title} />}
        contextMenu={<RowContext />}
        onSelectRequest={fn()}
        onSelectedChange={fn()}
      >
        <a href="#chat">{title}</a>
      </ChatRow>
      <ChatRow menu={<RowMenu title="Groceries for Sunday" />}>
        <a href="#other">Groceries for Sunday</a>
      </ChatRow>
    </ChatListSection>
  ),
};

/**
 * Where each chat is. Working leads with the pearl, as today. The dots sit at
 * the ⋯’s place and give way to it under the pointer: amber calls softly for
 * “Needs you”, the accent marks “New” (with a firmer title), and a hollow ring
 * says “Didn’t finish”. Each is also read after the title.
 */
export const Statuses: Story = {
  render: () => (
    <ChatListSection label="Today">
      <Row chat={{ id: 'a', title: 'Summarise the board deck', status: 'working' }} />
      <Row chat={{ id: 'b', title: 'Book the dentist for Friday', status: 'waiting' }} />
      <Row chat={{ id: 'c', title: 'Weekly reading list', status: 'unread' }} />
      <Row chat={{ id: 'd', title: 'Scrape the venue prices', status: 'error' }} />
      <Row chat={{ id: 'e', title: 'Plan a week in Lisbon', active: true }} />
      <Row chat={{ id: 'f', title: 'Groceries for Sunday', leading: telegram }} />
    </ChatListSection>
  ),
};

function SelectingDemo() {
  const chats = [
    'Plan a week in Lisbon',
    'Groceries for Sunday',
    'Testing OpenRouter connectivity',
    'Quarterly planning offsite agenda',
    'Fix the flaky backup test',
  ];
  const [selecting, setSelecting] = useState(true);
  const [chosen, setChosen] = useState<Set<number>>(new Set([0, 2]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minBlockSize: '20rem' }}>
      <ChatListSection label="Previous 7 days">
        {chats.map((title, i) => (
          <ChatRow
            key={title}
            selecting={selecting}
            selected={chosen.has(i)}
            onSelectedChange={(on) =>
              setChosen((prev) => {
                const next = new Set(prev);
                if (on) next.add(i);
                else next.delete(i);
                return next;
              })
            }
            onSelectRequest={() => {
              setSelecting(true);
              setChosen(new Set([i]));
            }}
            menu={<RowMenu title={title} />}
          >
            <a href={`#${i}`}>{title}</a>
          </ChatRow>
        ))}
      </ChatListSection>
      <div style={{ flex: 1 }} />
      {selecting && (
        <SelectionBar
          count={chosen.size}
          onDone={() => {
            setSelecting(false);
            setChosen(new Set());
          }}
        >
          <IconButton size="sm" label="Pin">
            <Pin />
          </IconButton>
          <IconButton size="sm" label="Move to…">
            <FolderInput />
          </IconButton>
          <IconButton size="sm" label="Archive">
            <Archive />
          </IconButton>
          <IconButton size="sm" label="Delete">
            <Trash2 />
          </IconButton>
        </SelectionBar>
      )}
    </div>
  );
}

/**
 * Choosing several: a tick box leads each row, a press ticks instead of
 * opening, and the bar rises at the foot with what can be done. Shift-, ⌘- or
 * Ctrl-click a row to start; Done or Escape to stop.
 */
export const Selecting: Story = { render: () => <SelectingDemo /> };

/**
 * On a phone, swipe a row right to pin it, left to archive it. The row
 * follows the finger over the action's colour; past 40% (or with a quick
 * flick) letting go does it, with a light tap of haptics, and otherwise it
 * springs back. Up and down still scroll. To try it here, open the story in a
 * phone simulator or the browser's device mode (touch events), and swipe a
 * row.
 */
export const Swipe: Story = {
  render: () => (
    <ChatListSection label="Today">
      <Row chat={{ id: 'a', title: 'Plan a week in Lisbon' }} />
      <Row chat={{ id: 'b', title: 'Groceries for Sunday', pinned: true }} />
      <Row chat={{ id: 'c', title: 'Testing OpenRouter connectivity' }} />
    </ChatListSection>
  ),
};

/**
 * Folders are places of your own, so they read like rows, not labels: the
 * name as large as a chat's, in full colour and a touch heavier, beside a
 * mark you can make out (a glyph on a soft wash of its colour, never a solid
 * tile — those are apps). The whole line folds it away, keeping how many
 * chats are inside at its end. Its chats sit in under its name. At the
 * line's end, under the pointer (always on touch): **New chat in Work**
 * starts a chat already inside it, and ⋯ edits or removes it. A folder
 * with nothing in it says how to fill it.
 */
export const Folders: Story = {
  render: () => (
    <>
      <ChatListSection
        kind="folder"
        label="Work"
        icon={<FolderMark glyph="briefcase" color="blue" />}
        collapsible
        count={3}
        actions={<FolderActions name="Work" />}
      >
        <Row chat={{ id: 'w1', title: 'Quarterly planning offsite agenda' }} />
        <Row chat={{ id: 'w2', title: 'Draft the hiring post', status: 'unread' }} />
        <Row chat={{ id: 'w3', title: 'Summarise the board deck' }} />
      </ChatListSection>
      <ChatListSection
        kind="folder"
        label="Home"
        icon={<FolderMark glyph="house" color="green" />}
        collapsible
        defaultOpen={false}
        count={5}
        actions={<FolderActions name="Home" />}
      >
        <Row chat={{ id: 'h1', title: 'Boiler service quotes' }} />
      </ChatListSection>
      <ChatListSection
        kind="folder"
        label="Side projects"
        icon={<FolderMark glyph="lightbulb" color="amber" />}
        collapsible
        count={0}
        actions={<FolderActions name="Side projects" />}
        empty="Drag chats here, or choose Move to."
      />
    </>
  ),
};

function HoldDemo() {
  const [where, setWhere] = useState<Record<string, 'work' | 'home' | 'today'>>({
    a: 'today',
    b: 'today',
    c: 'today',
    d: 'work',
  });
  const titles: Record<string, string> = {
    a: 'Plan a week in Lisbon',
    b: 'Groceries for Sunday',
    c: 'Testing OpenRouter connectivity',
    d: 'Quarterly planning offsite agenda',
  };
  const move = (to: 'work' | 'home' | 'today') => (ids: string[]) =>
    setWhere((w) => ({ ...w, ...Object.fromEntries(ids.map((id) => [id, to])) }));
  const rows = (place: 'work' | 'home' | 'today') =>
    Object.entries(where)
      .filter(([, at]) => at === place)
      .map(([id]) => <Row key={id} chat={{ id, title: titles[id] ?? id }} />);
  return (
    <>
      {(['work', 'home'] as const).map((place) => (
        <ChatListSection
          key={place}
          kind="folder"
          label={place === 'work' ? 'Work' : 'Home'}
          icon={
            <FolderMark
              glyph={place === 'work' ? 'briefcase' : 'house'}
              color={place === 'work' ? 'blue' : 'green'}
            />
          }
          collapsible
          count={rows(place).length}
          actions={<FolderActions name={place === 'work' ? 'Work' : 'Home'} />}
          onDropChats={move(place)}
          dropHint={`Drop to move to ${place === 'work' ? 'Work' : 'Home'}`}
          empty="Hold a chat to drag it here, or choose Move to."
        >
          {rows(place)}
        </ChatListSection>
      ))}
      <ChatListSection
        label="Today"
        onDropChats={move('today')}
        dropHint="Drop to take out of a folder"
      >
        {rows('today')}
      </ChatListSection>
    </>
  );
}

/**
 * On a phone, hold a chat for a moment and it lifts off the list, with a
 * light tap of haptics where the phone has them. Move the finger and it
 * comes along: every place that takes chats shows a faint ring, the one
 * under the finger fills and says what letting go does, and the list
 * scrolls by itself near its top and bottom. Let go on a folder and the chat
 * moves there; anywhere else and it glides back. Let go without moving and
 * the row's menu opens, as a hold always did. A finger that moves first is
 * scrolling or swiping, and is left alone. Try it in a phone simulator or
 * the browser's device mode.
 */
export const HoldToDrag: Story = { render: () => <HoldDemo /> };

/** A held row, lifted under the finger before it moves (forced on here). */
export const Lifted: Story = {
  render: () => (
    <ChatListSection label="Today">
      <Row chat={{ id: 'a', title: 'Plan a week in Lisbon' }} />
      <ChatRow data-held="lifted" dragIds={['b']}>
        <a href="#b">Groceries for Sunday</a>
      </ChatRow>
      <Row chat={{ id: 'c', title: 'Testing OpenRouter connectivity' }} />
    </ChatListSection>
  ),
};

/**
 * While chats are dragged, places that take them show a faint ring; the one
 * under the pointer fills with a wash of the accent and says what letting go
 * will do. Reordering Pinned, a line marks where a chat dropped on a row will
 * land (`dropBefore`). (Forced on here with `data-drop-ready`, `data-drop-over`.)
 */
export const DropTarget: Story = {
  render: () => (
    <>
      <ChatListSection
        label="Pinned"
        onDropChats={fn()}
        dropHint="Drop to pin"
        data-drop-ready=""
        data-drop-over=""
      >
        <Row chat={{ id: 'p1', title: 'Weekly reading list', pinned: true }} />
      </ChatListSection>
      <ChatListSection label="Pinned, reordering">
        <Row chat={{ id: 'r1', title: 'Weekly reading list', pinned: true }} />
        {/* A chat dragged onto this row lands just above it. */}
        <ChatRow dropBefore menu={<RowMenu title="Summarise the board deck" pinned />}>
          <a href="#r2">Summarise the board deck</a>
        </ChatRow>
        <Row chat={{ id: 'r3', title: 'Sourdough starter schedule', pinned: true }} />
      </ChatListSection>
      <ChatListSection
        kind="folder"
        label="Work"
        icon={<FolderMark glyph="briefcase" color="blue" />}
        collapsible
        defaultOpen={false}
        count={3}
        onDropChats={fn()}
        dropHint="Move to Work"
        data-drop-ready=""
      >
        <Row chat={{ id: 'w1', title: 'Quarterly planning offsite agenda' }} />
      </ChatListSection>
    </>
  ),
};

function DockMenu() {
  return (
    <>
      <ContextMenu.Item>Open</ContextMenu.Item>
      <ContextMenu.Item>About this app</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item icon={<PinOff />}>Unpin</ContextMenu.Item>
    </>
  );
}

const dockItems: AppDockItem[] = [
  {
    key: 'tally',
    label: 'Tally',
    icon: <AppIcon glyph="wallet" color="green" />,
    source: 'Page of the Tally app',
    active: true,
    onOpen: fn(),
    menu: <DockMenu />,
  },
  {
    key: 'plants',
    label: 'Plant diary',
    icon: <AppIcon glyph="sprout" color="lime" />,
    source: 'Page of the Plant diary app',
    onOpen: fn(),
    menu: <DockMenu />,
  },
  {
    key: 'runs',
    label: 'Running log',
    icon: <AppIcon glyph="activity" color="orange" />,
    source: 'Page of the Running log app',
    status: 'unread',
    onOpen: fn(),
    menu: <DockMenu />,
  },
  {
    key: 'sales',
    label: 'Q3 sales',
    icon: <DockGlyph icon={<ChartColumn />} color="indigo" />,
    source: 'Made in a chat',
    onOpen: fn(),
    menu: <DockMenu />,
  },
  {
    key: 'notes',
    label: 'Trip notes',
    icon: <DockGlyph icon={<FileText />} />,
    source: 'Made in a chat',
    onOpen: fn(),
    menu: <DockMenu />,
  },
];

/**
 * Pinned pages as a dock of app icons: four to a row, the name beneath, the
 * open one marked with a small dot like a running app. A Conch app's page
 * wears its app's icon; a page made in a chat wears a glyph on the same
 * glazed tile, so the row reads as one set of apps. Hover for where each is
 * from; right-click (or long-press) for Open, About and Unpin.
 */
export const Dock: Story = {
  render: () => <AppDock items={dockItems} />,
};

const APP_NAMES = [
  'Tally',
  'Plant diary',
  'Running log',
  'Recipes',
  'Reading list',
  'Habit streaks',
  'Trip planner',
  'Garden map',
  'Budget',
  'Café finder',
  'Workouts',
  'Film club',
  'Bird log',
  'Mood journal',
  'Chores',
  'Wine cellar',
  'Sleep',
  'Invoices',
  'Flashcards',
  'Guitar tabs',
  'Meal plan',
  'Water',
  'Bike rides',
  'Dog walks',
  'Board games',
  'Gift ideas',
  'Car service',
  'Tides',
  'Star chart',
  'Vinyl',
  'Podcasts',
  'Weather',
  'Allotment',
  'Knitting',
  'Climbing',
  'Pantry',
  'Bills',
  'Language',
  'Photo diary',
  'Birthdays',
  'Moving house',
  'Sourdough',
  'Chess',
  'Swim times',
  'Packing',
  'Coffee beans',
  'Hikes',
  'Book club',
  'Piano practice',
  'Wishlist',
];

/** Fifty apps, the way a busy sidebar fills up: a Conch app's icon each, a few with a dot. */
const manyApps: AppDockItem[] = APP_NAMES.map((name, i) => ({
  key: `app-${i}`,
  label: name,
  icon: (
    <AppIcon
      glyph={APP_GLYPHS[(i * 7) % APP_GLYPHS.length] ?? 'sparkles'}
      color={APP_COLORS[i % APP_COLORS.length] ?? 'slate'}
    />
  ),
  source: `The ${name} app`,
  active: i === 0,
  status: i === 2 ? 'unread' : i === 12 ? 'waiting' : undefined,
  onOpen: fn(),
  menu: <DockMenu />,
}));

const openApps = (
  <Button variant="ghost" size="sm">
    Open Apps
  </Button>
);

/**
 * Three pinned apps: the quiet **Apps** heading over one short row. Nothing
 * else until there are more than fit.
 */
export const DockFew: Story = {
  render: () => <AppDock items={dockItems.slice(0, 3)} />,
};

/**
 * Fifty pinned apps. The sidebar keeps two rows: seven apps, then **All apps**,
 * a folder of the rest in miniature, wearing the most pressing dot inside it
 * (one is waiting for you). Press it for every app at once.
 */
export const DockMany: Story = {
  render: () => <AppDock items={manyApps} folderActions={openApps} />,
};

/**
 * All apps, open: it grows out of the tile that opened it into a grid with a
 * search at the top, like a folder on a phone. Type to find (“cafe” finds
 * Café finder), ↓ into the grid, the arrows by tile and by row, Enter opens,
 * Escape folds it back.
 */
export const Folder: Story = {
  render: () => <FolderDemo />,
};

function FolderDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>All apps</Button>
      <AppFolder open={open} onOpenChange={setOpen} items={manyApps} actions={openApps} />
    </>
  );
}

function FolderDialogDemo({ mode }: { mode: 'new' | 'edit' }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <FolderDialog
        open={open}
        onOpenChange={setOpen}
        mode={mode}
        initial={mode === 'edit' ? { name: 'Work', glyph: 'briefcase', color: 'blue' } : undefined}
        onSave={fn()}
      />
    </>
  );
}

/** A name, a colour and a glyph, with the folder previewed as it'll sit in the list. */
export const NewFolder: Story = { render: () => <FolderDialogDemo mode="new" /> };

export const EditFolder: Story = { render: () => <FolderDialogDemo mode="edit" /> };

/** The quiet offer at the end of the list. Never a warning; Not now means not now. */
export const Tidy: Story = {
  render: () => (
    <>
      <TidyCard count={14} days={30} onTidy={fn()} onDismiss={fn()} />
      <TidyCard count={6} days={14} onTidy={fn()} onDismiss={fn()} />
    </>
  ),
};

/** While the list loads. */
export const Loading: Story = {
  render: () => (
    <ChatListSection label="Today" aria-busy>
      <ChatRowSkeleton width="72%" />
      <ChatRowSkeleton width="54%" />
      <ChatRowSkeleton width="64%" />
    </ChatListSection>
  ),
};

/**
 * The whole list as it sits in the sidebar: pinned pages as a dock, what
 * needs you, Pinned, two folders (one folded away), then the months, the
 * way into the archive, and a tidy-up offer at the end.
 */
export const Sidebar: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <>
      <AppDock items={dockItems} />
      <ChatListSection label="Needs you">
        <Row chat={{ id: 'n1', title: 'Book the dentist for Friday', status: 'waiting' }} />
      </ChatListSection>
      <ChatListSection label="Pinned" onDropChats={fn()} dropHint="Drop to pin">
        <Row chat={{ id: 'p1', title: 'Weekly reading list', pinned: true }} />
        <Row
          chat={{ id: 'p2', title: 'Summarise the board deck', status: 'working', pinned: true }}
        />
      </ChatListSection>
      <ChatListSection
        kind="folder"
        label="Work"
        icon={<FolderMark glyph="briefcase" color="blue" />}
        collapsible
        count={2}
        actions={<FolderActions name="Work" />}
        onDropChats={fn()}
        dropHint="Move to Work"
      >
        <Row chat={{ id: 'w1', title: 'Quarterly planning offsite agenda' }} />
        <Row chat={{ id: 'w2', title: 'Draft the hiring post' }} />
      </ChatListSection>
      <ChatListSection
        kind="folder"
        label="Home"
        icon={<FolderMark glyph="house" color="green" />}
        collapsible
        defaultOpen={false}
        count={5}
        actions={<FolderActions name="Home" />}
        onDropChats={fn()}
        dropHint="Move to Home"
      >
        <Row chat={{ id: 'h1', title: 'Boiler service quotes' }} />
      </ChatListSection>
      <ChatListSection label="Today">
        <Row chat={{ id: 't1', title: 'Plan a week in Lisbon', active: true }} />
        <Row chat={{ id: 't2', title: 'Groceries for Sunday', leading: telegram }} />
        <Row chat={{ id: 't3', title: 'What to read after Piranesi', status: 'unread' }} />
      </ChatListSection>
      <ChatListSection label="Yesterday">
        <Row chat={{ id: 'y1', title: 'Testing OpenRouter connectivity' }} />
        <Row chat={{ id: 'y2', title: 'Fix the flaky backup test', status: 'error' }} />
      </ChatListSection>
      <ChatListSection label="Previous 7 days">
        <Row chat={{ id: 's1', title: 'Rewrite the landing page hero' }} />
        <Row chat={{ id: 's2', title: 'Birthday ideas for Maya' }} />
      </ChatListSection>
      <ChatListSection label="Previous 30 days">
        <Row chat={{ id: 'm1', title: 'Compare health insurance plans' }} />
      </ChatListSection>
      <ChatListSection label="September">
        <Row chat={{ id: 'sep1', title: 'Explain this TypeScript error' }} />
        <Row chat={{ id: 'sep2', title: 'Sourdough starter schedule' }} />
      </ChatListSection>
      <ChatListSection label="August 2025">
        <Row chat={{ id: 'aug1', title: 'Packing list for Crete' }} />
      </ChatListSection>
      <ul style={{ margin: 0, padding: '0 var(--nc-space-2) var(--nc-space-1)' }}>
        <ChatRow
          quiet
          leading={<Archive aria-hidden />}
          trailing={
            <>
              12 <span className="nc-visually-hidden">chats</span>
            </>
          }
        >
          <a href="#archived">Archived</a>
        </ChatRow>
      </ul>
      <TidyCard count={9} days={30} onTidy={fn()} onDismiss={fn()} />
    </>
  ),
};

/** A folder's mark at its three sizes, in a few colours. */
export const FolderMarks: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
      <FolderMark glyph="briefcase" color="blue" />
      <FolderMark glyph="house" color="green" />
      <FolderMark glyph="heart" color="pink" />
      <FolderMark glyph="code" color="violet" />
      <FolderMark glyph="plane" color="teal" />
      <FolderMark glyph="graduation-cap" color="amber" />
      <FolderMark glyph="list-checks" color="slate" />
      <FolderMark glyph="book-open" color="orange" size="md" />
      <FolderMark glyph="lightbulb" color="red" size="xs" />
    </div>
  ),
};
