/**
 * Move to another agent (ADR 0154): what another agent needs to recreate this
 * routine, to copy, then pausing it here with a reason the Routines page shows.
 */
import type { Routine } from '@conch/protocol';
import { Button, Dialog, Field, Input, Skeleton, Stack, Text, Textarea, toast } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';

import { routinesApi } from './api';
import { useUpdateRoutine } from './queries';

export function MoveToAgent({
  routine,
  open,
  onOpenChange,
}: {
  routine: Routine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const exported = useQuery({
    queryKey: ['routines', routine.id, 'export'],
    queryFn: () => routinesApi.exportOne(routine.id),
    enabled: open,
  });
  const [agent, setAgent] = useState('');
  const update = useUpdateRoutine();
  const on = routine.status === 'active';
  const copy = (text: string, what: string) =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`Copied ${what}`))
      .catch(() => toast.error('Couldn’t copy it. Select the text and copy it yourself.'));
  const pause = () =>
    update.mutate(
      {
        id: routine.id,
        patch: {
          status: 'paused',
          pausedReason: agent.trim() ? `Moved to ${agent.trim()}` : 'Moved to another agent',
        },
      },
      {
        onSuccess: () => {
          toast.success(`Paused “${routine.title}” here`);
          onOpenChange(false);
        },
      },
    );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>Move to another agent</Dialog.Title>
          <Dialog.Description>
            Give the other agent this description to set it up there, then pause it here so it
            doesn’t run twice.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            {exported.data ? (
              <Field>
                <Field.Label>What it needs</Field.Label>
                <Textarea readOnly autosize minRows={6} maxRows={14} value={exported.data.text} />
                <Stack direction="row" gap={2}>
                  <Button
                    size="sm"
                    variant="surface"
                    leadingIcon={<Copy />}
                    onClick={() => copy(exported.data.text, 'the description')}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      copy(JSON.stringify(exported.data.export, null, 2), 'it as JSON')
                    }
                  >
                    Copy as JSON
                  </Button>
                </Stack>
              </Field>
            ) : exported.isError ? (
              <Text tone="muted">Couldn’t read it just now. Close this and try again.</Text>
            ) : (
              <Skeleton shape="block" height="10rem" />
            )}
            {on && (
              <Field>
                <Field.Label>Which agent takes it over?</Field.Label>
                <Input
                  value={agent}
                  maxLength={60}
                  placeholder="Hermes"
                  onChange={(e) => setAgent(e.target.value)}
                />
                <Field.Description>
                  Shown beside it in Routines: “Paused: Moved to {agent.trim() || 'another agent'}”.
                </Field.Description>
              </Field>
            )}
            <Text size="xs" tone="subtle">
              An agent on this computer can do this itself: conch routines export, then conch
              routines pause.
            </Text>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {on ? 'Not now' : 'Done'}
          </Button>
          {on && (
            <Button onClick={pause} loading={update.isPending}>
              Pause it here
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
