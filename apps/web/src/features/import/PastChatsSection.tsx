import { AlertDialog, Button, Stack, Text, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { PastChatsFound } from './PastChatsFound';
import { PAST_CHATS_FOCUS, pastChatsApi, useChatImportStatus } from './pastChats';

const nf = new Intl.NumberFormat('en');

/** “Claude Code”, “Claude Code and Codex”. */
const listed = (words: string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * Settings → What Conch knows → “Your past chats” (ADR 0111): the moment when Conch
 * finds conversations from other apps on this computer, and once they're
 * in, one line saying so, with a way to take them out again. Nothing at all
 * for someone who never used another app.
 */
export function PastChatsSection() {
  const client = useQueryClient();
  const { data } = useChatImportStatus();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const focus = useUi((s) => s.settingsFocus);
  const ref = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fresh = Boolean(data?.sources.some((s) => s.fresh > 0) || data?.running);
  // Once found here, the moment stays to the end: it follows them in, then says what's next.
  const [moment, setMoment] = useState(false);
  if (fresh && !moment) setMoment(true);

  // ⌘K and Repair everything arrive here.
  useEffect(() => {
    if (focus !== PAST_CHATS_FOCUS || !data) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focus, data]);

  if (!data || (!data.sources.length && !data.brought)) return null;
  const from = data.sources.filter((s) => s.found > 0).map((s) => s.label);

  const removeAll = async () => {
    setConfirm(false);
    setRemoving(true);
    try {
      let removed = 0;
      const ok = await guard(async () => {
        removed = (await pastChatsApi.removeAll()).removed;
      });
      if (!ok) return;
      void client.invalidateQueries();
      toast.success('Took your past chats out of Conch', {
        description: `${nf.format(removed)} gone from Conch. The apps they came from still have them.`,
      });
    } catch (failure) {
      toast.error(
        failure instanceof ApiError ? failure.message : 'Couldn’t take them out. Try again.',
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Section
      ref={ref}
      title="Your past chats"
      description="Conversations you had in other apps on this computer, brought in to read, search and carry on here."
    >
      <Stack gap={3}>
        {(fresh || moment) && <PastChatsFound status={data} />}
        {data.brought > 0 && (
          <Stack direction="row" gap={3} align="center" wrap>
            <Text size="sm" tone="muted">
              {nf.format(data.brought)} past {data.brought === 1 ? 'chat' : 'chats'}
              {from.length ? ` from ${listed(from)}` : ''} in Conch
              {data.last ? `, last brought in ${relativeTime(data.last.at)}` : ''}. New ones come in
              by themselves.
            </Text>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Trash2 />}
              loading={removing}
              onClick={() => setConfirm(true)}
            >
              Take them out
            </Button>
          </Stack>
        )}
      </Stack>
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Take your past chats out of Conch?</AlertDialog.Title>
            <AlertDialog.Description>
              Search and your assistant won’t find them any more. The apps they came from keep
              theirs, and you can bring them in again. Chats you carried on here stay.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep them</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void removeAll()}>
              Take them out
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </Section>
  );
}
