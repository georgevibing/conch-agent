import {
  CALL_AFTER,
  CALL_MINUTES,
  CALL_PASSCODE,
  callPasscodeProblem,
  CALLS_DEFAULT,
  CALLS_PER_DAY,
  callUsageWords,
  type Channel,
  type ChannelCalls,
  PHONE_CALL_CHANNELS,
} from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Field,
  Heading,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { useState, type FormEvent } from 'react';

import { relativeTime } from '../../lib/time';
import { errorText } from './queries';

import { QuietHoursButton } from '../checkins/CheckInSection';
import styles from './Channels.module.css';

/** The section's id, for ⌘K (“Phone calls”). */
export const PHONE_CALLS_ID = 'ch-calls';

const minutes = (n: number) => (n === 1 ? 'A minute' : `${n} minutes`);
const calls = (n: number) => (n === 1 ? 'One call' : `${n} calls`);

/** Today, as the gateway counts calls (`2026-10-19`). */
const today = () => new Intl.DateTimeFormat('en-CA').format(Date.now());

function Choice({
  id,
  label,
  hint,
  value,
  options,
  words,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  options: readonly number[];
  words: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <div className={styles.setting}>
      <Stack gap={0}>
        <Text weight="medium" id={id}>
          {label}
        </Text>
        <Text size="sm" tone="muted">
          {hint}
        </Text>
      </Stack>
      <Select
        aria-labelledby={id}
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
      >
        {[...new Set([...options, value])]
          .sort((a, b) => a - b)
          .map((n) => (
            <Select.Item key={n} value={String(n)}>
              {words(n)}
            </Select.Item>
          ))}
      </Select>
    </div>
  );
}

/** What the page says when calls are answered without a passcode (also Repair everything's words). */
export const NO_PASSCODE_WORDS =
  'Without full caller verification from your carrier, Conch asks for your call passcode. Set one so calls always work.';

/**
 * The call passcode (ADR 0138): keyed on a call the carrier can't fully
 * vouch for. Typed once here, sent once, and never shown again: the gateway
 * keeps only its hash and says only that there is one.
 */
function CallPasscode({
  channel,
  onPasscode,
}: {
  channel: Channel;
  onPasscode: (passcode: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'set' | 'remove'>();
  const set = channel.callPasscode;
  const usage = channel.calls;
  const locked = usage?.day === today() && (usage.passcodeFails ?? 0) >= CALL_PASSCODE.lockAfter;
  const problem = value ? callPasscodeProblem(value) : undefined;
  const close = () => {
    setOpen(false);
    setValue('');
    setError(undefined);
  };
  const save = async (passcode: string | null) => {
    setBusy(passcode === null ? 'remove' : 'set');
    setError(undefined);
    try {
      // False: confirming it's you was cancelled, and the dialog stays.
      if (await onPasscode(passcode)) close();
    } catch (e) {
      setError(errorText(e, 'Couldn’t change the passcode.'));
    } finally {
      setBusy(undefined);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem) return setError(problem);
    void save(value);
  };
  return (
    <>
      <div className={styles.setting}>
        <Stack gap={0}>
          <Text weight="medium" id="ch-calls-passcode">
            Call passcode
          </Text>
          <Text size="sm" tone="muted">
            {set
              ? `Asked on the keypad when your carrier can’t fully verify it’s your number. Set ${relativeTime(set.setAt)}.`
              : NO_PASSCODE_WORDS}
          </Text>
        </Stack>
        <Button
          size="sm"
          variant={set ? 'surface' : 'solid'}
          aria-describedby="ch-calls-passcode"
          onClick={() => setOpen(true)}
        >
          {set ? 'Change' : 'Set passcode'}
        </Button>
      </div>
      {locked && (
        <Callout tone="warning" title="Calls are turned away until tomorrow">
          Someone entered a wrong passcode {CALL_PASSCODE.lockAfter} times today. If it wasn’t you,
          someone may be faking your number: set a new passcode, and calls are answered again.
        </Callout>
      )}
      <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <Dialog.Content size="sm">
          <form onSubmit={submit}>
            <Dialog.Header>
              <Dialog.Title>
                {set ? 'Change your call passcode' : 'Set a call passcode'}
              </Dialog.Title>
              <Dialog.Description>
                When your carrier can’t fully verify a call is from your number, you’ll be asked for
                it on the keypad, then the pound key. {CALL_PASSCODE.tries} wrong tries end the
                call.
              </Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={3}>
                <Field invalid={Boolean(error)}>
                  <Field.Label>Passcode</Field.Label>
                  <PasswordInput
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={CALL_PASSCODE.max}
                    showLabel="Show passcode"
                    hideLabel="Hide passcode"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value.replace(/\s/g, ''));
                      setError(undefined);
                    }}
                    required
                  />
                  <Field.Description>
                    {CALL_PASSCODE.min} to {CALL_PASSCODE.max} digits, not part of a phone number.
                    Conch keeps only a scrambled copy, so it can’t show it to you again.
                  </Field.Description>
                </Field>
                {error && (
                  <Callout tone="danger" live="assertive">
                    {error}
                  </Callout>
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              {set && (
                <Button
                  variant="ghost"
                  tone="danger"
                  type="button"
                  loading={busy === 'remove'}
                  disabled={Boolean(busy)}
                  onClick={() => void save(null)}
                >
                  Remove
                </Button>
              )}
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" loading={busy === 'set'} disabled={!value || Boolean(busy)}>
                {set ? 'Change' : 'Set passcode'}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

/**
 * Phone calls on an SMS number (ADR 0138): calling your assistant, and being
 * rung when an OK has waited. Both off until you turn them on; turning one on
 * from another device asks you to confirm it's you first (`onChange` is guarded).
 */
export function PhoneCallsSection({
  channel,
  assistant,
  onChange,
  onPasscode,
}: {
  channel: Channel;
  assistant: string;
  onChange: (calls: ChannelCalls) => void;
  /** Set (or with null, remove) the call passcode; guarded like `onChange` (false: cancelled). */
  onPasscode: (passcode: string | null) => Promise<boolean>;
}) {
  if (!PHONE_CALL_CHANNELS.includes(channel.kind)) return null;
  const now = channel.settings.calls ?? CALLS_DEFAULT;
  const set = (patch: Partial<ChannelCalls>) => onChange({ ...now, ...patch });
  const number = channel.bot.name;
  return (
    <section aria-labelledby={PHONE_CALLS_ID} className={styles.section}>
      <Heading level={2} id={PHONE_CALLS_ID} size="sm" tone="muted">
        Phone calls
      </Heading>
      <Stack gap={3}>
        <div className={styles.setting}>
          <Stack gap={0}>
            <Text weight="medium" id="ch-calls-answer">
              Answer your calls
            </Text>
            <Text size="sm" tone="muted">
              Call {number} and talk to {assistant}, hands-free. Only your own number gets through,
              and only once it’s surely you.
            </Text>
          </Stack>
          <Switch
            aria-labelledby="ch-calls-answer"
            checked={now.answer}
            onCheckedChange={(answer) => set({ answer })}
          />
        </div>
        {now.answer && <CallPasscode channel={channel} onPasscode={onPasscode} />}
        <div className={styles.setting}>
          <Stack gap={0}>
            <Text weight="medium" id="ch-calls-approvals">
              Call me when an OK waits
            </Text>
            <Text size="sm" tone="muted">
              {assistant} rings you if you haven’t answered. Press 1 to allow an everyday step;
              anything bigger waits for you in Conch.
            </Text>
          </Stack>
          <Switch
            aria-labelledby="ch-calls-approvals"
            checked={now.approvals}
            onCheckedChange={(approvals) => set({ approvals })}
          />
        </div>
        {now.approvals && (
          <>
            <Choice
              id="ch-calls-after"
              label="Ring after"
              hint="How long an OK waits before the call."
              value={now.after}
              options={CALL_AFTER}
              words={minutes}
              onChange={(after) => set({ after })}
            />
            <Choice
              id="ch-calls-per-day"
              label="Calls a day"
              hint="The most it rings you in one day."
              value={now.perDay}
              options={CALLS_PER_DAY}
              words={calls}
              onChange={(perDay) => set({ perDay })}
            />
            <div className={styles.setting}>
              <Stack gap={0}>
                <Text weight="medium">Quiet hours</Text>
                <Text size="sm" tone="muted">
                  It never rings you then. Your own calls are still answered.
                </Text>
              </Stack>
              <QuietHoursButton
                quiet={now.quiet}
                note="No calls from Conch between these times."
                onSave={(quiet) => set({ quiet })}
              />
            </div>
          </>
        )}
        {(now.answer || now.approvals) && (
          <Choice
            id="ch-calls-length"
            label="Longest call"
            hint="A call ends by itself after this."
            value={now.maxMinutes}
            options={CALL_MINUTES}
            words={minutes}
            onChange={(maxMinutes) => set({ maxMinutes })}
          />
        )}
        <Text size="sm" tone="muted">
          {callUsageWords(channel.calls, today())} Twilio charges for every minute, a cent or two a
          minute in the US.
        </Text>
      </Stack>
    </section>
  );
}
