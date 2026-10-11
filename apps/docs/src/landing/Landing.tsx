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
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import { DownloadApp } from '../embeds/download';
import { HowItWorks } from '../embeds/how';
import { InstallCommand } from '../embeds/install';
import { AUTHOR, REPO_URL, VERSION_LABEL } from '../site/config';
import { LANDING_HEAD, useHead } from '../site/head';
import {
  AddressDemo,
  AgentsDemo,
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
  RepairDemo,
  RoutineDemo,
  TaskDemo,
  UndoDemo,
} from './demos';
import styles from './Landing.module.css';

/** Where the front page sends people. `content.test.ts` checks each is a real page. */
export const LANDING_LINKS = {
  start: '/start/install',
  health: '/care/health',
  docs: '/docs',
  security: '/security/signing-in',
  how: '/start/how-it-works',
  providers: '/providers',
  channels: '/channels',
  agents: '/features/agents',
  apps: '/features/apps',
  chats: '/features/chats',
  makeApps: '/features/make-apps',
  workRuns: '/features/where-work-runs',
  decisions: '/project/decisions',
  nacre: '/project/nacre',
  privacy: '/privacy',
} as const;

const channels = reference.channels.filter((channel) => channel.available);
const local = reference.providers.find((provider) => provider.can.offline);
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

/** Download Conch, and Read the docs beside it. */
function Download() {
  return (
    <DownloadApp>
      <Button size="lg" variant="surface" tone="neutral" trailingIcon={<ArrowRight />} asChild>
        <Link to={LANDING_LINKS.docs}>Read the docs</Link>
      </Button>
    </DownloadApp>
  );
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
              <Badge tone="accent">Open source</Badge>
              <Badge tone="neutral">{VERSION_LABEL}</Badge>
            </>
          }
          title={
            <>
              The AI assistant that just works.
              <br />
              <em>Let it solve your problems.</em>
            </>
          }
          lede="Agents of your own, on the AI plans and keys you already have. It sets itself up, fixes what breaks, and asks only when it has to."
          actions={
            <>
              <Download />
              <InstallCommand typed />
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
            `${local?.name ?? 'On this computer'}: a model that’s private, free and works offline.`,
            'Paste a key. Conch knows whose it is, or asks.',
            'At a usage limit, the next plan or key with room carries on.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.providers}>Compare the providers</Link>
            </TextLink>
          }
        >
          <p>
            Sign in with a plan or paste an API key. Every model joins one list, and a chat can
            switch without losing its thread.
          </p>
        </Scene>

        <Scene
          flip
          kicker="Your agents"
          title={
            <>
              A name, a face, <em>a voice of its own.</em>
            </>
          }
          stage={<AgentsDemo />}
          points={[
            'Pick one of Conch’s faces, upload a picture, or make one with AI.',
            <>
              Pick who answers each chat, task and routine. In a chat app, <code>/agent</code>{' '}
              switches.
            </>,
            'They share what Conch knows about you, so you never say it twice.',
            'Coming from OpenClaw or Hermes? Your agents come too.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.agents}>Make an agent</Link>
            </TextLink>
          }
        >
          <p>
            Make as many as you like, each with its own personality and instructions. When something
            fails, it works out why, tries another way and checks the result before saying it’s
            done.
          </p>
        </Scene>

        <Scene
          kicker="In the chat"
          title={
            <>
              It knows what it can do. <em>So ask.</em>
            </>
          }
          stage={<KnowsDemo />}
          points={[
            'Your calendar, email, files and messages, shown as they are.',
            'Questions come with answers to tap, and its plan ticks itself off as it goes.',
            'What you might say next is one tap away.',
            'It never turns anything on by itself.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.chats}>What a chat can do</Link>
            </TextLink>
          }
        >
          <p>
            Need an app or a skill that isn’t on yet? The card to turn it on is under the reply.
            Once it’s on, the chat carries on by itself.
          </p>
        </Scene>

        <Scene
          flip
          kicker="Make it yours"
          title={
            <>
              Ask for an app. <em>It builds one.</em>
            </>
          }
          stage={<MakerDemo />}
          points={[
            'It works with every model, and its page looks like Conch, light or dark.',
            'It runs sealed off: its own notes, and only the websites its card names.',
            <>
              Nothing is added until you press <strong>Add to my apps</strong>.
            </>,
            'Share it on GitHub in one press, or add someone else’s from a link.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.makeApps}>Make an app</Link>
            </TextLink>
          }
        >
          <p>
            Say what you need in your own words. Conch writes the app, tries every part of it and
            shows it to you as a card.
          </p>
        </Scene>

        <Scene
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
            It stops you for two things: an approval that matters, and what only a person can do.
            After a chat reads a web page or an email, anything that could send your things out or
            change your computer asks first, in every mode.
          </p>
        </Scene>

        <Scene
          flip
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
            'Your own browser, cookies and sign-ins are never touched.',
          ]}
        >
          <p>
            Conch has its own browser, with nothing to install. Watch it live beside the chat, a
            small pearl where it’s about to click, and take the wheel any time.
          </p>
        </Scene>

        <Scene
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
            {channels.length - 4} more. Most connect outward, so nothing is opened to the internet.
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

        <Scene
          flip
          kicker="It fixes itself"
          title={
            <>
              Something broke? <em>It’s already fixed.</em>
            </>
          }
          stage={<RepairDemo />}
          points={[
            'Nothing to install first: it fetches what it needs.',
            <>
              One <strong>Repair everything</strong> button, for when you want to be sure.
            </>,
            'Daily backups and signed updates, on their own.',
          ]}
          action={
            <TextLink arrow="forward" asChild>
              <Link to={LANDING_LINKS.health}>How it looks after itself</Link>
            </TextLink>
          }
        >
          <p>
            Conch watches every part of itself and mends what it can. When it needs you, like a
            fresh sign-in, you get one plain sentence and the button that does it.
          </p>
        </Scene>

        <Band title="And the rest of a day’s work" lede="Each of these is the app itself, playing.">
          <Bento>
            <Bento.Tile
              span={3}
              title="It remembers, in the open"
              text="Memories are small Markdown files you can read, edit or delete. It learns quietly from your corrections, and asks only when something looks unsafe."
              picture="Three things Conch remembered, each a short note"
            >
              <MemoryDemo />
            </Bento.Tile>
            <Bento.Tile
              span={3}
              index={1}
              title="Everything can be put back"
              text="Every file an agent makes, changes or deletes, whichever provider did it. You see what will change first."
              picture="Three files an agent changed, undone with one press"
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
              text="Send a job to the background and keep chatting. A waiting one says why, and the result comes back where you asked."
              picture="A background task working through its steps, then finishing"
            >
              <TaskDemo />
            </Bento.Tile>
            <Bento.Tile
              span={2}
              index={4}
              title="At a time, or when it happens"
              text="Routines run at a time you read in plain words, or when something happens, like an email from someone. Say “tell me if my flight changes” once, and it speaks up only when it does. Watching is free, and nothing runs until you turn it on."
              picture="A routine your assistant drafted to tell you when someone emails, waiting to be turned on"
            >
              <RoutineDemo />
            </Bento.Tile>
            <Bento.Tile
              span={4}
              index={5}
              title="It tells you what it fixed"
              text="What Conch mended while you were away, as a quiet list, not an alarm. Nothing for you to do."
              picture="Three things Conch fixed on its own"
            >
              <HealedDemo />
            </Bento.Tile>
            <Bento.Tile
              span={3}
              index={6}
              title="Your own domain"
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
              Chats, memories, skills and settings are plain files in <code>~/.conch</code>. Conch
              keeps no copy anywhere else.
            </>
          }
        >
          <Reveal>
            <HowItWorks />
          </Reveal>
        </Band>

        <Band title="Good to know">
          <Bento>
            <Bento.Tile
              span={2}
              title="It runs where you work"
              text="An app for macOS, Linux and Windows, or one line in a terminal, on your computer or a server."
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
                  Conch can read your files and run commands. Treat it like an SSH server, or{' '}
                  <TextLink asChild>
                    <Link to={LANDING_LINKS.workRuns}>run the work in a locked-down box</Link>
                  </TextLink>
                  , and read{' '}
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
            I built Conch for myself. I wanted an assistant that fixes my problems, not one I have
            to keep fixing.
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
            <Download />
            <InstallCommand />
          </Reveal>
        </section>

        <footer className={styles.footer}>
          <Text as="span" size="sm" tone="muted">
            Conch {VERSION_LABEL}. Made with{' '}
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
            <TextLink href="/releases/">Release notes</TextLink>
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
