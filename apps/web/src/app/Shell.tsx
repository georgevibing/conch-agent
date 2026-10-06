import { IconButton, LiveTitle, Sheet, Spinner, Text, useMediaQuery } from '@conch/nacre';
import { Menu, PanelLeftOpen, TextSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { RestartWatch } from '../features/health/RestartWatch';
import { NeedWatcher } from '../features/setup/NeedWatcher';
import { PushKeeper } from '../features/notifications/PushKeeper';
import { UndoHost } from '../features/undo/UndoHost';
import { UpdateNotice } from '../features/updates/UpdateNotice';
import { OpenFromLink } from '../features/pwa/OpenFromLink';
import { RestoredNotice } from '../features/health/RestoredNotice';
import { ChannelDetailView } from '../features/channels/ChannelDetailView';
import { ConnectChannel } from '../features/channels/ConnectChannel';
import { ChatView } from '../features/chat/ChatView';
import { HeaderMore } from '../features/chat/HeaderMore';
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
import { MarketSkillView } from '../features/skills/Discover';
import { SkillDetailView } from '../features/skills/SkillDetailView';
import { SkillsView } from '../features/skills/SkillsView';
import { Sidebar } from '../features/sidebar/Sidebar';
import { useLiveStore } from '../live/store';
import styles from './Shell.module.css';
import { PageTrailProvider, Trail, type PageTrail } from './trail';
import { BrowserToggle } from '../features/browser/BrowserToggle';
import { TerminalDock } from '../features/terminal/TerminalDock';
import { TerminalToggle } from '../features/terminal/TerminalToggle';
import { useProviderSignInResult } from '../features/providers/useSignInResult';
import { MEMORY_ALL } from '../features/settings/paths';
import { useUi } from './ui';
import { NARROW, PHONE } from './widths';
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
    appId,
    pageId,
    skillId,
    listingId,
    channelId,
    channelKind,
    itemId,
  } = useParams();
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
  const narrow = useMediaQuery(NARROW);
  // A phone: the header keeps the chat's name in view, and folds the rest away.
  const phone = useMediaQuery(PHONE);
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

  // A page inside a place says where it is (`usePageTrail`): the header shows
  // it as the trail, Apps › Gmail, in place of the place's name.
  const [trail, setTrail] = useState<PageTrail | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const firstKey = useRef(location.key);
  const hadTrail = useRef(false);
  const trailKey = trail?.map((c) => c.label).join(' › ') ?? '';
  // Arriving at a page inside a place, or stepping back out of one, leaves the
  // focus nowhere (what was pressed is gone): it goes to where you are now —
  // the page's name in the trail, or the place's heading. Focus that something
  // else took (a dialog, a field) stays where it is.
  useEffect(() => {
    const had = hadTrail.current;
    hadTrail.current = trailKey !== '';
    if (location.key === firstKey.current || (!trailKey && !had)) return;
    const frame = requestAnimationFrame(() => {
      const at = document.activeElement;
      if (at && at !== document.body) return;
      const here = trailKey
        ? headerRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
        : areaRef.current?.querySelector<HTMLElement>('h1');
      if (!here) return;
      if (!here.hasAttribute('tabindex')) here.setAttribute('tabindex', '-1');
      here.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.key, trailKey]);

  const showSidebar = !narrow && sidebarOpen;
  const asideRef = useRef<HTMLElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  // Focus follows the sidebar: closed from inside it (which leaves focus nowhere once
  // it's inert), to the button that opens it again.
  useEffect(() => {
    if (narrow || showSidebar) return;
    const at = document.activeElement;
    if (!at || at === document.body || asideRef.current?.contains(at)) showRef.current?.focus();
  }, [showSidebar, narrow]);

  return (
    <div
      className={styles.shell}
      data-wide={!narrow || undefined}
      data-sidebar={showSidebar || undefined}
    >
      {/* Kept while closed, so it can glide shut and open again where it was. */}
      {!narrow && (
        <aside
          ref={asideRef}
          className={styles.sidebar}
          inert={!showSidebar}
          aria-hidden={!showSidebar || undefined}
        >
          <div className={styles.sidebarInner}>
            <Sidebar />
          </div>
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
        <header ref={headerRef} className={styles.header}>
          {narrow ? (
            <IconButton label="Open conversations" onClick={() => setMobileSidebar(true)}>
              <Menu />
            </IconButton>
          ) : (
            !sidebarOpen && (
              <IconButton
                ref={showRef}
                label="Show sidebar"
                shortcut="mod+b"
                onClick={toggleSidebar}
                className={styles.showSidebar}
              >
                <PanelLeftOpen />
              </IconButton>
            )
          )}
          {trail ? (
            <Trail crumbs={trail} className={styles.trail} />
          ) : (
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
          )}
          <WakeWord onChat={onChat} />
          {onChat && <ChatProvider conversationId={conversationId} compact={phone} />}
          {phone && conversationId ? (
            <HeaderMore conversationId={conversationId} />
          ) : (
            <>
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
            </>
          )}
        </header>
        <Reconnecting />
        <UpdateNotice className={styles.notice} />
        {/* The page; it steps aside while the terminal fills the screen. */}
        <div ref={areaRef} className={styles.area} data-covered={terminalMax || undefined}>
          <PageTrailProvider value={setTrail}>
            {pinnedArea && artifactId ? (
              <AppView key={artifactId} artifactId={artifactId} />
            ) : memoryArea ? (
              <MemoryMoved />
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
              ) : listingId && path.startsWith('/skills/discover/') ? (
                <MarketSkillView key={listingId} listingId={listingId} />
              ) : path === '/skills/discover' ? (
                <SkillsView />
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
          </PageTrailProvider>
        </div>
        <TerminalDock />
      </main>
      <Palette />
      <RestartWatch />
      <NeedWatcher />
      <RestoredNotice />
      <PushKeeper />
      <UndoHost />
      <OpenFromLink />
    </div>
  );
}

/**
 * What Conch remembers lives in Settings → Memory now. An old link (or a
 * bookmark) to `/memory` goes there, over the chats, so leaving Settings
 * doesn't come straight back.
 */
function MemoryMoved() {
  const openSettings = useUi((s) => s.openSettings);
  useEffect(() => {
    openSettings('memory', MEMORY_ALL, { replace: true, from: '/' });
  }, [openSettings]);
  return null;
}
