import {
  type Channel,
  type ChannelSettings,
  VOICE_NOTE_CHANNELS,
  VOICE_REPLY_CHANNELS,
} from '@conch/protocol';
import { Button, Callout, Heading, Select, Stack, Text } from '@conch/nacre';
import { Mic } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { settingsPath } from '../settings/paths';
import { useNeed } from '../setup/useNeed';
import { PrivateDictation } from '../voice/PrivateDictation';
import { useVoiceStatus } from '../voice/useEngine';
import { useSpeech } from '../voice/VoiceTab';
import styles from './Channels.module.css';

const notes = (n: number) => (n === 1 ? 'One voice note is' : `${n} voice notes are`);

type Replies = NonNullable<ChannelSettings['voiceReplies']>;

const REPLIES: [Replies, string][] = [
  ['match', 'When you send one'],
  ['always', 'Always'],
  ['never', 'Never'],
];

/**
 * A channel's voice notes (ADR 0077): heard on this computer, so they never
 * leave it. Until Conch can hear them, the ones that arrive wait here, and
 * one press gets what's missing; they go to the assistant by themselves after.
 * And whether the assistant answers with a voice note of its own.
 */
export function VoiceNotesSection({
  channel,
  assistant,
  onReplies,
}: {
  channel: Channel;
  assistant: string;
  onReplies: (mode: Replies) => void;
}) {
  const { data: status } = useVoiceStatus();
  const ffmpeg = useNeed('ffmpeg');
  const speech = useSpeech();
  const [open, setOpen] = useState(false);
  if (!VOICE_NOTE_CHANNELS.includes(channel.kind) || !status) return null;
  const ready = status.private.state === 'ready' && ffmpeg.need?.state === 'ready';
  const waiting = channel.voiceNotes?.waiting ?? 0;
  const replies = channel.settings.voiceReplies ?? 'match';
  return (
    <section aria-labelledby="ch-voice" className={styles.section}>
      <Heading level={2} id="ch-voice" size="sm" tone="muted">
        Voice notes
      </Heading>
      <Stack gap={3}>
        {waiting > 0 && (
          <Callout tone="info" live="polite">
            {notes(waiting)} waiting. {assistant} hears them on this computer once it’s set up, then
            answers them by itself.
          </Callout>
        )}
        {ready ? (
          <Text size="sm" tone="muted">
            {assistant} turns voice notes into words on this computer, so they never leave it. You
            see the words with each one in its chat.
          </Text>
        ) : waiting > 0 || open ? (
          <PrivateDictation notes />
        ) : (
          <div className={styles.setting}>
            <Stack gap={0}>
              <Text weight="medium">Listen to voice notes</Text>
              <Text size="sm" tone="muted">
                {assistant} turns them into words on this computer, so they never leave it.
              </Text>
            </Stack>
            <Button size="sm" variant="surface" leadingIcon={<Mic />} onClick={() => setOpen(true)}>
              Turn on
            </Button>
          </div>
        )}
        {VOICE_REPLY_CHANNELS.includes(channel.kind) && (
          <div className={styles.setting}>
            <Stack gap={0}>
              <Text weight="medium" id="ch-voice-replies">
                Answer with a voice note
              </Text>
              <Text size="sm" tone="muted">
                {speech.data && !speech.data.reply ? (
                  <>
                    It needs a natural voice first: get one in{' '}
                    <Link to={settingsPath('voice')}>Settings → Voice</Link>. Until then,{' '}
                    {assistant} answers in writing.
                  </>
                ) : (
                  <>The answer is written too, either way.</>
                )}
              </Text>
            </Stack>
            <Select
              aria-labelledby="ch-voice-replies"
              value={replies}
              onValueChange={(value) => onReplies(value as Replies)}
            >
              {REPLIES.map(([value, label]) => (
                <Select.Item key={value} value={value}>
                  {label}
                </Select.Item>
              ))}
            </Select>
          </div>
        )}
      </Stack>
    </section>
  );
}
