import { MessageList, ThinkingIndicator } from '@conch/nacre';
import { Fragment, type ReactNode } from 'react';

import type { ConversationView, TranscriptItem } from '../../live/reducer';
import {
  AssistantMessage,
  MemoryPill,
  PermissionCard,
  ToolItem,
  TurnEnd,
  UserMessage,
} from './TranscriptItems';
import styles from './Transcript.module.css';

export interface TranscriptProps {
  view: ConversationView;
  pending: { clientMessageId: string; text: string; at: number }[];
  name: string;
  onRespond: (permissionId: string, decision: 'allow' | 'allow-always' | 'deny') => void;
  onRetry: () => void;
  footer?: ReactNode;
}

interface Block {
  key: string;
  tools?: Extract<TranscriptItem, { kind: 'tool' }>[];
  item?: TranscriptItem;
}

/** Consecutive tool calls are grouped into one tight stack. */
function blocks(items: TranscriptItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (item.kind === 'tool') {
      if (last?.tools) last.tools.push(item);
      else out.push({ key: `tools-${item.id}`, tools: [item] });
    } else {
      out.push({ key: `${item.kind}-${item.id}`, item });
    }
  }
  return out;
}

export function Transcript({ view, pending, name, onRespond, onRetry, footer }: TranscriptProps) {
  const running = view.status === 'running' || view.status === 'awaiting-permission';
  const items: TranscriptItem[] = [
    ...view.items,
    ...pending.map((p) => ({
      kind: 'user' as const,
      id: p.clientMessageId,
      text: p.text,
      at: p.at,
      pending: true,
    })),
  ];
  const last = items.at(-1);
  const lastErrorId = [...items].reverse().find((i) => i.kind === 'turn-end')?.id;
  // Show the thinking row until visible text arrives (and not while asking permission).
  const showThinking =
    (running || pending.length > 0) &&
    view.status !== 'awaiting-permission' &&
    !(last?.kind === 'assistant' && last.text && !last.done) &&
    last?.kind !== 'tool';

  return (
    <MessageList className={styles.list} aria-label="Conversation">
      <div className={styles.column}>
        {blocks(items).map((block) => (
          <Fragment key={block.key}>
            {block.tools && (
              <div className={styles.tools}>
                {block.tools.map((t) => (
                  <ToolItem key={t.id} item={t} />
                ))}
              </div>
            )}
            {block.item?.kind === 'user' && <UserMessage item={block.item} />}
            {block.item?.kind === 'assistant' && <AssistantMessage item={block.item} name={name} />}
            {block.item?.kind === 'permission' && (
              <PermissionCard
                item={block.item}
                name={name}
                onRespond={(d) => onRespond((block.item as { id: string }).id, d)}
              />
            )}
            {block.item?.kind === 'memory' && <MemoryPill item={block.item} />}
            {block.item?.kind === 'turn-end' && (
              <TurnEnd
                item={block.item}
                onRetry={block.item.id === lastErrorId && !running ? onRetry : undefined}
              />
            )}
          </Fragment>
        ))}
        {showThinking && (
          <ThinkingIndicator
            className={styles.thinkingRow}
            label={`${name} is thinking…`}
            startedAt={view.turnStartedAt ?? pending[0]?.at}
          />
        )}
        {footer}
      </div>
    </MessageList>
  );
}
