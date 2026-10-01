import {
  accents,
  Callout,
  IntegrationLogo,
  LinkCard,
  Pearl,
  Prose,
  SegmentedControl,
  Surface,
  Text,
  useNacreTheme,
  type AccentName,
} from '@conch/nacre';
import { ArrowLeftRight, Laptop, MessagesSquare, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import { DECISIONS, pagesIn } from '../site/pages';
import styles from './embeds.module.css';

/** Every page of a section, as cards: for a section's opening page. */
export function SectionCards({ id }: { id: string }) {
  const pages = pagesIn(id).filter((page) => page.path !== `/${id}`);
  if (!pages.length)
    return (
      <Callout tone="danger" title={`There’s no section “${id}”`}>
        Sections are the folders of apps/docs/content.
      </Callout>
    );
  return (
    <div className={styles.grid}>
      {pages.map((page, index) => (
        <LinkCard
          key={page.path}
          index={index}
          title={page.nav}
          description={page.description}
          asChild
        >
          <Link to={page.path} />
        </LinkCard>
      ))}
    </div>
  );
}

/** Every decision record in `docs/adr`, newest first. */
export function DecisionList() {
  return (
    <Prose size="lg">
      <ul>
        {[...DECISIONS].reverse().map((page) => (
          <li key={page.path}>
            <Link to={page.path}>{page.title}</Link>
          </li>
        ))}
      </ul>
    </Prose>
  );
}

const name = (accent: string) => (accent[0] ?? '').toUpperCase() + accent.slice(1);

/** Nacre's accents, live: pick one and these pages wear it. */
export function AccentPicker() {
  const theme = useNacreTheme();
  const current = typeof theme.accent === 'string' ? theme.accent : '';
  return (
    <div className={styles.scroll}>
      <SegmentedControl
        aria-label="Accent colour"
        value={current}
        onValueChange={(accent) => theme.setTheme({ accent: accent as AccentName })}
      >
        {(Object.keys(accents) as AccentName[]).map((accent) => (
          <SegmentedControl.Item
            key={accent}
            value={accent}
            icon={
              <span
                className={styles.swatch}
                style={{
                  background: `oklch(0.62 ${accents[accent].chroma} ${accents[accent].hue})`,
                }}
              />
            }
          >
            {name(accent)}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl>
    </div>
  );
}

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
      <Part
        title="Your providers"
        mark={reference.providers.map((provider) => (
          <IntegrationLogo
            key={provider.id}
            brand={provider.id}
            name={provider.name}
            color={provider.color}
            size="xs"
            decorative
          />
        ))}
      >
        The assistants and models you connect. All of them answer, from one picker.
      </Part>
    </ol>
  );
}
