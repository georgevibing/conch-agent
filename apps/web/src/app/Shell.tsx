import { IconButton, LiveTitle, Sheet, Spinner, Text, useMediaQuery } from '@conch/nacre';
import { Menu, PanelLeftOpen, TextSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { useConversations } from '../api/queries';
import { ActivityView } from '../features/activity/ActivityView';
import { ArchiveView } from '../features/archive/ArchiveView';
import { ARCHIVE_PATH } from '../features/archive/useArchive';
import { AppView } from '../features/artifacts/AppView';
import { useArtifact } from '../features/artifacts/queries';
import { AppPageView } from '../features/conchapps/AppPage';
import { appIdOf } from '../features/conchapps/words';
import { useUnsavedGuard } from '../features/artifacts/edits';
import { MemoryView } from '../features/memory/MemoryView';
import { RestartWatch } from '../features/health/RestartWatch';
import { PushKeeper } from '../features/notifications/PushKeeper';
import { UndoHost } from '../features/undo/UndoHost';
import { UpdateNotice } from '../features/updates/UpdateNotice';
import { OpenFromLink } from '../features/pwa/OpenFromLink';
import { RestoredNotice } from '../features/health/RestoredNotice';
import { ChannelDetailView } from '../features/channels/ChannelDetailView';
import { ConnectChannel } from '../features/channels/ConnectChannel';
import { ChatView } from '../features/chat/ChatView';
import { WakeWord } from '../features/voice/WakeWord';
import { PasswordsView } from '../features/passwords/PasswordsView';
import { ChatProvider } from '../features/engine/ChatProvider';
import { AppDetailView } from '../features/integrations/AppDetailView';
import { AppsView } from '../features/integrations/AppsView';
import { isPinnedId } from '../features/integrations/paths';
import { Palette } from '../features/palette/Palette';
import { RoutineDetailView } from '../features/routines/RoutineDetailView';
import { RoutinesView } from '../features/routines/RoutinesView';
import { TasksView } from '../features/tasks/TasksView';
import { NewSkill } from '../features/skills/NewSkill';
import { SkillDetailView } from '../features/skills/SkillDetailView';
import { SkillsView } from '../features/skills/SkillsView';
import { Sidebar } from '../features/sidebar/Sidebar';
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
  const { conversationId, routineId, appId, pageId, skillId, channelId, channelKind, itemId } =
    useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  // Which chat view is on screen. A new chat that has just been given its id is
  // the same chat: it keeps its view, so its first message and the reply's
  // wait aren't drawn a second time. Any other change of chat starts afresh.
  const [chat, setChat] = useState({ id: conversationId, key: conversationId ?? 'new' });
  if (chat.id !== conversationId) {
    const adopted =
      chat.id === undefined &&
      conversationId !== undefined &&
      (location.state as { fromNew?: boolean } | null)?.fromNew === true;
    setChat({
      id: conversationId,
      key: adopted ? chat.key : (conversationId ?? `new:${location.key}`),
    });
  }
  const routinesArea = path.startsWith('/routines');
  // `/apps/a_…` is something pinned (ADR 0034); every other `/apps…` is Apps (ADR 0052).
  const pinnedArea = isPinnedId(appId);
  const artifactId = pinnedArea ? appId : undefined;
  const appsArea = (path === '/apps' || path.startsWith('/apps/')) && !pinnedArea;
  const skillsArea = path.startsWith('/skills');
  const channelsArea = path.startsWith('/channels');
  const passwordsArea = path.startsWith('/passwords');
  const activityArea = path.startsWith('/activity');
  const { data: app } = useArtifact(artifactId);
  const memoryArea = path.startsWith('/memory');
  const tasksArea = path.startsWith('/tasks');
  const archiveArea = path === ARCHIVE_PATH;
  // The chat is on screen: its header names who answers it, and "Hey Conch"
  // opens talk there (anywhere else, on a new chat).
  const onChat = !(
    (pinnedArea && artifactId) ||
    routinesArea ||
    appsArea ||
    skillsArea ||
    channelsArea ||
    passwordsArea ||
    activityArea ||
    memoryArea ||
    tasksArea ||
    archiveArea
  );

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
    : appsArea
      ? 'Apps'
      : skillsArea
        ? 'Skills'
        : channelsArea
          ? 'Apps'
          : passwordsArea
            ? 'Passwords'
            : activityArea
              ? 'Activity'
              : pinnedArea
                ? (app?.title ?? '')
                : memoryArea
                  ? 'What Conch knows'
                  : tasksArea
                    ? 'Tasks'
                    : archiveArea
                      ? 'Archived chats'
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
                !appsArea &&
                !skillsArea &&
                !channelsArea &&
                !passwordsArea &&
                !pinnedArea &&
                !tasksArea &&
                !archiveArea &&
                current?.titling
              }
            >
              {title}
            </LiveTitle>
          </Text>
          <WakeWord onChat={onChat} />
          {onChat && <ChatProvider conversationId={conversationId} />}
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
        </header>
        <Reconnecting />
        <UpdateNotice className={styles.notice} />
        {/* The page; it steps aside while the terminal fills the screen. */}
        <div className={styles.area} data-covered={terminalMax || undefined}>
          {pinnedArea && artifactId ? (
            <AppView key={artifactId} artifactId={artifactId} />
          ) : memoryArea ? (
            <MemoryView />
          ) : tasksArea ? (
            <TasksView />
          ) : archiveArea ? (
            <ArchiveView />
          ) : activityArea ? (
            <ActivityView />
          ) : passwordsArea ? (
            <PasswordsView itemId={itemId} />
          ) : channelsArea ? (
            channelKind ? (
              <ConnectChannel key={channelKind} kind={channelKind} />
            ) : (
              channelId && <ChannelDetailView key={channelId} channelId={channelId} />
            )
          ) : skillsArea ? (
            path === '/skills/new' ? (
              <NewSkill />
            ) : skillId ? (
              <SkillDetailView key={skillId} skillId={skillId} />
            ) : (
              <SkillsView />
            )
          ) : appsArea ? (
            pageId && appIdOf(appId) ? (
              <AppPageView
                key={`${appId}/${pageId}`}
                appId={appIdOf(appId) ?? ''}
                pageId={pageId}
              />
            ) : appId ? (
              <AppDetailView key={appId} appId={appId} />
            ) : (
              <AppsView />
            )
          ) : routinesArea ? (
            routineId ? (
              <RoutineDetailView key={routineId} routineId={routineId} />
            ) : (
              <RoutinesView />
            )
          ) : (
            <ChatView key={chat.key} conversationId={conversationId} />
          )}
        </div>
        <TerminalDock />
      </main>
      <Palette />
      <RestartWatch />
      <RestoredNotice />
      <PushKeeper />
      <UndoHost />
      <OpenFromLink />
    </div>
  );
}
