import type { VoiceStatus } from '@conch/protocol';
import { Button, Callout, SetupChecklist } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Pause } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useNeed } from '../setup/useNeed';
import { voiceApi, voiceKeys } from './api';
import { GetIt } from '../setup/GetIt';
import { useVoiceStatus } from './useEngine';

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * Hearing you on the computer Conch runs on, set up as one flow (ADR 0027):
 * whisper.cpp, then its speech model, each with progress. One press gets
 * both: Conch installs whisper.cpp and carries straight on to the model.
 *
 * `notes` is the same flow for voice notes from chat apps (ADR 0077): they
 * come as Opus or AAC, so FFmpeg is a step too, fetched alongside the model.
 */
export function PrivateDictation({
  compact = false,
  notes = false,
  onReady,
}: {
  compact?: boolean;
  notes?: boolean;
  onReady?: () => void;
}) {
  const client = useQueryClient();
  const { data: status } = useVoiceStatus();
  const whisper = useNeed('whisper');
  const ffmpeg = useNeed(notes ? 'ffmpeg' : undefined);
  const carryOn = useRef(false);
  const put = (next: VoiceStatus) => client.setQueryData(voiceKeys.status, next);
  const state = status?.private.state;
  const ffmpegReady = !notes || ffmpeg.need?.state === 'ready';

  // whisper.cpp just arrived after "Get it": the model comes next, without a second press.
  useEffect(() => {
    if (whisper.need?.state === 'ready')
      void client.invalidateQueries({ queryKey: voiceKeys.status });
  }, [whisper.need?.state, client]);
  useEffect(() => {
    if (state === 'model-missing' && carryOn.current) void voiceApi.getModel().then(put);
    // FFmpeg comes alongside, from the same press.
    if (
      carryOn.current &&
      notes &&
      state !== undefined &&
      state !== 'missing' &&
      ffmpeg.need?.state === 'missing' &&
      ffmpeg.need.install &&
      !ffmpeg.starting
    )
      void ffmpeg.act('install');
    if (state === 'ready' && ffmpegReady) {
      carryOn.current = false;
      onReady?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `put`, `ffmpeg` and `onReady` follow these
  }, [state, ffmpeg.need?.state, ffmpegReady]);

  if (!status) return null;
  const p = status.private;
  if (p.state === 'ready' && ffmpegReady)
    return compact ? null : (
      <Callout tone="success">
        {notes
          ? 'Ready. Voice notes are turned into words on this computer.'
          : 'Ready. Your voice is turned into text on this computer.'}
      </Callout>
    );

  const getEverything = () => {
    carryOn.current = true;
    if (p.state === 'missing') void whisper.act('install');
    else if (notes && ffmpeg.need?.state === 'missing') void ffmpeg.act('install');
    if (p.state === 'model-missing') void voiceApi.getModel().then(put);
  };

  return (
    <>
      <SetupChecklist aria-label={notes ? 'What voice notes need' : 'What private dictation needs'}>
        <SetupChecklist.Step
          state={p.state === 'missing' ? (whisper.running ? 'working' : 'current') : 'done'}
          title="whisper.cpp"
          note={p.state === 'missing' ? undefined : 'Installed'}
          description={
            p.state !== 'missing' ? undefined : whisper.need?.install ? (
              'The program that turns speech into text, on this computer.'
            ) : (
              <GetIt needId="whisper" />
            )
          }
          progress={
            whisper.running && whisper.need?.progress?.percent !== undefined
              ? { value: whisper.need.progress.percent, label: whisper.need.progress.label }
              : undefined
          }
          action={
            p.state === 'missing' && whisper.need?.install ? (
              <Button
                size="sm"
                leadingIcon={<Download />}
                loading={whisper.starting || whisper.running}
                onClick={getEverything}
              >
                Get it
              </Button>
            ) : undefined
          }
        />
        {notes && (
          <SetupChecklist.Step
            state={
              ffmpeg.need?.state === 'ready'
                ? 'done'
                : ffmpeg.running
                  ? 'working'
                  : ffmpeg.need?.state === 'failed'
                    ? 'failed'
                    : p.state === 'missing'
                      ? 'waiting'
                      : 'current'
            }
            title="FFmpeg"
            note={ffmpeg.need?.state === 'ready' ? 'Installed' : undefined}
            description={
              ffmpeg.need?.state === 'ready' ? undefined : ffmpeg.need?.install ? (
                'Reads the recordings chat apps send, so whisper.cpp can hear them.'
              ) : (
                <GetIt needId="ffmpeg" />
              )
            }
            action={
              p.state !== 'missing' && ffmpeg.need?.state !== 'ready' && ffmpeg.need?.install ? (
                <Button
                  size="sm"
                  leadingIcon={<Download />}
                  loading={ffmpeg.starting || ffmpeg.running}
                  onClick={() => void ffmpeg.act('install')}
                >
                  Get it
                </Button>
              ) : undefined
            }
          />
        )}
        <SetupChecklist.Step
          state={
            p.state === 'downloading'
              ? 'working'
              : p.state === 'model-missing'
                ? p.problem
                  ? 'failed'
                  : 'current'
                : p.state === 'ready'
                  ? 'done'
                  : 'waiting'
          }
          title="Its speech model"
          note={p.state === 'ready' ? 'Downloaded' : undefined}
          description={
            p.state === 'model-missing'
              ? (p.problem ?? `About ${mb(p.bytes)}, once. It works offline from then on.`)
              : undefined
          }
          progress={
            p.state === 'downloading'
              ? {
                  value: Math.round((p.done / Math.max(1, p.total)) * 100),
                  label: `${mb(p.done)} of ${mb(p.total)}`,
                }
              : undefined
          }
          action={
            p.state === 'model-missing' ? (
              <Button
                size="sm"
                leadingIcon={<Download />}
                onClick={() => void voiceApi.getModel().then(put)}
              >
                {p.problem ? 'Carry on' : 'Get it'}
              </Button>
            ) : p.state === 'downloading' ? (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Pause />}
                onClick={() => void voiceApi.pause().then(put)}
              >
                Pause
              </Button>
            ) : undefined
          }
        />
      </SetupChecklist>
      {whisper.error && <Callout tone="danger">{whisper.error}</Callout>}
      {notes && ffmpeg.error && <Callout tone="danger">{ffmpeg.error}</Callout>}
      {whisper.dialog}
      {notes && ffmpeg.dialog}
    </>
  );
}
