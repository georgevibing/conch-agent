import type { TurnLimits } from '@conch/protocol';
import { Field, Input, Stack, Switch } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { Section, SaveStatus } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';

/** `openSettings('usage', TURN_LIMITS_FOCUS)` brings this section into view. */
export const TURN_LIMITS_FOCUS = 'turn-limits';

/** What the switch starts at when someone turns it on (the protocol's defaults). */
const START: TurnLimits = { on: false, steps: 100, tokens: 2_000_000, minutes: 30 };

/** `undefined` = not a valid whole number in range (yet). */
function whole(text: string, min: number, max: number): number | undefined {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Millions of tokens, like `2` or `0.5`. */
function millions(text: string): number | undefined {
  const n = Number(text.trim());
  const tokens = Math.round(n * 1_000_000);
  return text.trim() !== '' && Number.isFinite(n) && tokens >= 50_000 && tokens <= 1e9
    ? tokens
    : undefined;
}

function Body({ initial }: { initial: TurnLimits }) {
  const update = useUpdateSettings();
  const [on, setOn] = useState(initial.on);
  const [steps, setSteps] = useState(String(initial.steps));
  const [tokens, setTokens] = useState(String(initial.tokens / 1_000_000));
  const [minutes, setMinutes] = useState(String(initial.minutes));
  // The last valid values; mid-edit typos never save.
  const [saved, setSaved] = useState(initial);
  const stepsOk = whole(steps, 5, 10_000);
  const tokensOk = millions(tokens);
  const minutesOk = whole(minutes, 1, 1_440);
  const limits: TurnLimits = { ...saved, on };
  const status = useAutosave(limits, (next) =>
    update.mutateAsync({ preferences: { turnLimits: next } }),
  );
  const edit = (
    text: string,
    set: (text: string) => void,
    next: Partial<TurnLimits> | undefined,
  ) => {
    set(text);
    if (next) setSaved((was) => ({ ...was, ...next }));
  };
  return (
    <Stack gap={4}>
      <Switch
        checked={on}
        onCheckedChange={setOn}
        label="Pause long turns to check in"
        description={
          on
            ? 'A chat you’re watching pauses at the first of these it reaches, with a Carry on button.'
            : 'Off. A turn runs until it’s done. A loop (the same thing again and again) still pauses it.'
        }
      />
      {on && (
        <Stack gap={4}>
          <Field invalid={stepsOk === undefined}>
            <Field.Label>Steps</Field.Label>
            <Input
              inputMode="numeric"
              value={steps}
              onChange={(e) => {
                const n = whole(e.target.value, 5, 10_000);
                edit(e.target.value, setSteps, n === undefined ? undefined : { steps: n });
              }}
            />
            {stepsOk === undefined ? (
              <Field.Error>Enter a whole number from 5 to 10,000.</Field.Error>
            ) : (
              <Field.Description>
                Rounds of tool calls in one message. Conch starts at {START.steps}.
              </Field.Description>
            )}
          </Field>
          <Field invalid={tokensOk === undefined}>
            <Field.Label>Tokens used, in millions</Field.Label>
            <Input
              inputMode="decimal"
              value={tokens}
              onChange={(e) => {
                const n = millions(e.target.value);
                edit(e.target.value, setTokens, n === undefined ? undefined : { tokens: n });
              }}
            />
            {tokensOk === undefined ? (
              <Field.Error>Enter an amount from 0.05 to 1,000, like 2.</Field.Error>
            ) : (
              <Field.Description>
                What one message reads and writes that the provider didn’t already have cached.
                Models on this computer don’t count. Conch starts at {START.tokens / 1_000_000}.
              </Field.Description>
            )}
          </Field>
          <Field invalid={minutesOk === undefined}>
            <Field.Label>Minutes</Field.Label>
            <Input
              inputMode="numeric"
              value={minutes}
              onChange={(e) => {
                const n = whole(e.target.value, 1, 1_440);
                edit(e.target.value, setMinutes, n === undefined ? undefined : { minutes: n });
              }}
            />
            {minutesOk === undefined ? (
              <Field.Error>Enter a whole number from 1 to 1,440.</Field.Error>
            ) : (
              <Field.Description>
                How long one message may work. Conch starts at {START.minutes}.
              </Field.Description>
            )}
          </Field>
        </Stack>
      )}
      <SaveStatus status={status} />
    </Stack>
  );
}

/**
 * Settings → Usage → Limits → Long turns: for people who want a message to check in
 * before it runs on. Off unless chosen (ADR 0085); routines and tasks keep
 * their own limits.
 */
export function TurnLimitsSection() {
  const app = useAppState();
  const initial = app.data?.preferences.turnLimits;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!initial) return;
    const { settingsFocus } = useUi.getState();
    if (settingsFocus !== TURN_LIMITS_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [initial]);

  if (!initial) return null;
  return (
    <Section
      ref={ref}
      title="Long turns"
      description="A message runs until it’s done. Turn this on to have it check in first."
    >
      <Body initial={initial} />
    </Section>
  );
}
