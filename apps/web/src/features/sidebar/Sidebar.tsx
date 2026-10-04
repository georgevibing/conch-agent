import type { ConversationSummary } from '@conch/protocol';
import {
  Avatar,
  Button,
  DropdownMenu,
  IconButton,
  Input,
  Kbd,
  LiveTitle,
  IntegrationLogo,
  Pearl,
  ScrollArea,
  Text,
  cx,
  toast,
  Tooltip,
} from '@conch/nacre';
import {
  Archive,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';

import { api } from '../../api/client';
import { keys, useAppState, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { dayGroup, type DayGroup } from '../../lib/time';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { ActivityLink } from '../activity/ActivityLink';
import { DeleteChat } from '../archive/DeleteChat';
import { ARCHIVE_PATH, archivedChats, isChat, useArchive } from '../archive/useArchive';
import { PinnedApps } from '../artifacts/PinnedApps';
import { PasswordsLink } from '../passwords/PasswordsLink';
import { APPS } from '../channels/describe';
import { AppsLink } from '../integrations/AppsLink';
import { RoutinesLink } from '../routines/RoutinesLink';
import { SkillsLink } from '../skills/SkillsLink';
import { TasksLink } from '../tasks/TasksLink';
import { updatesWaiting, useUpdates } from '../updates/queries';
import styles from './Sidebar.module.css';

function RenameField({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useAutoFocus<HTMLInputElement>();
  return (
    <form
      className={styles.rename}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Input
        ref={ref}
        size="sm"
        aria-label="Conversation title"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
    </form>
  );
}

function ConversationRow({
  conversation,
  onNavigate,
}: {
  conversation: ConversationSummary;
  onNavigate?: () => void;
}) {
  const { archive, remove } = useArchive();
  const client = useQueryClient();
  // The draft is taken from the current title when renaming starts — never a copy
  // made at mount, which would be the first-line placeholder, not the generated title.
  const [draft, setDraft] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  // Stop pressed: the row is still the moment the chat is.
  const stopped = useLiveStore((s) => conversation.id in s.stopping);
  const running =
    !stopped &&
    (conversation.status === 'running' || conversation.status === 'awaiting-permission');

  const rename = async () => {
    const next = draft?.trim();
    setDraft(undefined);
    if (!next || next === conversation.title) return;
    // The new name shows at once; the old one comes back if it didn't save.
    const rename = (title: string) =>
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        list?.map((c) => (c.id === conversation.id ? { ...c, title } : c)),
      );
    const before = conversation.title;
    rename(next);
    try {
      await api.renameConversation(conversation.id, next);
    } catch (e) {
      rename(before);
      toast.error((e as Error).message);
    }
  };

  if (draft !== undefined) {
    return (
      <li className={styles.item}>
        <RenameField
          value={draft}
          onChange={setDraft}
          onSave={() => void rename()}
          onCancel={() => setDraft(undefined)}
        />
      </li>
    );
  }

  return (
    <li className={styles.item}>
      <NavLink
        to={`/c/${conversation.id}`}
        className={({ isActive }) => cx(styles.link, isActive && styles.active)}
        onClick={onNavigate}
      >
        {running && <Pearl size="xs" state="thinking" label="Working" className={styles.running} />}
        {conversation.origin?.kind === 'channel' && (
          <IntegrationLogo
            brand={conversation.origin.channel}
            name={APPS[conversation.origin.channel].name}
            color={APPS[conversation.origin.channel].color}
            size="xs"
            className={styles.origin}
          />
        )}
        <LiveTitle pending={conversation.titling} className={styles.title}>
          {conversation.title}
        </LiveTitle>
      </NavLink>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            size="sm"
            label={`Options for ${conversation.title}`}
            tooltip={false}
            className={styles.more}
          >
            <MoreHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.Item icon={<Pencil />} onSelect={() => setDraft(conversation.title)}>
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item icon={<Archive />} onSelect={() => void archive(conversation)}>
            Archive
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={() => setConfirm(true)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <DeleteChat
        chat={conversation}
        open={confirm}
        onOpenChange={setConfirm}
        onDelete={() => void remove(conversation)}
      />
    </li>
  );
}

/**
 * The quiet way into the archive, after the last of your chats. While an
 * archived chat is open, this is where you are.
 */
function ArchivedLink({
  count,
  here,
  onNavigate,
}: {
  count: number;
  here: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className={styles.archived}>
      <NavLink
        to={ARCHIVE_PATH}
        className={({ isActive }) =>
          cx(styles.link, styles.archivedLink, (isActive || here) && styles.active)
        }
        onClick={onNavigate}
      >
        <Archive aria-hidden className={styles.archivedIcon} />
        <span className={styles.title}>Archived</span>{' '}
        <span className={styles.count}>
          {count} <span className="nc-visually-hidden">{count === 1 ? 'chat' : 'chats'}</span>
        </span>
      </NavLink>
    </div>
  );
}

const order: DayGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier'];

export function Sidebar({
  onNavigate,
  collapsible = true,
}: {
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const { data: conversations, isPending } = useConversations();
  const { data: app } = useAppState();
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const openSettings = useUi((s) => s.openSettings);
  const setPalette = useUi((s) => s.setPalette);
  const navigate = useNavigate();
  const { conversationId } = useParams();
  // Updates wait quietly: a dot on Settings, never a toast.
  const updates = updatesWaiting(useUpdates().data);

  const groups = new Map<DayGroup, ConversationSummary[]>();
  // Routine runs live under Routines, tasks under Tasks, refreshes under their app, and
  // archived chats under Archived: not in your chat list.
  const chats = (conversations ?? []).filter((c) => isChat(c) && !c.archivedAt);
  for (const c of chats) {
    const g = dayGroup(c.updatedAt);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const inArchive = archivedChats(conversations);
  const archived = inArchive.length;

  return (
    <nav className={styles.sidebar} aria-label="Conversations">
      <div className={styles.brand}>
        <Pearl size="xs" label={null} />
        <span className={styles.wordmark}>{app?.persona.name ?? 'Conch'}</span>
        {collapsible && (
          <IconButton
            size="sm"
            label="Hide sidebar"
            shortcut="mod+b"
            onClick={toggleSidebar}
            className={styles.collapse}
          >
            <PanelLeftClose />
          </IconButton>
        )}
      </div>
      <div className={styles.newChat}>
        <Tooltip content="New chat" shortcut="mod+shift+o" side="right">
          <Button
            variant="surface"
            block
            leadingIcon={<SquarePen />}
            onClick={() => {
              void navigate('/');
              onNavigate?.();
            }}
            className={styles.newChatButton}
          >
            New chat
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          block
          leadingIcon={<Search />}
          onClick={() => {
            onNavigate?.();
            setPalette(true);
          }}
          className={cx(styles.newChatButton, styles.searchButton)}
        >
          Search
          <Kbd keys="mod+k" size="sm" aria-hidden />
        </Button>
        <TasksLink onNavigate={onNavigate} />
        <RoutinesLink onNavigate={onNavigate} />
        <SkillsLink onNavigate={onNavigate} />
        <AppsLink onNavigate={onNavigate} />
        <PasswordsLink onNavigate={onNavigate} />
        <ActivityLink onNavigate={onNavigate} />
      </div>
      <ScrollArea className={styles.scroll}>
        <PinnedApps onNavigate={onNavigate} />
        {!isPending && chats.length === 0 && (
          <Text size="sm" tone="subtle" className={styles.empty}>
            Your conversations will appear here.
          </Text>
        )}
        {order.map((group) => {
          const items = groups.get(group);
          if (!items?.length) return null;
          return (
            <section key={group} className={styles.group} aria-label={group}>
              <Text as="span" size="xs" weight="medium" tone="subtle" className={styles.groupLabel}>
                {group}
              </Text>
              <ul className={styles.list}>
                {items.map((c) => (
                  <ConversationRow key={c.id} conversation={c} onNavigate={onNavigate} />
                ))}
              </ul>
            </section>
          );
        })}
        {archived > 0 && (
          <ArchivedLink
            count={archived}
            here={inArchive.some((c) => c.id === conversationId)}
            onNavigate={onNavigate}
          />
        )}
      </ScrollArea>
      <div className={styles.footer}>
        <button type="button" className={styles.me} onClick={() => openSettings()}>
          <Avatar size="sm" name={app?.profile.name || 'You'} />
          <span className={styles.meName}>{app?.profile.name || 'You'}</span>
        </button>
        <IconButton
          size="sm"
          label="Settings"
          shortcut="mod+,"
          dot={updates ? 'Update available' : undefined}
          onClick={() => openSettings()}
        >
          <Settings />
        </IconButton>
      </div>
    </nav>
  );
}
