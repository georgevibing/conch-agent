import type { ConversationSummary } from '@conch/protocol';
import {
  AlertDialog,
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
import { useQueryClient } from '@tanstack/react-query';
import {
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';

import { api } from '../../api/client';
import { keys, useAppState, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { dayGroup, type DayGroup } from '../../lib/time';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { ActivityLink } from '../activity/ActivityLink';
import { ChannelsLink } from '../channels/ChannelsLink';
import { PasswordsLink } from '../passwords/PasswordsLink';
import { APPS } from '../channels/describe';
import { IntegrationsLink } from '../integrations/IntegrationsLink';
import { RoutinesLink } from '../routines/RoutinesLink';
import { SkillsLink } from '../skills/SkillsLink';
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
  const client = useQueryClient();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  // The draft is taken from the current title when renaming starts — never a copy
  // made at mount, which would be the first-line placeholder, not the generated title.
  const [draft, setDraft] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const running =
    conversation.status === 'running' || conversation.status === 'awaiting-permission';

  const rename = async () => {
    const next = draft?.trim();
    setDraft(undefined);
    if (!next || next === conversation.title) return;
    try {
      await api.renameConversation(conversation.id, next);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    try {
      await api.deleteConversation(conversation.id);
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        (list ?? []).filter((c) => c.id !== conversation.id),
      );
      if (conversationId === conversation.id) void navigate('/');
    } catch (e) {
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
          <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={() => setConfirm(true)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Delete this conversation?</AlertDialog.Title>
            <AlertDialog.Description>
              “{conversation.title}” will be removed from Conch. Anything I remembered from it stays
              in memory.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void remove()}>
              Delete
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </li>
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
  // Updates wait quietly: a dot on Settings, never a toast.
  const updates = updatesWaiting(useUpdates().data);

  const groups = new Map<DayGroup, ConversationSummary[]>();
  // Routine runs live under Routines, not in your chat list.
  for (const c of (conversations ?? []).filter((c) => c.origin?.kind !== 'routine')) {
    const g = dayGroup(c.updatedAt);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }

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
        <RoutinesLink onNavigate={onNavigate} />
        <SkillsLink onNavigate={onNavigate} />
        <IntegrationsLink onNavigate={onNavigate} />
        <ChannelsLink onNavigate={onNavigate} />
        <PasswordsLink onNavigate={onNavigate} />
        <ActivityLink onNavigate={onNavigate} />
      </div>
      <ScrollArea className={styles.scroll}>
        {!isPending && (conversations?.length ?? 0) === 0 && (
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
      </ScrollArea>
      <div className={styles.footer}>
        <button type="button" className={styles.me} onClick={() => openSettings('about')}>
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
