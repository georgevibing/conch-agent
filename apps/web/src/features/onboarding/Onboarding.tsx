import {
  AgentAvatar,
  Button,
  Heading,
  Pearl,
  Text,
  WelcomeBackdrop,
  WelcomeName,
  WelcomeRise,
  WelcomeStage,
  WelcomeStarters,
  WelcomeSteps,
  toast,
  type AgentFace,
} from '@conch/nacre';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { useDefaultAgent } from '../agents/api';
import { ProviderSetup } from '../providers/ProviderSetup';
import { useProviders } from '../providers/queries';
import styles from './Onboarding.module.css';
import { interestsIn, startersFor } from './welcome';

/**
 * The welcome (ADR 0068): three calm screens. Hello and your name together, a
 * mind to think with (which can wait), and somewhere to start. Everything else
 * is offered later, where it helps: the assistant's name, face and voice in
 * Settings → Agents; apps, things from another assistant and past chats on the
 * new chat (ADR 0060), and right in a chat when one would help.
 */

type Step = 'hello' | 'mind' | 'ready';
const STEPS: readonly Step[] = ['hello', 'mind', 'ready'];
const STEP_KEY = 'conch:welcome-step';

function remembered(): Step {
  try {
    // A step from an older, longer welcome starts again at the hello.
    return sessionStorage.getItem(STEP_KEY) === 'mind' ? 'mind' : 'hello';
  } catch {
    return 'hello';
  }
}

/** Hello and your name, together: who it is, where things stay, and what to call you. */
function Hello({ initial, onNext }: { initial: string; onNext: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const ref = useAutoFocus<HTMLInputElement>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onNext(name.trim());
  };
  return (
    <form onSubmit={submit} className={styles.form}>
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
          Your own assistant, on your own computer. What should I call you?
        </Text>
      </WelcomeRise>
      <WelcomeRise order={3}>
        <WelcomeName
          ref={ref}
          label="Your name"
          placeholder="Your name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </WelcomeRise>
      <WelcomeRise order={4} className={styles.actions}>
        <Button type="submit" size="lg" trailingIcon={<ArrowRight />}>
          Let’s begin
        </Button>
      </WelcomeRise>
      <WelcomeRise order={5}>
        <Text size="xs" tone="subtle" align="center" className={styles.lead}>
          Everything stays on this computer. A model you connect sees only what it needs to answer.
        </Text>
      </WelcomeRise>
    </form>
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
          <Button variant="ghost" onClick={onNext}>
            I’ll do this later
          </Button>
        </WelcomeRise>
      )}
    </>
  );
}

function Ready({
  name,
  agent,
  starters,
  finishing,
  onFinish,
}: {
  name: string;
  /** The first agent (ADR 0101): its face greets them here. */
  agent?: { name: string; avatar: AgentFace };
  starters: string[];
  finishing: boolean;
  onFinish: (draft?: string) => void;
}) {
  const ref = useAutoFocus<HTMLButtonElement>();
  return (
    <>
      <WelcomeRise order={0}>
        {agent ? (
          <AgentAvatar name={agent.name} avatar={agent.avatar} size="3xl" decorative />
        ) : (
          <Pearl size="xl" state="streaming" label={null} className={styles.pearl} />
        )}
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
  // The agent the welcome makes yours: the first one (ADR 0101), with the name and voice it
  // came with. Settings → Agents changes them.
  const me = useDefaultAgent();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(remembered);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  useEffect(() => {
    try {
      sessionStorage.setItem(STEP_KEY, step);
    } catch {
      /* A convenience only. */
    }
  }, [step]);

  if (!state.data) return null;
  const { profile } = state.data;
  // Somewhere to start: from what an earlier welcome kept in About you, if anything, else for anyone.
  const starters = startersFor(interestsIn(profile.about));

  const at = STEPS.indexOf(step);
  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) >= at ? 'forward' : 'back');
    setStep(next);
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

  return (
    <main className={styles.root}>
      <WelcomeBackdrop progress={at / (STEPS.length - 1)} />
      <div className={styles.top}>
        {at > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.back}
            onClick={() => go(STEPS[at - 1] ?? 'hello')}
          >
            Back
          </Button>
        )}
        <WelcomeSteps count={STEPS.length} current={at} />
      </div>
      <WelcomeStage key={step} direction={direction} className={styles.stage}>
        {step === 'hello' && (
          <Hello
            initial={profile.name}
            onNext={(name) => {
              // Save it and carry on even if saving failed (it says so).
              go('mind');
              update
                .mutateAsync({ profile: { ...profile, name } })
                .catch((e: unknown) => toast.error((e as Error).message));
            }}
          />
        )}
        {step === 'mind' && <MindStep onNext={() => go('ready')} />}
        {step === 'ready' && (
          <Ready
            name={profile.name}
            agent={me}
            starters={starters}
            finishing={update.isPending}
            onFinish={(draft) => void finish(draft)}
          />
        )}
      </WelcomeStage>
    </main>
  );
}
