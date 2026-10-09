import { avatarUrl } from '@conch/protocol';
import { Avatar, Button, cx, IconButton, Kbd, Tooltip, UpdateChip } from '@conch/nacre';
import { PanelLeftClose, Search, Settings, SquarePen } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useUi } from '../../app/ui';
import { ActivityLink } from '../activity/ActivityLink';
import { ChatList } from '../chatlist/ChatList';
import { PasswordsLink } from '../passwords/PasswordsLink';
import { AppsLink } from '../integrations/AppsLink';
import { RoutinesLink } from '../routines/RoutinesLink';
import { SkillsLink } from '../skills/SkillsLink';
import { BackgroundPulse } from '../tasks/BackgroundPulse';
import { updatesWaiting, useUpdates } from '../updates/queries';
import { chipView } from '../updates/view';
import styles from './Sidebar.module.css';

export function Sidebar({
  onNavigate,
  collapsible = true,
}: {
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const { data: app } = useAppState();
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const openSettings = useUi((s) => s.openSettings);
  const setPalette = useUi((s) => s.setPalette);
  const navigate = useNavigate();
  // Updates wait quietly: a dot on Settings, never a toast. Conch's own is one
  // press away beside your name.
  const { data: updateStatus } = useUpdates();
  const updates = updatesWaiting(updateStatus);
  const chip = chipView(updateStatus);
  const openUpdate = useUi((s) => s.openUpdate);

  return (
    <nav className={styles.sidebar} aria-label="Conversations">
      <div className={styles.brand}>
        {/* The pearl says what's going on in the background, and lists it (ADR 0033). */}
        <BackgroundPulse
          className={styles.wordmark}
          onNavigate={onNavigate}
          bound={collapsible && sidebarOpen}
        >
          {app?.persona.name ?? 'Conch'}
        </BackgroundPulse>
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
        <AppsLink onNavigate={onNavigate} />
        <PasswordsLink onNavigate={onNavigate} />
        <ActivityLink onNavigate={onNavigate} />
      </div>
      <ChatList onNavigate={onNavigate} />
      <div className={styles.footer}>
        <button type="button" className={styles.me} onClick={() => openSettings('memory')}>
          <Avatar
            size="sm"
            name={app?.profile.name || 'You'}
            src={app ? avatarUrl(app.profile) : undefined}
          />
          <span className={styles.meName}>{app?.profile.name || 'You'}</span>
        </button>
        {chip && (
          <UpdateChip
            state={chip.state}
            value={chip.value}
            aria-label={chip.label}
            onClick={() => openUpdate()}
          />
        )}
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
