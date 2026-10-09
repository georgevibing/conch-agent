import { CHAT_SOURCE_LABELS } from '@conch/protocol';
import { Button, PastChatReader, Sheet, Spinner, Text, toast, META_SEP } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { Markdown } from '../chat/Markdown';
import { SOURCE_LOGOS, pastChatsApi, usePastChat, usePastChatSheet } from './pastChats';

/** Messages drawn at first: a long past chat shows its end, and the rest a press away. */
const SHOWN = 120;
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A past chat from another app, opened from wherever it was found (⌘K, the
 * assistant's look back, Settings) in a sheet beside what you were doing
 * (ADR 0111): read-only, with one press to carry it on here.
 */
export function PastChatSheet() {
  const id = usePastChatSheet((s) => s.id);
  const close = () => usePastChatSheet.setState({ id: undefined });
  return (
    <Sheet.Root open={Boolean(id)} onOpenChange={(open) => !open && close()}>
      <Sheet.Content side="right" size="lg" aria-describedby={undefined}>
        <Sheet.Title className="nc-visually-hidden">A past chat</Sheet.Title>
        {id && <PastChatBody id={id} onLeave={close} />}
      </Sheet.Content>
    </Sheet.Root>
  );
}

function PastChatBody({ id, onLeave }: { id: string; onLeave: () => void }) {
  const { data, isError } = usePastChat(id);
  const [all, setAll] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();

  if (isError)
    return (
      <Text tone="muted" size="sm">
        That past chat isn’t in Conch any more.
      </Text>
    );
  if (!data) return <Spinner label="Opening the chat" />;

  const { chat, messages } = data;
  const source = CHAT_SOURCE_LABELS[chat.source];
  const shown = all ? messages : messages.slice(-SHOWN);
  const hidden = messages.length - shown.length;
  const logo = SOURCE_LOGOS[chat.source];

  const carryOn = async () => {
    setCarrying(true);
    try {
      const { conversationId } = await pastChatsApi.carryOn(chat.id);
      void client.invalidateQueries({ queryKey: ['conversations'] });
      onLeave();
      void navigate(`/c/${conversationId}`);
    } catch (failure) {
      toast.error(
        failure instanceof ApiError ? failure.message : 'Couldn’t carry it on. Try again.',
      );
    } finally {
      setCarrying(false);
    }
  };

  return (
    <PastChatReader
      title={chat.title}
      source={source}
      {...(logo && { logo })}
      meta={[
        chat.project,
        day.format(chat.updatedAt),
        `${chat.messages} ${chat.messages === 1 ? 'message' : 'messages'}`,
        chat.model,
      ]
        .filter(Boolean)
        .join(META_SEP)}
      earlier={
        hidden > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show {hidden} earlier {hidden === 1 ? 'message' : 'messages'}
          </Button>
        )
      }
      messages={shown.map((m) => ({
        id: m.id,
        from: m.role,
        at: new Date(m.at),
        children: m.role === 'assistant' ? <Markdown text={m.text} sealed /> : m.text,
      }))}
      note={`Carrying it on starts a chat here with this conversation in it, with ${source} where it’s connected. Nothing changes in ${source}.`}
      action={
        <Button trailingIcon={<ArrowRight />} loading={carrying} onClick={() => void carryOn()}>
          Carry on here
        </Button>
      }
    />
  );
}
