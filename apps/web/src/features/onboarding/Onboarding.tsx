import {
  FirstJobKind,
  type ImportSourceId,
  type ImportStatus,
  type Persona,
  type Profile,
} from '@conch/protocol';
import {
  Button,
  Collapsible,
  Field,
  Heading,
  ImportOffer,
  Input,
  Pearl,
  RadioGroup,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useImportStatus } from '../import/api';
import { ComeHomeDialog } from '../import/ComeHomeDialog';
import { ProviderSetup } from '../providers/ProviderSetup';
import styles from './Onboarding.module.css';
import { toneOptions } from './tones';
import { ChooseFirstJob, FirstJob, JOBS, newFirstJobDraft } from './FirstJob';
import { firstJobKey, useFirstJob } from './first-job';

const allSteps = [
  'welcome',
  'goal',
  'connect',
  'outcome',
  'home',
  'persona',
  'about',
  'done',
] as const;
type Step = (typeof allSteps)[number];

function Progress({ step, steps }: { step: Step; steps: readonly Step[] }) {
  const index = steps.indexOf(step);
  return (
    <ol className={styles.progress} aria-label={`Step ${index} of ${steps.length - 1}`}>
      {steps.slice(1).map((s, i) => (
        <li key={s} data-state={i + 1 < index ? 'done' : i + 1 === index ? 'current' : 'todo'} />
      ))}
    </ol>
  );
}

function StepFrame({
  eyebrow,
  title,
  lead,
  children,
  footer,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={styles.step}>
      <Stack gap={2}>
        {eyebrow && (
          <Text size="sm" weight="medium" tone="accent">
            {eyebrow}
          </Text>
        )}
        <Heading level={1} display size="4xl">
          {title}
        </Heading>
        {lead && (
          <Text size="lg" tone="muted">
            {lead}
          </Text>
        )}
      </Stack>
      {children}
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <div className={styles.welcome}>
      <Pearl size="xl" state="thinking" label={null} className={styles.welcomePearl} />
      <Heading level={1} display size="5xl" align="center">
        Hello.
      </Heading>
      <Text size="lg" tone="muted" align="center" className={styles.welcomeLead}>
        I’m Conch. I set myself up, fix what breaks, and ask you only when I have to.
      </Text>
      <Button ref={ref} size="lg" trailingIcon={<ArrowRight />} onClick={onNext}>
        Get started
      </Button>
      <Text size="xs" tone="subtle" align="center">
        Your history is saved on this computer. Cloud providers receive the content needed to
        answer.
      </Text>
    </div>
  );
}

function PersonaStep({
  initial,
  onNext,
  onSkip,
}: {
  initial: Persona;
  onNext: (persona: Persona) => void;
  onSkip: () => void;
}) {
  const [persona, setPersona] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onNext({ ...persona, name: persona.name.trim() || 'Conch' });
  };
  return (
    <form onSubmit={submit}>
      <StepFrame
        eyebrow="Make it yours"
        title="Give me a personality"
        lead="You can change all of this later in Settings."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
            <Button type="submit" trailingIcon={<ArrowRight />}>
              Continue
            </Button>
          </>
        }
      >
        <Stack gap={5}>
          <Field>
            <Field.Label>What should I be called?</Field.Label>
            <Input
              value={persona.name}
              maxLength={40}
              placeholder="Conch"
              onChange={(e) => setPersona({ ...persona, name: e.target.value })}
            />
          </Field>
          <Stack gap={2}>
            <Text as="span" size="sm" weight="medium" id="tone-label">
              How should I sound?
            </Text>
            <RadioGroup
              variant="card"
              aria-labelledby="tone-label"
              value={persona.tone}
              onValueChange={(tone) => setPersona({ ...persona, tone: tone as Persona['tone'] })}
              className={styles.tones}
            >
              {toneOptions.map((t) => (
                <RadioGroup.Item
                  key={t.value}
                  value={t.value}
                  label={t.label}
                  description={t.sample}
                />
              ))}
            </RadioGroup>
          </Stack>
          <Collapsible defaultOpen={Boolean(persona.instructions)}>
            <Collapsible.Trigger className={styles.disclosure}>
              Add your own instructions
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div className={styles.disclosed}>
                <Field>
                  <Field.Label>Instructions</Field.Label>
                  <Textarea
                    autosize
                    minRows={3}
                    maxRows={8}
                    value={persona.instructions}
                    placeholder="Always use British spelling. When I share code, suggest tests."
                    onChange={(e) => setPersona({ ...persona, instructions: e.target.value })}
                  />
                </Field>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </Stack>
      </StepFrame>
    </form>
  );
}

function AboutStep({
  initial,
  onNext,
  onSkip,
}: {
  initial: Profile;
  onNext: (profile: Profile) => void;
  onSkip: () => void;
}) {
  const [profile, setProfile] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext(profile);
      }}
    >
      <StepFrame
        eyebrow="A little about you"
        title="Tell me about yourself"
        lead="Optional. It helps me make future work more useful to you."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
            <Button type="submit" trailingIcon={<ArrowRight />}>
              Continue
            </Button>
          </>
        }
      >
        <Stack gap={5}>
          <Field>
            <Field.Label>What should I call you?</Field.Label>
            <Input
              value={profile.name}
              autoComplete="given-name"
              placeholder="Your name"
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </Field>
          <Field>
            <Field.Label>Anything I should know?</Field.Label>
            <Textarea
              autosize
              minRows={4}
              maxRows={10}
              value={profile.about}
              placeholder="I’m a product designer in Lisbon. I like short answers, and I’m learning Rust."
              onChange={(e) => setProfile({ ...profile, about: e.target.value })}
            />
            <Field.Description>
              Saved on this computer and shared with your selected provider when it helps answer.
              Change or delete it in Settings.
            </Field.Description>
          </Field>
        </Stack>
      </StepFrame>
    </form>
  );
}

function Done({
  name,
  onFinish,
  finishing,
}: {
  name: string;
  onFinish: () => void;
  finishing: boolean;
}) {
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <div className={styles.welcome}>
      <Pearl size="lg" state="streaming" label={null} />
      <Heading level={1} display size="5xl" align="center">
        Make yourself at home{name ? `, ${name}` : ''}.
      </Heading>
      <Text size="lg" tone="muted" align="center" className={styles.welcomeLead}>
        Your work is saved. You can adjust how Conch talks and what it knows about you at any time
        in Settings.
      </Text>
      <Button
        ref={ref}
        size="lg"
        trailingIcon={<ArrowRight />}
        onClick={onFinish}
        loading={finishing}
      >
        Open Conch
      </Button>
    </div>
  );
}

/**
 * Come home (ADR 0035), offered once: another assistant is on this computer,
 * so its memories, skills and routines can come with you.
 */
function HomeStep({
  status,
  onDone,
  onSkip,
}: {
  status: ImportStatus;
  onDone: () => void;
  onSkip: () => void;
}) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [open, setOpen] = useState<ImportSourceId>();
  const [brought, setBrought] = useState(false);
  const first = status.sources[0];
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <StepFrame
      eyebrow="Welcome home"
      title={
        status.sources.length === 1 && first
          ? `Bring your things from ${first.label}?`
          : 'Bring your things with you?'
      }
      lead="Conch found another assistant here. See exactly what would come over first: nothing moves until you say, and you can undo it."
      footer={
        brought ? (
          <Button trailingIcon={<ArrowRight />} onClick={onDone}>
            Continue
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Not now
          </Button>
        )
      }
    >
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
      <ComeHomeDialog
        source={open}
        guard={guard}
        onImported={() => setBrought(true)}
        onClose={() => {
          setOpen(undefined);
          if (brought) onDone();
        }}
      />
      {dialog}
    </StepFrame>
  );
}

/** Choose a job, connect its needs, inspect its result. Personalisation comes afterwards. */
export function Onboarding() {
  const state = useAppState();
  const update = useUpdateSettings();
  const navigate = useNavigate();
  const client = useQueryClient();
  const firstJob = useFirstJob();
  const [requestedStep, setStep] = useState<Step>('welcome');
  const [draft, setDraft] = useState(newFirstJobDraft);
  const [kind, setKind] = useState<FirstJobKind>(() => {
    try {
      return FirstJobKind.parse(sessionStorage.getItem('conch:first-job-kind'));
    } catch {
      return 'document';
    }
  });
  const step = requestedStep === 'welcome' && firstJob.data?.task ? 'outcome' : requestedStep;
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const imports = useImportStatus();
  // Offered only when there's something to bring.
  const home = imports.data?.sources.length ? imports.data : undefined;
  const steps = allSteps.filter((s) => s !== 'home' || home);
  const progressSteps: readonly Step[] = ['goal', 'connect', 'outcome'].includes(step)
    ? ['welcome', 'goal', 'connect', 'outcome']
    : ['welcome', ...steps.filter((s) => ['home', 'persona', 'about'].includes(s))];

  if (!state.data) return null;
  const { persona, profile } = state.data;
  const task = firstJob.data?.task;
  const jobKind = task?.workflow ?? kind;
  const finish = async (conversationId?: string) => {
    try {
      await update.mutateAsync({ onboarded: true });
      try {
        sessionStorage.removeItem('conch:first-job-kind');
      } catch {
        /* Not required to finish. */
      }
      if (conversationId) await navigate(`/c/${conversationId}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const go = (next: Step) => {
    setDirection(steps.indexOf(next) >= steps.indexOf(step) ? 'forward' : 'back');
    setStep(next);
  };
  const save = async (body: Parameters<typeof update.mutateAsync>[0], next: Step) => {
    try {
      await update.mutateAsync(body);
      go(next);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      {step !== 'welcome' && step !== 'done' && <Progress step={step} steps={progressSteps} />}
      <div key={step} className={styles.stage} data-direction={direction}>
        {step === 'welcome' && <Welcome onNext={() => go('goal')} />}
        {step === 'goal' && (
          <StepFrame
            eyebrow="Something useful first"
            title="What would you like help with?"
            lead="Pick one job. Connect only what it needs, then see a real result."
          >
            <ChooseFirstJob
              value={kind}
              onChange={(next) => {
                setKind(next);
                try {
                  sessionStorage.setItem('conch:first-job-kind', next);
                } catch {
                  /* Optional convenience only. */
                }
              }}
              onNext={() => go('connect')}
              onSkip={() => void finish()}
            />
          </StepFrame>
        )}
        {step === 'connect' && (
          <StepFrame
            eyebrow="Connect"
            title="Connect what powers your assistant"
            lead="Use a subscription you already have, a model API, or a model on this computer. Your job stays the same."
          >
            <ProviderSetup onReady={() => setStep((s) => (s === 'connect' ? 'outcome' : s))} />
          </StepFrame>
        )}
        {step === 'outcome' && (
          <StepFrame
            eyebrow={task ? 'Your first result' : 'Just what this job needs'}
            title={JOBS.find((job) => job.id === jobKind)?.title ?? 'Your first result'}
          >
            <FirstJob
              kind={jobKind}
              task={task}
              draft={draft}
              onDraft={setDraft}
              onSaved={(task) => client.setQueryData(firstJobKey, { task })}
              onFinished={(id) => void finish(id)}
              onPersonalize={() => go(home ? 'home' : 'persona')}
              onBack={() => go('goal')}
              onProvider={() => go('connect')}
            />
          </StepFrame>
        )}
        {step === 'home' && home && (
          <HomeStep status={home} onDone={() => go('done')} onSkip={() => go('persona')} />
        )}
        {step === 'persona' && (
          <PersonaStep
            initial={persona}
            onNext={(p) => void save({ persona: p }, 'about')}
            onSkip={() => go('about')}
          />
        )}
        {step === 'about' && (
          <AboutStep
            initial={profile}
            onNext={(p) => void save({ profile: p }, 'done')}
            onSkip={() => go('done')}
          />
        )}
        {step === 'done' && (
          <Done
            name={profile.name}
            finishing={update.isPending}
            onFinish={() => void finish(task?.conversationId)}
          />
        )}
      </div>
    </main>
  );
}
