import type { ImportSourceId, ImportStatus, Tone } from '@conch/protocol';
import {
  Button,
  Heading,
  ImportOffer,
  Pearl,
  SegmentedControl,
  Stack,
  Text,
  WelcomeApps,
  WelcomeBackdrop,
  WelcomeChoices,
  WelcomeName,
  WelcomeRise,
  WelcomeStage,
  WelcomeStarters,
  WelcomeSteps,
  WelcomeVoice,
  toast,
} from '@conch/nacre';
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  Code,
  GraduationCap,
  House,
  Lightbulb,
  Mail,
  PenLine,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useImportStatus } from '../import/api';
import { ComeHomeDialog } from '../import/ComeHomeDialog';
import { ConnectDialog } from '../integrations/ConnectDialog';
import { useIntegrations } from '../integrations/queries';
import { ProviderSetup } from '../providers/ProviderSetup';
import { useProviders } from '../providers/queries';
import styles from './Onboarding.module.css';
import {
  INTERESTS,
  VOICES,
  aboutWith,
  appsFor,
  hello,
  interestsIn,
  startersFor,
  type Interest,
} from './welcome';

/**
 * The welcome (ADR 0068): the absolute basics, one calm thing at a time. Your
 * name, what you'd like a hand with (tapped), how the assistant should sound
 * (heard), a mind to think with, and the apps you live in, each skippable but
 * the name's. Then three things to ask first, made from what you picked.
 */

const ICONS: Record<Interest, ReactNode> = {
  writing: <PenLine />,
  coding: <Code />,
  research: <Search />,
  email: <Mail />,
  planning: <CalendarDays />,
  work: <Briefcase />,
  learning: <GraduationCap />,
  ideas: <Lightbulb />,
  life: <House />,
};

type Step = 'hello' | 'name' | 'help' | 'voice' | 'mind' | 'apps' | 'home' | 'ready';
const STEP_KEY = 'conch:welcome-step';

function remembered(): Step {
  try {
    const step = sessionStorage.getItem(STEP_KEY);
    return step && ['name', 'help', 'voice', 'mind', 'apps'].includes(step)
      ? (step as Step)
      : 'hello';
  } catch {
    return 'hello';
  }
}

/** The line under a stage's buttons: a quiet way past it. */
function Later({ onClick, children = 'Not now' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button variant="ghost" onClick={onClick}>
      {children}
    </Button>
  );
}

function Hello({ onNext }: { onNext: () => void }) {
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <>
      <WelcomeRise order={0}>
        <Pearl size="xl" state="thinking" label={null} className={styles.pearl} />
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Heading level={1} display size="5xl" align="center">
          Hi, I’m Conch.
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={2}>
        <Text size="lg" tone="muted" align="center" className={styles.lead}>
          Your own assistant, on your own computer. Let’s get to know each other. It takes a minute.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={3}>
        <Button ref={ref} size="lg" trailingIcon={<ArrowRight />} onClick={onNext}>
          Let’s begin
        </Button>
      </WelcomeRise>
      <WelcomeRise order={5}>
        <Text size="xs" tone="subtle" align="center" className={styles.lead}>
          Everything stays on this computer. A model you connect sees only what it needs to answer.
        </Text>
      </WelcomeRise>
    </>
  );
}

function NameStep({ initial, onNext }: { initial: string; onNext: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const ref = useAutoFocus<HTMLInputElement>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onNext(name.trim());
  };
  return (
    <form onSubmit={submit} className={styles.form}>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          First, what should I call you?
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <WelcomeName
          ref={ref}
          label="Your name"
          placeholder="Your name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </WelcomeRise>
      <WelcomeRise order={2} className={styles.actions}>
        <Button type="submit" size="lg" trailingIcon={<ArrowRight />}>
          {name.trim() ? 'Continue' : 'Skip'}
        </Button>
      </WelcomeRise>
    </form>
  );
}

function HelpStep({
  name,
  initial,
  onNext,
}: {
  name: string;
  initial: Interest[];
  onNext: (picked: Interest[]) => void;
}) {
  const [picked, setPicked] = useState<Interest[]>(initial);
  return (
    <>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          {name ? `Nice to meet you, ${name}.` : 'Nice to meet you.'}
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Text size="lg" tone="muted" align="center">
          What would you like a hand with? Pick as many as you like.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={2}>
        <WelcomeChoices
          label="What you’d like a hand with"
          choices={INTERESTS.map((i) => ({ value: i.value, label: i.label, icon: ICONS[i.value] }))}
          value={picked}
          onChange={(next) => setPicked(next as Interest[])}
        />
      </WelcomeRise>
      <WelcomeRise order={4} className={styles.actions}>
        <Button size="lg" trailingIcon={<ArrowRight />} onClick={() => onNext(picked)}>
          {picked.length ? 'Continue' : 'Skip'}
        </Button>
      </WelcomeRise>
    </>
  );
}

function VoiceStep({
  name,
  assistant,
  initial,
  onNext,
}: {
  name: string;
  assistant: string;
  initial: Tone;
  onNext: (tone: Tone) => void;
}) {
  const [tone, setTone] = useState<Tone>(initial);
  return (
    <>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          How should I sound?
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <WelcomeVoice from={assistant} text={hello(tone, name)} />
      </WelcomeRise>
      <WelcomeRise order={2}>
        <SegmentedControl
          aria-label="How I should sound"
          size="md"
          value={tone}
          onValueChange={(v) => v && setTone(v as Tone)}
        >
          {VOICES.map((v) => (
            <SegmentedControl.Item key={v.value} value={v.value}>
              {v.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </WelcomeRise>
      <WelcomeRise order={3} className={styles.actions}>
        <Button size="lg" trailingIcon={<ArrowRight />} onClick={() => onNext(tone)}>
          Sounds good
        </Button>
      </WelcomeRise>
    </>
  );
}

function MindStep({ onNext }: { onNext: () => void }) {
  const providers = useProviders();
  // Once one works, ProviderSetup says so and moves on by itself: no way to put it off.
  const ready = providers.data?.providers.some((p) => p.active && p.status.state === 'ready');
  return (
    <>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          Now, a mind to think with.
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Text size="lg" tone="muted" align="center" className={styles.lead}>
          A plan you already pay for, a model on this computer, or a key. You can add more, and
          switch any time.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={2} className={styles.wide}>
        <ProviderSetup onReady={onNext} />
      </WelcomeRise>
      {!ready && (
        <WelcomeRise order={3} className={styles.actions}>
          <Later onClick={onNext}>I’ll do this later</Later>
        </WelcomeRise>
      )}
    </>
  );
}

function AppsStep({ picked, onNext }: { picked: Interest[]; onNext: () => void }) {
  const integrations = useIntegrations();
  const [open, setOpen] = useState<string>();
  const catalog = useMemo(() => integrations.data?.catalog ?? [], [integrations.data]);
  const ids = useMemo(
    () => appsFor(picked, new Set(catalog.map((entry) => entry.id))),
    [picked, catalog],
  );
  const connected = new Set(
    (integrations.data?.integrations ?? [])
      .filter((i) => i.enabled && i.catalogId)
      .map((i) => i.catalogId),
  );
  const apps = ids.flatMap((id) => {
    const entry = catalog.find((e) => e.id === id);
    return entry
      ? [
          {
            id,
            name: entry.name,
            ...(entry.color && { color: entry.color }),
            connected: connected.has(id),
          },
        ]
      : [];
  });
  const any = apps.some((app) => app.connected);
  return (
    <>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          Bring the apps you live in.
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Text size="lg" tone="muted" align="center" className={styles.lead}>
          Tap one to connect it. Or don’t: when one would help, I’ll offer it right in the chat.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={2} className={styles.wide}>
        {apps.length > 0 && <WelcomeApps label="Apps to connect" apps={apps} onPick={setOpen} />}
      </WelcomeRise>
      <WelcomeRise order={4} className={styles.actions}>
        <Button size="lg" trailingIcon={<ArrowRight />} onClick={onNext}>
          {any ? 'Continue' : 'Skip for now'}
        </Button>
      </WelcomeRise>
      {open && (
        <ConnectDialog
          entry={catalog.find((e) => e.id === open)}
          onOpenChange={(next) => !next && setOpen(undefined)}
        />
      )}
    </>
  );
}

/**
 * Come home (ADR 0035), offered once: another assistant is on this computer,
 * so its memories, skills and routines can come with you.
 */
function HomeStep({ status, onNext }: { status: ImportStatus; onNext: () => void }) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [open, setOpen] = useState<ImportSourceId>();
  const [brought, setBrought] = useState(false);
  const first = status.sources[0];
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <>
      <WelcomeRise order={0}>
        <Heading level={1} display size="4xl" align="center">
          {status.sources.length === 1 && first
            ? `Bring your things from ${first.label}?`
            : 'Bring your things with you?'}
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Text size="lg" tone="muted" align="center" className={styles.lead}>
          I found another assistant here. See exactly what would come over first: nothing moves
          until you say, and you can undo it.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={2} className={styles.wide}>
        <Stack gap={3}>
          {status.sources.map((s, i) => (
            <ImportOffer
              key={s.id}
              from={s.label}
              summary={s.summary}
              action={
                <Button ref={i === 0 ? ref : undefined} size="sm" onClick={() => setOpen(s.id)}>
                  Take a look
                </Button>
              }
            />
          ))}
        </Stack>
      </WelcomeRise>
      <WelcomeRise order={3} className={styles.actions}>
        {brought ? (
          <Button size="lg" trailingIcon={<ArrowRight />} onClick={onNext}>
            Continue
          </Button>
        ) : (
          <Later onClick={onNext} />
        )}
      </WelcomeRise>
      <ComeHomeDialog
        source={open}
        guard={guard}
        onImported={() => setBrought(true)}
        onClose={() => {
          setOpen(undefined);
          if (brought) onNext();
        }}
      />
      {dialog}
    </>
  );
}

function Ready({
  name,
  starters,
  finishing,
  onFinish,
}: {
  name: string;
  starters: string[];
  finishing: boolean;
  onFinish: (draft?: string) => void;
}) {
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <>
      <WelcomeRise order={0}>
        <Pearl size="xl" state="streaming" label={null} className={styles.pearl} />
      </WelcomeRise>
      <WelcomeRise order={1}>
        <Heading level={1} display size="5xl" align="center">
          {name ? `You’re all set, ${name}.` : 'You’re all set.'}
        </Heading>
      </WelcomeRise>
      <WelcomeRise order={2}>
        <Text size="lg" tone="muted" align="center" className={styles.lead}>
          Here’s something to start with. Or just say hello.
        </Text>
      </WelcomeRise>
      <WelcomeRise order={3}>
        <WelcomeStarters
          label="Something to ask first"
          starters={starters}
          onPick={(text) => onFinish(text)}
        />
      </WelcomeRise>
      <WelcomeRise order={5} className={styles.actions}>
        <Button
          ref={ref}
          size="lg"
          trailingIcon={<ArrowRight />}
          loading={finishing}
          onClick={() => onFinish()}
        >
          Open Conch
        </Button>
      </WelcomeRise>
    </>
  );
}

export function Onboarding() {
  const state = useAppState();
  const update = useUpdateSettings();
  const navigate = useNavigate();
  const imports = useImportStatus();
  const [step, setStep] = useState<Step>(remembered);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const about = state.data?.profile.about ?? '';
  const [picked, setPicked] = useState<Interest[]>(() => interestsIn(about));

  // Offered only when there's something to bring.
  const home = imports.data?.sources.length ? imports.data : undefined;
  const steps: Step[] = ['hello', 'name', 'help', 'voice', 'mind', 'apps'];
  if (home) steps.push('home');
  steps.push('ready');
  const between = steps.slice(1, -1);

  useEffect(() => {
    try {
      sessionStorage.setItem(STEP_KEY, step);
    } catch {
      /* A convenience only. */
    }
  }, [step]);

  if (!state.data) return null;
  const { persona, profile } = state.data;

  const go = (next: Step) => {
    setDirection(steps.indexOf(next) >= steps.indexOf(step) ? 'forward' : 'back');
    setStep(next);
  };
  const after = (current: Step) => steps[steps.indexOf(current) + 1] ?? 'ready';
  /** Save what this step said, and carry on even if saving failed (it says so). */
  const saveThen = (body: Parameters<typeof update.mutateAsync>[0], current: Step) => {
    go(after(current));
    update.mutateAsync(body).catch((e: unknown) => toast.error((e as Error).message));
  };

  const finish = async (draft?: string) => {
    try {
      // Where to land first, with the words for the composer: marking the welcome done swaps
      // it for the chat at once, which reads its draft from this entry as it opens.
      await navigate('/', draft ? { state: { draft } } : undefined);
      await update.mutateAsync({ onboarded: true });
      try {
        sessionStorage.removeItem(STEP_KEY);
      } catch {
        /* Not needed to finish. */
      }
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const at = between.indexOf(step);
  return (
    <main className={styles.root}>
      <WelcomeBackdrop progress={Math.max(0, steps.indexOf(step)) / (steps.length - 1)} />
      <div className={styles.top}>
        {at >= 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className={styles.back}
              onClick={() => go(steps[steps.indexOf(step) - 1] ?? 'hello')}
            >
              Back
            </Button>
            <WelcomeSteps count={between.length} current={at} />
          </>
        )}
      </div>
      <WelcomeStage key={step} direction={direction} className={styles.stage}>
        {step === 'hello' && <Hello onNext={() => go('name')} />}
        {step === 'name' && (
          <NameStep
            initial={profile.name}
            onNext={(name) => saveThen({ profile: { ...profile, name } }, 'name')}
          />
        )}
        {step === 'help' && (
          <HelpStep
            name={profile.name}
            initial={picked}
            onNext={(next) => {
              setPicked(next);
              saveThen({ profile: { ...profile, about: aboutWith(profile.about, next) } }, 'help');
            }}
          />
        )}
        {step === 'voice' && (
          <VoiceStep
            name={profile.name}
            assistant={persona.name}
            initial={persona.tone}
            onNext={(tone) => saveThen({ persona: { ...persona, tone } }, 'voice')}
          />
        )}
        {step === 'mind' && <MindStep onNext={() => go(after('mind'))} />}
        {step === 'apps' && <AppsStep picked={picked} onNext={() => go(after('apps'))} />}
        {step === 'home' && home && <HomeStep status={home} onNext={() => go('ready')} />}
        {step === 'ready' && (
          <Ready
            name={profile.name}
            starters={startersFor(picked)}
            finishing={update.isPending}
            onFinish={(draft) => void finish(draft)}
          />
        )}
      </WelcomeStage>
    </main>
  );
}
