import type { ReactNode } from 'react';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';

/** A chat column for stories: as wide as a chat, on the canvas. */
export function Column({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return <div style={{ maxInlineSize: width, marginInline: 'auto' }}>{children}</div>;
}

/** The card where it lives: asked for, found, then the few words the reply adds. */
export function InChat({ ask, card, reply }: { ask: string; card: ReactNode; reply: string }) {
  return (
    <Column>
      <MessageList>
        <Message from="user">{ask}</Message>
        <Message from="assistant">
          <div style={{ display: 'grid', gap: 'var(--nc-space-3)' }}>
            {card}
            <Prose>
              <p>{reply}</p>
            </Prose>
          </div>
        </Message>
      </MessageList>
    </Column>
  );
}
