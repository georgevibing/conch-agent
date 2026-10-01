import { Button, Dialog, Stack, Text } from '@conch/nacre';
import { LockKeyhole, Mic } from 'lucide-react';

import { PrivateDictation } from './PrivateDictation';
import { setVoicePrefs } from './prefs';
import type { EngineChoice } from './useEngine';

/**
 * Asked once, in the flow, when the only way left to hear you is the
 * browser's own speech service (which sends what you say to its maker), or
 * when nothing can yet: say yes to it, or set up private dictation instead.
 */
export function VoiceGate({
  choice,
  open,
  onOpenChange,
  onReady,
}: {
  choice: EngineChoice | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Said yes: carry on with what was pressed. */
  onReady: () => void;
}) {
  const consent = choice?.kind === 'consent';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>{consent ? 'Who hears you?' : 'Talk to Conch'}</Dialog.Title>
          <Dialog.Description>
            {consent
              ? 'This browser turns speech into text with its maker’s service: Google for Chrome and Edge, Apple for Safari. They hear what you say.'
              : choice?.kind === 'none'
                ? choice.reason
                : 'To hear you, Conch needs a way to turn speech into text.'}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            {consent && (
              <Button
                leadingIcon={<Mic />}
                onClick={() => {
                  setVoicePrefs({ cloudOk: true });
                  onOpenChange(false);
                  onReady();
                }}
              >
                That’s fine, use it
              </Button>
            )}
            {choice?.kind !== 'none' && (
              <Stack gap={2}>
                <Text size="sm" weight="medium">
                  <LockKeyhole size={14} aria-hidden /> Private dictation, on this computer
                </Text>
                <Text size="sm" tone="muted">
                  Your voice never leaves the computer Conch runs on. A one-time download of about
                  150 MB.
                </Text>
                <PrivateDictation compact onReady={onReady} />
              </Stack>
            )}
          </Stack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
