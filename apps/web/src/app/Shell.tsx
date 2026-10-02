import { IconButton, LiveTitle, Sheet, Spinner, Text, useMediaQuery } from '@conch/nacre';
import { Menu, PanelLeftOpen, TextSearch } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { useConversations } from '../api/queries';
import { ActivityView } from '../features/activity/ActivityView';
import { AppView } from '../features/artifacts/AppView';
import { useArtifact } from '../features/artifacts/queries';
import { useUnsavedGuard } from '../features/artifacts/edits';
import { MemoryView } from '../features/memory/MemoryView';
import { RestartWatch } from '../features/health/RestartWatch';
import { PushKeeper } from '../features/notifications/PushKeeper';
import { UndoHost } from '../features/undo/UndoHost';
import { OpenFromLink } from '../features/pwa/OpenFromLink';
import { RestoredNotice } from '../features/health/RestoredNotice';
import { ChannelDetailView } from '../features/channels/ChannelDetailView';
import { ChannelsView } from '../features/channels/ChannelsView';
import { ConnectChannel } from '../features/channels/ConnectChannel';
import { ChatView } from '../features/chat/ChatView';
import { PasswordsView } from '../features/passwords/PasswordsView';
import { EnginePill } from '../features/engine/EnginePill';
import { IntegrationDetailView } from '../features/integrations/IntegrationDetailView';
import { IntegrationsView } from '../features/integrations/IntegrationsView';
import { Palette } from '../features/palette/Palette';
import { RoutineDetailView } from '../features/routines/RoutineDetailView';
import { RoutinesView } from '../features/routines/RoutinesView';
import { TasksView } from '../features/tasks/TasksView';
import { NewSkill } from '../features/skills/NewSkill';
import { SkillDetailView } from '../features/skills/SkillDetailView';
import { SkillsView } from '../features/skills/SkillsView';
import { Settings } from '../features/settings/Settings';
import { Sidebar } from '../features/sidebar/Sidebar';
import { UsageIndicator } from '../features/usage/UsageIndicator';
import { useLiveStore } from '../live/store';
import styles from './Shell.module.css';
import { BrowserToggle } from '../features/browser/BrowserToggle';
import { TerminalDock } from '../features/terminal/TerminalDock';
import { TerminalToggle } from '../features/terminal/TerminalToggle';
import { useProviderSignInResult } from '../features/providers/useSignInResult';
import { useUi } from './ui';
import { useHotkey } from './useHotkey';

function Reconnecting() {
  const connection = useLiveStore((s) => s.connection);
  if (connection !== 'reconnecting') return null;
  return (
    <div className={styles.reconnecting} role="status">
      <Spinner size="xs" label={null} />
      <Text as="span" size="xs" tone="muted">
        Reconnecting to Conch…
      </Text>
    </div>
  );
}

export function Shell() {
  const {
    conversationId,
    routineId,
    integrationId,
    skillId,
    channelId,
    channelKind,
    itemId,
    artifactId,
  } = useParams();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const routinesArea = path.startsWith('/routines');
  const integrationsArea = path.startsWith('/integrations');
  const skillsArea = path.startsWith('/skills');
  const channelsArea = path.startsWith('/channels');
  const passwordsArea = path.startsWith('/passwords');
  const activityArea = path.startsWith('/activity');
  const appsArea = path.startsWith('/apps/');
  const { data: app } = useArtifact(appsArea ? artifactId : undefined);
  const memoryArea = path.startsWith('/memory');
  const tasksArea = path.startsWith('/tasks');

  // Toasts and notifications raised outside the router ask us to navigate.
  useEffect(() => {
    const go = (e: Event) => void navigate((e as CustomEvent<string>).detail);
    window.addEventListener('conch:navigate', go);
    return () => window.removeEventListener('conch:navigate', go);
  }, [navigate]);
  // A provider sign-in that had to come back to this tab instead of a popup.
  useProviderSignInResult();
  // An edit by hand not saved yet: leaving the page asks first (ADR 0046).
  useUnsavedGuard();
  const { data: conversations } = useConversations();
  const narrow = useMediaQuery('(max-width: 820px)');
  const { sidebarOpen, toggleSidebar, mobileSidebarOpen, setMobileSidebar, openSettings } = useUi();
  const openFind = useUi((s) => s.openFind);
  const terminalMax = useUi((s) => s.terminalOpen && s.terminalMax);
  const setPalette = useUi((s) => s.setPalette);

  const current = conversations?.find((c) => c.id === conversationId);
  const title = routinesArea
    ? 'Routines'
    : integrationsArea
      ? 'Integrations'
      : skillsArea
        ? 'Skills'
        : channelsArea
          ? 'Channels'
          : passwordsArea
            ? 'Passwords'
            : activityArea
              ? 'Activity'
              : appsArea
                ? (app?.title ?? '')
                : memoryArea
                  ? 'What Conch knows'
                  : tasksArea
                    ? 'Tasks'
                    : (current?.title ?? (conversationId ? '' : 'New chat'));

  useEffect(() => {
    document.title = current ? `${current.title} · Conch` : 'Conch';
  }, [current]);

  useHotkey('mod+shift+o', () => void navigate('/'));
  useHotkey('mod+b', () => (narrow ? setMobileSidebar(!mobileSidebarOpen) : toggleSidebar()));
  useHotkey('mod+,', () => openSettings());
  // ⌘F finds in the open chat (seeded with any selected text); elsewhere it searches everything.
  useHotkey('mod+f', () => {
    const selected = window.getSelection()?.toString().trim().split('\n')[0]?.slice(0, 200);
    if (conversationId) openFind(conversationId, selected || undefined);
    else setPalette(true);
  });

  const showSidebar = !narrow && sidebarOpen;

  return (
    <div className={styles.shell} data-sidebar={showSidebar || undefined}>
      {showSidebar && (
        <aside className={styles.sidebar}>
          <Sidebar />
        </aside>
      )}
      {narrow && (
        <Sheet.Root open={mobileSidebarOpen} onOpenChange={setMobileSidebar}>
          <Sheet.Content
            side="left"
            size="sm"
            hideClose
            aria-label="Conversations"
            className={styles.sheet}
          >
            <Sheet.Title className={styles.srOnly}>Conversations</Sheet.Title>
            <Sidebar collapsible={false} onNavigate={() => setMobileSidebar(false)} />
          </Sheet.Content>
        </Sheet.Root>
      )}
      <main className={styles.main}>
        <header className={styles.header}>
          {narrow ? (
            <IconButton label="Open conversations" onClick={() => setMobileSidebar(true)}>
              <Menu />
            </IconButton>
          ) : (
            !sidebarOpen && (
              <IconButton label="Show sidebar" shortcut="mod+b" onClick={toggleSidebar}>
                <PanelLeftOpen />
              </IconButton>
            )
          )}
          <Text as="div" weight="medium" className={styles.title}>
            <LiveTitle
              pending={
                !routinesArea &&
                !integrationsArea &&
                !skillsArea &&
                !channelsArea &&
                !passwordsArea &&
                !appsArea &&
                !tasksArea &&
                current?.titling
              }
            >
              {title}
            </LiveTitle>
          </Text>
          <UsageIndicator />
          {conversationId && <BrowserToggle conversationId={conversationId} />}
          <TerminalToggle />
          {conversationId && (
            <IconButton
              label="Find in chat"
              shortcut="mod+f"
              onClick={() => openFind(conversationId)}
            >
              <TextSearch />
            </IconButton>
          )}
          <EnginePill />
        </header>
        <Reconnecting />
        {/* The page; it steps aside while the terminal fills the screen. */}
        <div className={styles.area} data-covered={terminalMax || undefined}>
          {appsArea && artifactId ? (
            <AppView key={artifactId} artifactId={artifactId} />
          ) : memoryArea ? (
            <MemoryView />
          ) : tasksArea ? (
            <TasksView />
          ) : activityArea ? (
            <ActivityView />
          ) : passwordsArea ? (
            <PasswordsView itemId={itemId} />
          ) : channelsArea ? (
            channelKind ? (
              <ConnectChannel key={channelKind} kind={channelKind} />
            ) : channelId ? (
              <ChannelDetailView key={channelId} channelId={channelId} />
            ) : (
              <ChannelsView />
            )
          ) : skillsArea ? (
            path === '/skills/new' ? (
              <NewSkill />
            ) : skillId ? (
              <SkillDetailView key={skillId} skillId={skillId} />
            ) : (
              <SkillsView />
            )
          ) : integrationsArea ? (
            integrationId ? (
              <IntegrationDetailView key={integrationId} integrationId={integrationId} />
            ) : (
              <IntegrationsView />
            )
          ) : routinesArea ? (
            routineId ? (
              <RoutineDetailView key={routineId} routineId={routineId} />
            ) : (
              <RoutinesView />
            )
          ) : (
            <ChatView key={conversationId ?? 'new'} conversationId={conversationId} />
          )}
        </div>
        <TerminalDock />
      </main>
      <Settings />
      <Palette />
      <RestartWatch />
      <RestoredNotice />
      <PushKeeper />
      <UndoHost />
      <OpenFromLink />
    </div>
  );
}
