import {
  Badge,
  Bento,
  Button,
  DocsHero,
  Facts,
  Heading,
  IntegrationLogo,
  LogoChip,
  Marquee,
  OsMark,
  Pearl,
  Reveal,
  Scene,
  Statement,
  Text,
  TextLink,
} from '@conch/nacre';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import { DownloadApp } from '../embeds/download';
import { HowItWorks } from '../embeds/how';
import { InstallCommand } from '../embeds/install';
import { AUTHOR, REPO_URL } from '../site/config';
import { LANDING_HEAD, useHead } from '../site/head';
import {
  AddressDemo,
  ApprovalDemo,
  BrowserDemo,
  ChartDemo,
  ChatDemo,
  HealedDemo,
  KnowsDemo,
  MakerDemo,
  MemoryDemo,
  PasskeyDemo,
  PhoneDemo,
  ProvidersDemo,
  RoutineDemo,
  TaskDemo,
  UndoDemo,
} from './demos';
import styles from './Landing.module.css';

/** Where the front page sends people. `content.test.ts` checks each is a real page. */
export const LANDING_LINKS = {
  start: '/start/install',
  docs: '/docs',
  security: '/security/signing-in',
  how: '/start/how-it-works',
  providers: '/providers',
  channels: '/channels',
  apps: '/features/apps',
  chats: '/features/chats',
  makeApps: '/features/make-apps',
  decisions: '/project/decisions',
  nacre: '/project/nacre',
  privacy: '/privacy',
} as const;

const channels = reference.channels.filter((channel) => channel.available);
const local = reference.providers.find((provider) => provider.can.offline);
/** The providers that are agents on this computer: they work with your files. */
const agents = reference.providers.filter((provider) => provider.can.files).map((p) => p.name);
/** The plans people already pay for, connected with their own sign-in (coding agents too). */
const plans = reference.providers
  .filter((p) => p.group === 'subscription' || p.group === 'agent')
  .map((p) => p.name);

/** A list of names as a sentence would say it: "a, b and c". */
function sentence(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names[0] ?? '');
}

function Band({
  title,
  lede,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.band}>
      <Reveal className={styles.bandHead}>
        <Heading level={2} display size="5xl" className={styles.bandTitle}>
          {title}
        </Heading>
        {lede != null && (
          <Text size="xl" tone="muted">
            {lede}
          </Text>
        )}
      </Reveal>
      {children}
    </section>
  );
}

/**
 * Conch's front page: what it is, shown with the app's own components at
 * work, and the few things worth knowing before installing it. Every count on
 * it is read from the code, and it claims nothing Conch can't show.
 */
export function Landing() {
  useHead(LANDING_HEAD);

  return (
    <main id="content" className={styles.landing}>
      <div className={styles.page}>
        <DocsHero
          eyebrow={
            <>
              <Pearl size="sm" label={null} />
              <span>Open source</span>
              <Badge tone="neutral" size="sm">
                {reference.version}
              </Badge>
            </>
          }
          title={
            <>
              A calm home for your AI agents.
              <br />
              <em>On your own computer.</em>
            </>
          }
          lede={`Conch drives ${sentence(agents)}, a model on this machine and the keys you have, all at once, from one place. It sets itself up, fixes what breaks, and asks only when it matters.`}
          actions={
            <>
              <DownloadApp />
              <InstallCommand typed />
              <div className={styles.buttons}>
                <Button size="lg" variant="surface" trailingIcon={<ArrowRight />} asChild>
                  <Link to={LANDING_LINKS.start}>Get started</Link>
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  tone="neutral"
                  trailingIcon={<ArrowUpRight />}
                  asChild
                >
                  <a href={REPO_URL} target="_blank" rel="noreferrer">
                    Read the source
                  </a>
                </Button>
              </div>
            </>
          }
          media={<ChatDemo />}
        />

        <Facts label="Conch in numbers" className={styles.facts}>
          <Facts.Item value={reference.providers.length} label="providers, all at once" />
          <Facts.Item index={1} value={channels.length} label="chat apps to reach it from" />
          <Facts.Item
            index={2}
            value={reference.integrations.length}
            label="apps it can use for you"
          />
          <Facts.Item index={3} value="0" label="accounts to make, and no telemetry" />
        </Facts>

        <Scene
          kicker="Every provider"
          title={
            <>
              One picker. <em>Every model you have.</em>
            </>
          }
          stage={<ProvidersDemo />}
          points={[
            `The plans you already pay for: ${sentence(plans)}.`,
            `${local?.name ?? 'A model on this computer'} is private, free and works offline.`,
            'Paste a key, and Conch knows whose it is, or asks.',
            'Offline, or at a usage limit, the one you chose carries on.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.providers}>Compare the providers</Link>
            </TextLink>
          }
        >
          <p>
            Connect as many as you like. Each adds its models to the same list, and a chat can move
            from one to another without losing its thread.
          </p>
        </Scene>

        <Scene
          flip
          kicker="In the chat"
          title={
            <>
              It knows what it can do. <em>Just ask.</em>
            </>
          }
          stage={<KnowsDemo />}
          points={[
            'What it finds is shown as it is: your calendar, your email, your files, your messages.',
            'Questions come with answers to tap, and its plan ticks itself off as it goes.',
            'Under a reply, what you might say next is one tap away.',
            'It never turns anything on by itself.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.chats}>What a chat can do</Link>
            </TextLink>
          }
        >
          <p>
            When what you ask needs an app or a skill that isn’t on yet, the card to turn it on is
            right under the reply. Once it’s on, the chat carries on by itself. There’s nothing to
            ask again.
          </p>
        </Scene>

        <Scene
          kicker="Make it yours"
          title={
            <>
              Ask for an app. <em>It builds one.</em>
            </>
          }
          stage={<MakerDemo />}
          points={[
            'Every model you use can use it, and its page looks like Conch, in light and dark.',
            'It runs sealed off: its own notes, and only the websites its card names.',
            'Nothing is added until you press the button.',
            'Share it on GitHub in one press, or add one someone else made from a link.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.makeApps}>Make an app</Link>
            </TextLink>
          }
        >
          <p>
            When nothing you have does what you need, say what you want in your own words. Conch
            writes the app, checks it, tries every part of it and shows it to you as a card.
          </p>
        </Scene>

        <Scene
          flip
          kicker="Safe hands"
          title={
            <>
              It asks when it matters. <em>Only then.</em>
            </>
          }
          stage={<ApprovalDemo />}
          points={[
            'On macOS and Linux, commands run sealed: they can’t read your keys or saved passwords.',
            'Every file it changes can be put back.',
            'Activity shows everything it did, in every chat.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.security}>How it stays safe</Link>
            </TextLink>
          }
        >
          <p>
            Conch interrupts you for two things: an approval that matters, and what only a person
            can do. Once a chat has read a web page or an email, anything that could send your
            things out or change your computer asks first, in every mode.
          </p>
        </Scene>

        <Scene
          kicker="The web"
          title={
            <>
              It uses the web. <em>You watch.</em>
            </>
          }
          stage={<BrowserDemo />}
          points={[
            'It asks before it acts on a new site.',
            'Passwords are yours to type. It never sees one.',
            'Your own browser, its cookies and its sign-ins are never touched.',
          ]}
        >
          <p>
            Conch has a browser of its own, with nothing to install. You see the page live beside
            the chat, with a small pearl where it is about to click, and you can take the wheel
            whenever you like.
          </p>
        </Scene>

        <Scene
          flip
          kicker="In your pocket"
          title={
            <>
              Reach it from <em>the apps you already use.</em>
            </>
          }
          stage={<PhoneDemo />}
          points={[
            'Nobody gets in unless you let them.',
            'Approve what it asks right there, with a button.',
            'On your phone’s Home Screen it’s an app, with notifications and voice.',
          ]}
        >
          <p>
            A bot or a chat of your own in {sentence(channels.slice(0, 4).map((c) => c.name))}, and{' '}
            {channels.length - 4} more. Most connect outward from your computer, so nothing is
            opened to the internet.
          </p>
          <Marquee
            label="Chat apps you can reach Conch from"
            items={channels.map((c) => (
              <LogoChip
                key={c.id}
                logo={
                  <IntegrationLogo
                    brand={c.id}
                    name={c.name}
                    color={c.color}
                    size="xs"
                    decorative
                  />
                }
              >
                {c.name}
              </LogoChip>
            ))}
          />
        </Scene>

        <Band title="And the rest of a day’s work" lede="Each of these is the app itself, playing.">
          <Bento>
            <Bento.Tile
              span={3}
              title="It remembers, in the open"
              text="Memories are small Markdown files you can read, edit or delete. Every save shows in the chat, with Undo."
              picture="Three things Conch remembered, each a short note"
            >
              <MemoryDemo />
            </Bento.Tile>
            <Bento.Tile
              span={3}
              index={1}
              title="Everything can be put back"
              text="Every file your assistant makes, changes or deletes, whichever provider did it. You see what will change first."
              picture="Three files your assistant changed, undone with one press"
            >
              <UndoDemo />
            </Bento.Tile>
            <Bento.Tile
              span={4}
              index={2}
              title="Show me"
              text="Ask for a chart, a page, a document or a table. It opens beside the chat, every version kept. Pages it writes run sealed off."
              live
            >
              <ChartDemo />
            </Bento.Tile>
            <Bento.Tile
              span={2}
              index={3}
              title="Hand it off"
              text="Send a job to the background and keep chatting. Its result comes back to where you asked."
              picture="A background task working through its steps, then finishing"
            >
              <TaskDemo />
            </Bento.Tile>
            <Bento.Tile
              span={2}
              index={4}
              title="At a time, or when it happens"
              text="Routines run at a time you read in plain words, or when something happens, like an email from someone. Watching costs nothing. Nothing runs until you turn it on."
              picture="A routine your assistant drafted to tell you when someone emails, waiting to be turned on"
            >
              <RoutineDemo />
            </Bento.Tile>
            <Bento.Tile
              span={4}
              index={5}
              title="It looks after itself"
              text="One Repair everything button, daily backups you can restore, signed updates. What it fixed on its own is a quiet list, not an alarm."
              picture="Three things Conch fixed on its own"
            >
              <HealedDemo />
            </Bento.Tile>
            <Bento.Tile
              span={3}
              index={6}
              title="Your own address"
              text="On a server, one line installs Conch and asks a few questions. It gets its own certificate, and a link you open on your laptop makes it yours."
              picture="Conch gets its own certificate, then answers at conch.yourname.com"
            >
              <AddressDemo />
            </Bento.Tile>
            <Bento.Tile
              span={3}
              index={7}
              title="Sign in with a touch"
              text="Touch ID, Windows Hello or Face ID, named for the device you’re on. A new device waits for your OK, given from one you already use."
              picture="The sign-in button names what your device has"
            >
              <PasskeyDemo />
            </Bento.Tile>
            <Bento.Tile
              span={6}
              index={8}
              title={`${reference.integrations.length} apps, for every model`}
              text="Connect one from a gallery and it works with whichever provider answers. No JSON to edit, and its sign-in stays fresh."
              picture="The apps in Conch’s gallery"
            >
              <Marquee
                label="Apps in the gallery"
                seconds={64}
                items={reference.integrations.map((app) => (
                  <LogoChip
                    key={app.id}
                    logo={
                      <IntegrationLogo
                        brand={app.id}
                        name={app.name}
                        color={app.color}
                        size="xs"
                        decorative
                      />
                    }
                  >
                    {app.name}
                  </LogoChip>
                ))}
              />
            </Bento.Tile>
          </Bento>
        </Band>

        <Band
          title="Kept on your own computer"
          lede={
            <>
              A small program on your computer, the app it serves, and the providers you connect.
              Chats, memories, skills and settings are plain files in <code>~/.conch</code>, and
              Conch keeps no copy anywhere else.
            </>
          }
        >
          <Reveal>
            <HowItWorks />
          </Reveal>
        </Band>

        <Band title="Good to know" lede="Three things worth knowing before you install it.">
          <Bento>
            <Bento.Tile
              span={2}
              title="It runs where you work"
              text="An app for macOS, Linux and Windows, or one line in a terminal, on your computer or a server. Nothing to install first."
              picture="The systems Conch runs on: macOS, Linux and Windows"
            >
              <div className={styles.systems}>
                <LogoChip logo={<OsMark os="macos" />}>macOS</LogoChip>
                <LogoChip logo={<OsMark os="linux" />}>Linux</LogoChip>
                <LogoChip logo={<OsMark os="windows" />}>Windows</LogoChip>
              </div>
            </Bento.Tile>
            <Bento.Tile
              span={2}
              index={1}
              title="It runs as you"
              text={
                <>
                  Conch can read your files and run commands. Treat it like an SSH server, and read{' '}
                  <TextLink asChild>
                    <Link to={LANDING_LINKS.security}>how it’s protected</Link>
                  </TextLink>{' '}
                  before you put it on a network.
                </>
              }
            />
            <Bento.Tile
              span={2}
              index={2}
              title="Local models are smaller"
              text={local?.limits[0] ?? 'A model on your computer is slower than the cloud ones.'}
            />
          </Bento>
        </Band>

        <Statement
          size="md"
          variant="quote"
          from={
            <>
              The person who built it,{' '}
              <TextLink href={AUTHOR.url} target="_blank" rel="noreferrer">
                {AUTHOR.name}
              </TextLink>
            </>
          }
        >
          <p>
            I built Conch for myself. I wanted the agents I already use in one calm place, on my own
            computer, with my files and my keys staying there.
          </p>
          <p>It’s open source now, so it can be yours too.</p>
        </Statement>

        <section className={styles.closing}>
          <Statement mark={<Pearl size="xl" label={null} />}>
            <p>
              In the old story, whoever holds the conch <em>gets to speak.</em>
            </p>
          </Statement>
          <Reveal className={styles.closingActions}>
            <DownloadApp />
            <InstallCommand />
            <div className={styles.buttons}>
              <Button size="lg" variant="surface" trailingIcon={<ArrowRight />} asChild>
                <Link to={LANDING_LINKS.start}>Get started</Link>
              </Button>
              <Button size="lg" variant="ghost" tone="neutral" asChild>
                <Link to={LANDING_LINKS.docs}>Read the documentation</Link>
              </Button>
            </div>
          </Reveal>
        </section>

        <footer className={styles.footer}>
          <Text as="span" size="sm" tone="muted">
            Conch {reference.version}. Made with{' '}
            <TextLink asChild>
              <Link to={LANDING_LINKS.nacre}>Nacre</Link>
            </TextLink>
            , its own design system.
          </Text>
          <nav aria-label="More" className={styles.footerLinks}>
            <TextLink asChild>
              <Link to={LANDING_LINKS.docs}>Documentation</Link>
            </TextLink>
            <TextLink asChild>
              <Link to={LANDING_LINKS.how}>How it works</Link>
            </TextLink>
            <TextLink asChild>
              <Link to={LANDING_LINKS.decisions}>Decisions</Link>
            </TextLink>
            <TextLink href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </TextLink>
            <TextLink asChild>
              <Link to={LANDING_LINKS.privacy}>Privacy</Link>
            </TextLink>
          </nav>
        </footer>
      </div>
    </main>
  );
}
