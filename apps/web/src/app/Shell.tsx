import { IconButton, LiveTitle, Sheet, Spinner, Text, useMediaQuery } from '@conch/nacre';
import { Menu, PanelLeftOpen, TextSearch } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { useConversations } from '../api/queries';
import { ChatView } from '../features/chat/ChatView';
import { EnginePill } from '../features/engine/EnginePill';
import { IntegrationDetailView } from '../features/integrations/IntegrationDetailView';
import { IntegrationsView } from '../features/integrations/IntegrationsView';
import { Palette } from '../features/palette/Palette';
import { RoutineDetailView } from '../features/routines/RoutineDetailView';
import { RoutinesView } from '../features/routines/RoutinesView';
import { Settings } from '../features/settings/Settings';
import { Sidebar } from '../features/sidebar/Sidebar';
import { UsageIndicator } from '../features/usage/UsageIndicator';
import { useLiveStore } from '../live/store';
import styles from './Shell.module.css';
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
  const { conversationId, routineId, integrationId } = useParams();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const routinesArea = path.startsWith('/routines');
  const integrationsArea = path.startsWith('/integrations');

  // Toasts and notifications raised outside the router ask us to navigate.
  useEffect(() => {
    const go = (e: Event) => void navigate((e as CustomEvent<string>).detail);
    window.addEventListener('conch:navigate', go);
    return () => window.removeEventListener('conch:navigate', go);
  }, [navigate]);
  const { data: conversations } = useConversations();
  const narrow = useMediaQuery('(max-width: 820px)');
  const { sidebarOpen, toggleSidebar, mobileSidebarOpen, setMobileSidebar, openSettings } = useUi();
  const openFind = useUi((s) => s.openFind);
  const setPalette = useUi((s) => s.setPalette);

  const current = conversations?.find((c) => c.id === conversationId);
  const title = routinesArea
    ? 'Routines'
    : integrationsArea
      ? 'Integrations'
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
            <LiveTitle pending={!routinesArea && !integrationsArea && current?.titling}>
              {title}
            </LiveTitle>
          </Text>
          <UsageIndicator />
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
        {integrationsArea ? (
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
      </main>
      <Settings />
      <Palette />
    </div>
  );
}
