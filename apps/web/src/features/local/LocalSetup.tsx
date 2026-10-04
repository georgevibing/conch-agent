import type { LocalOffer, LocalPull, LocalStatus, Provider } from '@conch/protocol';
import {
  Badge,
  Button,
  Callout,
  Collapsible,
  RadioGroup,
  SetupChecklist,
  Stack,
  Text,
  type SetupStepState,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Download, Pause, Play, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { keys as appKeys } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText, providerKeys } from '../providers/queries';
import { needKeys, needsApi } from '../setup/api';
import { useNeed } from '../setup/useNeed';
import { localApi, localKeys } from './api';
import { bytes, minutes, timeLeft } from './format';

/**
 * Where Ollama and its models stand, kept fresh while you look: every second
 * while something is on its way, and whenever you come back to the window.
 */
export function useLocalStatus(busy: boolean) {
  return useQuery({
    queryKey: localKeys.status,
    queryFn: () => localApi.status(),
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) =>
      busy || q.state.data?.pull?.state === 'pulling' || q.state.data?.ollama.state === 'starting'
        ? 1000
        : false,
  });
}

/** "1.2 GB of 2.5 GB · about 2 minutes left", or what it's doing when it isn't downloading. */
function progressLabel(pull: LocalPull): string {
  if (pull.phase !== 'Downloading' || pull.totalBytes === undefined) return `${pull.phase}…`;
  const left = timeLeft(pull.secondsLeft);
  return `${bytes(pull.completedBytes)} of ${bytes(pull.totalBytes)}${left ? ` · ${left}` : ''}`;
}

function percentOf(pull: LocalPull): number | undefined {
  if (!pull.totalBytes) return undefined;
  return Math.min(100, Math.round((pull.completedBytes / pull.totalBytes) * 100));
}

/** What the model is, in one line: its size, and whether it can use your apps. */
function modelFacts(model: { sizeBytes: number; tools: boolean; vision?: boolean }): string {
  return [
    bytes(model.sizeBytes),
    model.tools ? 'uses your apps' : 'can’t use your apps or memory',
    model.vision ? 'sees pictures' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function OfferLabel({ offer }: { offer: LocalOffer }) {
  return (
    <Stack asChild inline direction="row" gap={2} align="center" wrap>
      <span>
        <span>{offer.label}</span>
        {offer.recommended && (
          <Badge tone="accent" size="sm">
            Recommended
          </Badge>
        )}
      </span>
    </Stack>
  );
}

/** A handful of models to choose from, as cards; the recommended one first. */
function OfferChoice({
  offers,
  value,
  onChange,
  label,
}: {
  offers: LocalOffer[];
  value: string;
  onChange: (name: string) => void;
  label: string;
}) {
  return (
    <RadioGroup variant="card" aria-label={label} value={value} onValueChange={onChange}>
      {offers.map((offer) => (
        <RadioGroup.Item
          key={offer.name}
          value={offer.name}
          label={<OfferLabel offer={offer} />}
          description={`${bytes(offer.sizeBytes)}, ${minutes(offer.minutes)} to download. ${offer.blurb}`}
        />
      ))}
    </RadioGroup>
  );
}

/** A download in progress, paused or failed, with what can be done about it. */
function PullStep({
  pull,
  onPause,
  onResume,
  onCancel,
  busy,
}: {
  pull: LocalPull;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const cancel = (
    <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={onCancel}>
      Cancel
    </Button>
  );
  if (pull.state === 'pulling')
    return (
      <SetupChecklist.Step
        state="working"
        title={`Get ${pull.label}`}
        progress={{ value: percentOf(pull), label: progressLabel(pull) }}
        action={
          <Stack direction="row" gap={2} wrap>
            <Button size="sm" variant="surface" leadingIcon={<Pause />} onClick={onPause}>
              Pause
            </Button>
            {cancel}
          </Stack>
        }
      />
    );
  const at =
    pull.totalBytes !== undefined
      ? `${bytes(pull.completedBytes)} of ${bytes(pull.totalBytes)}`
      : undefined;
  return (
    <SetupChecklist.Step
      state={pull.state === 'failed' ? 'failed' : 'current'}
      title={`Get ${pull.label}`}
      description={
        pull.state === 'failed'
          ? pull.message
          : `Paused${at ? ` at ${at}` : ''}. It carries on from there.`
      }
      action={
        <Stack direction="row" gap={2} wrap>
          <Button size="sm" leadingIcon={<Play />} loading={busy} onClick={onResume}>
            {pull.state === 'failed' ? 'Try again' : 'Resume'}
          </Button>
          {cancel}
        </Stack>
      }
    />
  );
}

/**
 * A model on this computer, set up as one flow (ADR 0022): get Ollama, get
 * the model this computer suits, and chat. One button does all of it — Conch
 * installs Ollama if it has to, then carries straight on to the download —
 * and the checklist shows each step as it happens. Once there's a model, it's
 * where you pick among the ones you have, or get another.
 */
export function LocalSetup({ provider }: { provider: Provider }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const ollamaNeed = useNeed('ollama');
  const { data: local } = useLocalStatus(ollamaNeed.running);
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** You pressed Get while Ollama wasn't here: this model downloads as soon as it is. */
  const carryOn = useRef<string>(undefined);
  /** The same, for what shows: no Get button while it carries on by itself. */
  const [carrying, setCarrying] = useState(false);
  const modelsId = useId();
  /** Where the steps are, so pressing Get brings them into view. */
  const steps = useRef<HTMLOListElement>(null);

  const put = (next: LocalStatus) => client.setQueryData(localKeys.status, next);
  const refreshElsewhere = () => {
    void client.invalidateQueries({ queryKey: providerKeys.list });
    void client.invalidateQueries({ queryKey: appKeys.capabilities });
  };

  const pull = async (name: string) => {
    const next = await localApi.pull(name);
    put(next);
  };

  /** Get a model: install Ollama first if it isn't here, and carry on without a second press. */
  const get = async (name: string) => {
    setError(undefined);
    setBusy(true);
    steps.current?.scrollIntoView({ block: 'nearest' });
    try {
      const ok = await guard(async () => {
        if (local?.ollama.state === 'missing') {
          const readiness = await needsApi.act('ollama', 'install');
          client.setQueryData(needKeys.one('ollama'), readiness);
          carryOn.current = name;
          setCarrying(true);
          return;
        }
        await pull(name);
      });
      if (!ok) {
        carryOn.current = undefined;
        setCarrying(false);
      }
    } catch (e) {
      carryOn.current = undefined;
      setCarrying(false);
      setError(errorText(e, 'Couldn’t start the download.'));
    } finally {
      setBusy(false);
    }
  };

  const act = (task: () => Promise<LocalStatus>, fallback: string) => async () => {
    setError(undefined);
    try {
      put(await task());
    } catch (e) {
      setError(errorText(e, fallback));
    }
  };

  // Ollama just arrived: look again now, and carry on to the model you asked for.
  const ollamaState = local?.ollama.state;
  const needState = ollamaNeed.need?.state;
  useEffect(() => {
    if (needState === 'ready' && ollamaState === 'missing')
      void client.invalidateQueries({ queryKey: localKeys.status });
    if (needState === 'failed') carryOn.current = undefined;
  }, [needState, ollamaState, client]);
  useEffect(() => {
    const name = carryOn.current;
    // The program appears on disk before the installer is done: wait for it to finish.
    if (!name || needState === 'installing') return;
    if (!ollamaState || ollamaState === 'missing' || ollamaState === 'elsewhere') return;
    carryOn.current = undefined;
    void get(name).finally(() => setCarrying(false));
    // Only the moment Ollama is here, and installed, matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaState, needState]);

  // A model landed: the provider card and the model picker see it now.
  const pullState = local?.pull?.state;
  const modelCount = local?.models.length ?? 0;
  useEffect(() => {
    if (pullState === 'done' || modelCount > 0) refreshElsewhere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullState, modelCount]);

  if (!local) {
    return (
      <Text tone="muted" aria-live="polite">
        Looking for Ollama on this computer…
      </Text>
    );
  }

  const offers = local.offers;
  // A handful to choose from, not the whole catalogue: the pick first, then the biggest that fit.
  const available = offers.filter((o) => o.fits && !o.installed).slice(0, 5);
  const recommended = offers.find((o) => o.recommended);
  const choice =
    offers.find((o) => o.name === picked) ??
    (recommended && !recommended.installed ? recommended : available[0]);
  const hasModel = local.models.length > 0;
  const active = local.pull && local.pull.state !== 'done' ? local.pull : undefined;
  const pullControls = {
    onPause: act(localApi.pause, 'Couldn’t pause the download.'),
    onResume: () => void (active && get(active.model)),
    onCancel: act(localApi.cancel, 'Couldn’t cancel the download.'),
    busy,
  };

  const need = ollamaNeed.need;
  // Installed, and Conch hasn't seen it start yet: still this step, not back to the button.
  const installing =
    ollamaNeed.running || (ollamaNeed.justDone && local.ollama.state === 'missing');
  // Someone uses it here, Conch tried to start it, and it didn't: that's the step to fix.
  const stuck = local.ollama.state === 'stopped' && provider.status.state === 'error';
  const ollamaHere =
    local.ollama.state !== 'missing' && local.ollama.state !== 'elsewhere' && !stuck;

  // ── Step 1: Ollama ────────────────────────────────────────────────────
  let ollamaStep: SetupStepState;
  let ollamaText: ReactNode;
  let ollamaAction: ReactNode;
  if (local.ollama.state === 'elsewhere') {
    ollamaStep = 'failed';
    ollamaText = local.ollama.message;
  } else if (local.ollama.state === 'starting') {
    ollamaStep = 'working';
  } else if (stuck) {
    ollamaStep = 'failed';
    ollamaText = 'It’s installed, but it didn’t start.';
    ollamaAction = (
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<Play />}
        onClick={() =>
          void act(localApi.start, 'Ollama didn’t start. Open it once, then try again.')().then(
            refreshElsewhere,
          )
        }
      >
        Start Ollama
      </Button>
    );
  } else if (ollamaHere) {
    ollamaStep = 'done';
  } else if (installing) {
    ollamaStep = 'working';
  } else if (ollamaNeed.error) {
    ollamaStep = 'failed';
    ollamaText = ollamaNeed.error;
    ollamaAction = need?.download && (
      <Button asChild size="sm" variant="ghost" trailingIcon={<ArrowUpRight />}>
        <a href={need.download} target="_blank" rel="noopener noreferrer">
          Get Ollama from its website
        </a>
      </Button>
    );
  } else {
    ollamaStep = 'current';
    ollamaText = need?.install
      ? 'It runs the model. Conch installs it for you.'
      : 'It runs the model. Get it from its website — Conch notices by itself once it’s there.';
    ollamaAction = !need?.install && need?.download && (
      <Button asChild size="sm" variant="surface" trailingIcon={<ArrowUpRight />}>
        <a href={need.download} target="_blank" rel="noopener noreferrer">
          Get Ollama
        </a>
      </Button>
    );
  }

  // ── Step 2: the model ─────────────────────────────────────────────────
  const chosenModel = local.models.find((m) => m.name === local.chosen) ?? local.models[0];
  const modelStep = (() => {
    if (hasModel && !active)
      return (
        <SetupChecklist.Step state="done" title={chosenModel?.label ?? 'A model'} note="Ready" />
      );
    if (active) return <PullStep pull={active} {...pullControls} />;
    if (!choice)
      return (
        <SetupChecklist.Step
          state={ollamaHere ? 'failed' : 'waiting'}
          title="Get a model"
          description={
            recommended?.reason ?? 'None of the models Conch suggests fits this computer.'
          }
        />
      );
    return (
      <SetupChecklist.Step
        state={ollamaHere ? (choice.fits ? 'current' : 'failed') : 'waiting'}
        title={`Get ${choice.label}`}
        description={
          choice.fits
            ? `${bytes(choice.sizeBytes)}, ${minutes(choice.minutes)} to download. ${choice.blurb}`
            : choice.reason
        }
      />
    );
  })();

  // Carrying on by itself after Ollama installs: the download follows, not the button again.
  const carryingOn = carrying && needState !== 'failed';
  const canGet =
    !hasModel && !active && choice?.fits && !installing && !carryingOn && ollamaStep !== 'failed';
  const byWinget = !ollamaHere && need?.install;

  return (
    <Stack gap={5}>
      {!hasModel ? (
        <SetupChecklist ref={steps} aria-label="What a model on this computer needs">
          <SetupChecklist.Step
            state={ollamaStep}
            title="Ollama"
            note={local.ollama.version ? `Version ${local.ollama.version}` : 'Installed'}
            description={ollamaText}
            progress={
              installing
                ? {
                    value: need?.progress?.percent,
                    label: need?.progress?.label ?? 'Installing Ollama…',
                  }
                : { label: 'Starting Ollama…' }
            }
            action={ollamaAction}
          />
          {modelStep}
          <SetupChecklist.Step
            state={hasModel ? 'done' : 'waiting'}
            title="Ready to chat"
            note="Private, free, and it works offline"
          />
        </SetupChecklist>
      ) : null}

      {canGet && choice && (
        <Stack gap={2}>
          <div>
            <Button
              size="lg"
              leadingIcon={<Download />}
              loading={busy}
              onClick={() => void get(choice.name)}
            >
              Get {choice.label}
            </Button>
          </div>
          <Text size="xs" tone="subtle">
            {byWinget
              ? `Installs Ollama first, then downloads ${choice.label} from Ollama’s library. After that, it never needs the internet.`
              : `Downloads ${choice.label} from Ollama’s library. After that, it never needs the internet.`}
          </Text>
          {byWinget && need?.install && (
            <Text size="xs" tone="subtle" title={need.install.command}>
              Runs <code>{need.install.command.split(' ').slice(0, 4).join(' ')} …</code>
            </Text>
          )}
        </Stack>
      )}

      {error && (
        <Callout tone="danger" live="polite">
          {error}
        </Callout>
      )}

      {/* Choosing is for before it starts: once it's on its way, the steps are what matter. */}
      {!hasModel && !active && !installing && available.length > 1 && (
        <Collapsible>
          <Collapsible.Trigger chevron>Other models</Collapsible.Trigger>
          <Collapsible.Content>
            <OfferChoice
              label="Models that fit this computer"
              offers={available}
              value={choice?.name ?? ''}
              onChange={setPicked}
            />
          </Collapsible.Content>
        </Collapsible>
      )}

      {hasModel && (
        <Stack gap={3}>
          <Text weight="medium" id={modelsId}>
            Models on this computer
          </Text>
          <RadioGroup
            variant="card"
            aria-labelledby={modelsId}
            value={chosenModel?.name ?? ''}
            onValueChange={(name) =>
              void act(() => localApi.choose(name), 'Couldn’t switch models.')().then(
                refreshElsewhere,
              )
            }
          >
            {local.models.map((model) => (
              <RadioGroup.Item
                key={model.name}
                value={model.name}
                label={model.label}
                description={modelFacts(model)}
              />
            ))}
          </RadioGroup>
          <Text size="xs" tone="subtle">
            Chats on this computer use the one you pick. Any chat can switch in its model picker.
          </Text>
          {active ? (
            <SetupChecklist aria-label="Getting another model">
              <PullStep pull={active} {...pullControls} />
            </SetupChecklist>
          ) : (
            available.length > 0 && (
              <Collapsible>
                <Collapsible.Trigger chevron>Get another model</Collapsible.Trigger>
                <Collapsible.Content>
                  <Stack gap={3}>
                    <OfferChoice
                      label="Models that fit this computer"
                      offers={available}
                      value={choice?.name ?? ''}
                      onChange={setPicked}
                    />
                    {choice && (
                      <div>
                        <Button
                          variant="surface"
                          leadingIcon={<Download />}
                          loading={busy}
                          onClick={() => void get(choice.name)}
                        >
                          Get {choice.label}
                        </Button>
                      </div>
                    )}
                  </Stack>
                </Collapsible.Content>
              </Collapsible>
            )
          )}
        </Stack>
      )}
      {dialog}
    </Stack>
  );
}
