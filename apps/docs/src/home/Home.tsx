import { Badge, Button, DocsHero, Heading, LinkCard, Text } from '@conch/nacre';
import {
  ArrowRight,
  Blocks,
  BookText,
  HeartPulse,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import { ChannelGrid } from '../embeds/channels';
import { InstallCommand } from '../embeds/install';
import { ProviderGrid } from '../embeds/providers';
import { SECTIONS } from '../site/config';
import { DOCS_HEAD, useHead } from '../site/head';
import { pagesIn } from '../site/pages';
import styles from './Home.module.css';

const ICONS: Record<string, ReactNode> = {
  start: <Rocket />,
  providers: <Sparkles />,
  channels: <MessagesSquare />,
  features: <Wand2 />,
  care: <HeartPulse />,
  security: <ShieldCheck />,
  reference: <BookText />,
  project: <Blocks />,
};

function Band({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <section className={styles.band}>
      <div className={styles.bandHead}>
        <Heading level={2} display size="4xl">
          {title}
        </Heading>
        <Text size="xl" tone="muted">
          {lede}
        </Text>
      </div>
      {children}
    </section>
  );
}

/** The documentation's own front page: where everything is, and where to start. */
export function Home() {
  useHead(DOCS_HEAD);
  const first = pagesIn('start')[0];

  return (
    <main id="content" className={styles.home}>
      <DocsHero
        eyebrow={
          <>
            <Badge tone="accent">Documentation</Badge>
            <Badge tone="neutral">{reference.version}</Badge>
          </>
        }
        title={
          <>
            Everything Conch does, <em>in plain words.</em>
          </>
        }
        lede="A guide for each thing it does, and a reference read straight from the code, so it is never behind it."
        actions={
          <>
            <InstallCommand />
            <div className={styles.heroButtons}>
              {first && (
                <Button size="lg" trailingIcon={<ArrowRight />} asChild>
                  <Link to={first.path}>Get started</Link>
                </Button>
              )}
              <Button size="lg" variant="ghost" tone="neutral" asChild>
                <Link to="/start/how-it-works">How Conch works</Link>
              </Button>
            </div>
          </>
        }
      />

      <Band title="Find your way" lede="Eight short sections. Start at the top, or jump in.">
        <div className={styles.grid}>
          {SECTIONS.map((section, index) => {
            const page = pagesIn(section.id)[0];
            if (!page) return null;
            return (
              <LinkCard
                key={section.id}
                index={index}
                icon={ICONS[section.id]}
                title={section.title}
                description={section.about}
                asChild
              >
                <Link to={page.path} />
              </LinkCard>
            );
          })}
        </div>
      </Band>

      <Band
        title="Every provider, at once"
        lede="One model picker for all of them, and a chat can move between them without losing its thread."
      >
        <ProviderGrid />
      </Band>

      <Band
        title="In the apps you already use"
        lede="A bot of your own, no public address, and nobody gets in unless you let them."
      >
        <ChannelGrid />
      </Band>
    </main>
  );
}
