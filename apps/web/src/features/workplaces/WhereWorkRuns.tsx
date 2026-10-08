import type { WorkPlaceId, WorkPlaceState, WorkPlacesStatus } from '@conch/protocol';
import {
  Badge,
  Button,
  Field,
  PasswordInput,
  PlaceGlyph,
  RadioGroup,
  Skeleton,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useAppState, useModels, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { GetIt } from '../setup/GetIt';
import { useWorkPlaces, workPlacesApi, workPlacesKeys } from './api';
import { WORKPLACES_FOCUS } from './words';

const STATE: Record<
  Exclude<WorkPlaceState, 'ready'>,
  { tone: 'success' | 'warning' | 'neutral'; label: string }
> = {
  preparing: { tone: 'neutral', label: 'Getting ready' },
  'needs-setup': { tone: 'neutral', label: 'Needs setting up' },
  unavailable: { tone: 'warning', label: 'Not answering' },
};

/**
 * Settings → Security → Where work runs (ADR 0106): where new chats' commands
 * run, and the one thing a place needs (Docker or Podman, the cloud's key).
 * Each chat can choose its own from the chip under the message box.
 */
export function WhereWorkRuns() {
  const { data: app } = useAppState();
  const update = useUpdateSettings();
  const { data: status } = useWorkPlaces({ look: true });
  const { data: models } = useModels();
  const ref = useRef<HTMLElement>(null);
  const focus = useUi((s) => s.settingsFocus);

  useEffect(() => {
    if (focus !== WORKPLACES_FOCUS || !status) return;
    useUi.setState({ settingsFocus: undefined });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    ref.current?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]')?.focus({
      preventScroll: true,
    });
  }, [focus, status]);

  const chosen = app?.preferences.place ?? 'computer';
  // Said plainly: the providers whose own commands stay here whatever is chosen.
  const own = (models?.providers ?? []).filter((p) => !p.places).map((p) => p.label);

  return (
    <Section
      ref={ref}
      title="Where work runs"
      description="Where the assistant’s commands run in new chats. Each chat can choose its own from the chip under the message box."
    >
      {!status ? (
        <Skeleton shape="block" height={120} />
      ) : (
        <Stack gap={4}>
          <RadioGroup
            variant="card"
            aria-label="Where work runs"
            value={chosen}
            onValueChange={(place) =>
              update.mutate(
                { preferences: { place: place as WorkPlaceId } },
                { onError: (e) => toast.error(e.message || 'That didn’t save. Try again.') },
              )
            }
          >
            {status.places.map((place) => (
              <RadioGroup.Item
                key={place.id}
                value={place.id}
                icon={<PlaceGlyph kind={place.kind} />}
                description={
                  place.state === 'ready' ? place.description : (place.message ?? place.description)
                }
                label={
                  <span>
                    {place.name}{' '}
                    {place.state !== 'ready' && (
                      <Badge size="sm" tone={STATE[place.state].tone} variant="soft">
                        {STATE[place.state].label}
                      </Badge>
                    )}
                  </span>
                }
              />
            ))}
          </RadioGroup>
          {status.places.find((p) => p.id === 'container' && p.need) && (
            <GetIt
              needId="container"
              lead="A container keeps the assistant’s commands in a fresh box that sees only the work folder. Podman installs without an administrator; Docker works too."
            />
          )}
          <CloudKey status={status} />
          {own.length > 0 && (
            <Text size="sm" tone="muted">
              {own.join(', ')} {own.length === 1 ? 'runs its' : 'run their'} own commands on this
              computer, in {own.length === 1 ? 'its' : 'their'} own sandbox, wherever you choose.
              Every other provider’s commands run where you choose.
            </Text>
          )}
        </Stack>
      )}
    </Section>
  );
}

/** The cloud's key: typed once, checked with Daytona, never shown again. */
function CloudKey({ status }: { status: WorkPlacesStatus }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cloud = status.places.find((p) => p.id === 'cloud');
  if (!cloud) return null;
  const saved = !cloud.needsKey;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const done = await guard(async () => {
        client.setQueryData(
          [...workPlacesKeys.status, true],
          await workPlacesApi.setCloudKey(key.trim()),
        );
      });
      if (done) {
        setKey('');
        await client.invalidateQueries({ queryKey: workPlacesKeys.status });
        toast.success('The cloud is ready. Choose it for a chat under the message box.');
      }
    } catch (failure) {
      setError(
        failure instanceof ApiError || failure instanceof Error
          ? failure.message
          : 'That didn’t work.',
      );
    } finally {
      setBusy(false);
    }
  };

  return saved ? (
    <Stack direction="row" gap={2} align="center">
      <Text size="sm" tone="muted">
        Your Daytona key is saved.
      </Text>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void workPlacesApi
            .forgetCloudKey()
            .then(() => client.invalidateQueries({ queryKey: workPlacesKeys.status }))
        }
      >
        Forget the key
      </Button>
      {dialog}
    </Stack>
  ) : (
    <Stack gap={2}>
      <Field>
        <Field.Label>Daytona key, for the cloud</Field.Label>
        <PasswordInput
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your key"
          autoComplete="off"
        />
        <Field.Description>
          Make one at{' '}
          <a href="https://app.daytona.io/dashboard/keys" target="_blank" rel="noreferrer">
            Daytona
          </a>
          ; it’s free to start. Kept sealed on this computer and never shown again. A sandbox sleeps
          after 15 idle minutes, so it costs nothing while you’re away.
        </Field.Description>
        {error && <Field.Error>{error}</Field.Error>}
      </Field>
      <div>
        <Button
          size="sm"
          loading={busy}
          disabled={key.trim().length < 16}
          onClick={() => void save()}
        >
          Use Daytona
        </Button>
      </div>
      {dialog}
    </Stack>
  );
}
