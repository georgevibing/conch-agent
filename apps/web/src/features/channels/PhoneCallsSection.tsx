import {
  CALL_AFTER,
  CALL_MINUTES,
  CALLS_DEFAULT,
  CALLS_PER_DAY,
  callUsageWords,
  type Channel,
  type ChannelCalls,
  PHONE_CALL_CHANNELS,
} from '@conch/protocol';
import { Heading, Select, Stack, Switch, Text } from '@conch/nacre';

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

/**
 * Phone calls on an SMS number (ADR 0138): calling your assistant, and being
 * rung when an OK has waited. Both off until you turn them on; turning one on
 * from another device asks you to confirm it's you first (`onChange` is guarded).
 */
export function PhoneCallsSection({
  channel,
  assistant,
  onChange,
}: {
  channel: Channel;
  assistant: string;
  onChange: (calls: ChannelCalls) => void;
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
              Call {number} and talk to {assistant}, hands-free. Only your own number gets through.
            </Text>
          </Stack>
          <Switch
            aria-labelledby="ch-calls-answer"
            checked={now.answer}
            onCheckedChange={(answer) => set({ answer })}
          />
        </div>
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
