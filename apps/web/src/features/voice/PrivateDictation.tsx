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
 * Private dictation, set up as one flow (ADR 0027): whisper.cpp, then its
 * speech model, each with progress. One press gets both: Conch installs
 * whisper.cpp and carries straight on to the model.
 */
export function PrivateDictation({
  compact = false,
  onReady,
}: {
  compact?: boolean;
  onReady?: () => void;
}) {
  const client = useQueryClient();
  const { data: status } = useVoiceStatus();
  const whisper = useNeed('whisper');
  const carryOn = useRef(false);
  const put = (next: VoiceStatus) => client.setQueryData(voiceKeys.status, next);
  const state = status?.private.state;

  // whisper.cpp just arrived after "Get it": the model comes next, without a second press.
  useEffect(() => {
    if (whisper.need?.state === 'ready')
      void client.invalidateQueries({ queryKey: voiceKeys.status });
  }, [whisper.need?.state, client]);
  useEffect(() => {
    if (state === 'model-missing' && carryOn.current) {
      carryOn.current = false;
      void voiceApi.getModel().then(put);
    }
    if (state === 'ready') onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `put` and `onReady` follow `state`
  }, [state]);

  if (!status) return null;
  const p = status.private;
  if (p.state === 'ready')
    return compact ? null : (
      <Callout tone="success">Ready. Your voice is turned into text on this computer.</Callout>
    );

  return (
    <>
      <SetupChecklist aria-label="What private dictation needs">
        <SetupChecklist.Step
          state={p.state === 'missing' ? (whisper.running ? 'working' : 'current') : 'done'}
          title="whisper.cpp"
          note={p.state === 'missing' ? undefined : 'Installed'}
          description={
            p.state !== 'missing' ? undefined : whisper.need?.install ? (
              'The program that turns speech into text, from your package manager.'
            ) : (
              <GetIt needId="whisper" />
            )
          }
          action={
            p.state === 'missing' && whisper.need?.install ? (
              <Button
                size="sm"
                leadingIcon={<Download />}
                loading={whisper.starting || whisper.running}
                onClick={() => {
                  carryOn.current = true;
                  void whisper.act('install');
                }}
              >
                Get it
              </Button>
            ) : undefined
          }
        />
        <SetupChecklist.Step
          state={
            p.state === 'downloading'
              ? 'working'
              : p.state === 'model-missing'
                ? p.problem
                  ? 'failed'
                  : 'current'
                : 'waiting'
          }
          title="Its speech model"
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
      {whisper.dialog}
    </>
  );
}
