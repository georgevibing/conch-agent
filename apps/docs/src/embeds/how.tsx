import { LogoRow, Pearl, Surface, Text } from '@conch/nacre';
import { ArrowLeftRight, Laptop, MessagesSquare, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import reference from 'virtual:conch-reference';

import styles from './embeds.module.css';

function Part({ mark, title, children }: { mark: ReactNode; title: string; children: ReactNode }) {
  return (
    <Surface as="li" variant="flat" radius="xl" padding={5} className={styles.part}>
      <span className={styles.marks} aria-hidden>
        {mark}
      </span>
      <Text size="lg" weight="semibold">
        {title}
      </Text>
      <Text tone="muted">{children}</Text>
    </Surface>
  );
}

function Between() {
  return (
    <li className={styles.between} aria-hidden>
      <ArrowLeftRight />
    </li>
  );
}

/** The three parts of Conch and how they meet: you, Conch on your computer, your providers. */
export function HowItWorks() {
  return (
    <ol className={styles.how} aria-label="How the parts of Conch connect">
      <Part
        title="Wherever you are"
        mark={
          <>
            <Laptop />
            <Smartphone />
            <MessagesSquare />
          </>
        }
      >
        A browser on this computer, your phone, or a chat app.
      </Part>
      <Between />
      <Part title="Conch, on your computer" mark={<Pearl size="md" label={null} />}>
        Keeps your chats, memory, skills, apps and routines. Asks before anything that matters.
      </Part>
      <Between />
      <Part title="Your providers" mark={<LogoRow items={reference.providers} decorative />}>
        The assistants and models you connect. All of them answer, from one picker.
      </Part>
    </ol>
  );
}
