import type { EngineId } from '@conch/protocol';
import { Field, Select, Stack, Switch } from '@conch/nacre';
import { useEffect, useRef } from 'react';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';
import { Section } from './Section';

/** `openSettings('models', FALLBACK_FOCUS)` brings this section into view. */
export const FALLBACK_FOCUS = 'fallback';

const WAIT = 'wait';

/**
 * When the chat's provider can't answer (ADR 0018): at a usage limit, another
 * one you picked carries on; offline, the model on this computer answers, or
 * messages wait and go by themselves when the internet's back.
 */
export function FallbackSection() {
  const { data: app } = useAppState();
  const { data: list } = useProviders();
  const update = useUpdateSettings();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const { settingsFocus } = useUi.getState();
    if (settingsFocus !== FALLBACK_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const prefs = app?.preferences;
  const providers = list?.providers ?? [];
  const active = providers.find((p) => p.active);
  const others = providers.filter((p) => p.ready && !p.active && !p.local);
  const local = providers.find((p) => p.local && p.ready);
  const pick = prefs?.limitFallback;
  const picked = providers.find((p) => p.id === pick);
  const name = active?.name ?? 'your provider';

  return (
    <Section
      ref={ref}
      title="When a provider can’t answer"
      description="So a limit or a dropped connection never leaves a question hanging."
    >
      <Stack gap={6}>
        <Field>
          <Field.Label id="limit-fallback">At a usage limit</Field.Label>
          <Select
            aria-labelledby="limit-fallback"
            value={picked && picked.id !== active?.id ? picked.id : WAIT}
            onValueChange={(value) =>
              update.mutate({
                preferences: { limitFallback: value === WAIT ? null : (value as EngineId) },
              })
            }
          >
            <Select.Item value={WAIT}>Wait until it resets</Select.Item>
            {others.map((p) => (
              <Select.Item key={p.id} value={p.id}>
                Continue with {p.name}
              </Select.Item>
            ))}
            {/* Chosen before, not ready now: still shown, so the choice isn't silently lost. */}
            {picked && !picked.ready && !picked.active && (
              <Select.Item value={picked.id}>Continue with {picked.name}</Select.Item>
            )}
          </Select>
          <Field.Description>
            {picked && picked.id !== active?.id
              ? `When ${name} reaches a limit, ${picked.name} answers the same message — nothing to retype. Back to ${name} once it resets.`
              : others.length
                ? `Or let another connected provider answer while ${name} is at its limit.`
                : 'Connect another provider to carry on when this one reaches a limit.'}
          </Field.Description>
        </Field>

        <Switch
          checked={prefs?.offlineFallback ?? true}
          onCheckedChange={(offlineFallback) => update.mutate({ preferences: { offlineFallback } })}
          label="Answer offline with the model on this computer"
          description={
            local
              ? `With no internet, ${local.name} answers right here. Otherwise, messages wait and go by themselves when you’re back.`
              : 'No model on this computer yet, so messages wait and go by themselves when you’re back.'
          }
        />
      </Stack>
    </Section>
  );
}
