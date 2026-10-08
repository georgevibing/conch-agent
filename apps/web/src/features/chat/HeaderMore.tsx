import { DropdownMenu, IconButton, Pearl } from '@conch/nacre';
import { Globe, MoreHorizontal, Route, SquareTerminal, TextSearch } from 'lucide-react';

import { useUi } from '../../app/ui';
import { ChatAgentMenu } from '../agents/ChatAgent';
import { useLiveStore } from '../../live/store';
import { useTerminalStatus } from '../terminal/queries';
import { useHowItDidIt } from '../trajectory/api';

/**
 * A phone's header keeps the chat's name in view: the browser, the terminal
 * and find fold into one quiet button. While the assistant browses, a pearl
 * stands in for the dots, as it does for the globe on a wider screen.
 */
export function HeaderMore({ conversationId }: { conversationId: string }) {
  const browserOpen = useUi((s) => s.browserFor === conversationId);
  const terminalOpen = useUi((s) => s.terminalOpen);
  const { data: terminal } = useTerminalStatus();
  const browsing = useLiveStore((s) => {
    const items = s.views[conversationId]?.items ?? [];
    const last = items.findLast((i) => i.kind === 'browser');
    return last?.kind === 'browser' && last.step.status === 'running';
  });
  const terminalShown = terminal?.settings.enabled !== false || terminalOpen;

  const ui = useUi.getState;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label={browsing ? 'More, and watch the browser' : 'More'} tooltip={false}>
          {browsing && !browserOpen ? (
            <Pearl size="xs" state="thinking" label={null} />
          ) : (
            <MoreHorizontal />
          )}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <ChatAgentMenu conversationId={conversationId} />
        <DropdownMenu.Item icon={<TextSearch />} onSelect={() => ui().openFind(conversationId)}>
          Find in chat
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<Route />}
          onSelect={() => useHowItDidIt.getState().openRun(conversationId)}
        >
          How it did it
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<Globe />}
          onSelect={() => (browserOpen ? ui().closeBrowser() : ui().openBrowser(conversationId))}
        >
          {browserOpen ? 'Hide the browser' : browsing ? 'Watch the browser' : 'Show the browser'}
        </DropdownMenu.Item>
        {terminalShown && (
          <DropdownMenu.Item icon={<SquareTerminal />} onSelect={() => ui().toggleTerminal()}>
            {terminalOpen ? 'Hide the terminal' : 'Show the terminal'}
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
