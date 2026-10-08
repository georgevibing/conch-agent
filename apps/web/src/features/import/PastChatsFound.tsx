import type { ChatImportStatus } from '@conch/protocol';
import { Button, ChatsFound, Kbd, toast, type ChatsFoundSource } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Search } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { foundSources, pastChatKeys, pastChatsApi } from './pastChats';

const nf = new Intl.NumberFormat('en');
const plural = (n: number, one: string, many = `${one}s`) =>
  `${nf.format(n)} ${n === 1 ? one : many}`;

/**
 * The moment Conch finds your past conversations (ADR 0111), and the one
 * press that brings them in: “Found 1,284 conversations from Claude Code and
 * Codex — bring them in?”. It follows them in, and ends on what to try next.
 * Nothing when there's nothing new to bring.
 */
export function PastChatsFound({
  status,
  onLater,
  onDone,
  laterLabel = 'Not now',
  primaryRef,
}: {
  status: ChatImportStatus;
  onLater?: () => void;
  /** They're in: the next press (the welcome carries on). */
  onDone?: () => void;
  laterLabel?: string;
  primaryRef?: Ref<HTMLButtonElement>;
}) {
  const client = useQueryClient();
  const setPalette = useUi((s) => s.setPalette);
  // What was found when the press came, so the moment keeps its counts while they come in.
  const [taken, setTaken] = useState<ChatsFoundSource[]>();
  const [starting, setStarting] = useState(false);
  const started = useRef(false);
  const running = status.running;
  const finished = Boolean(taken) && !running && !starting;

  // A run that started elsewhere (another tab, Repair everything) is followed here too.
  if (running && !taken) setTaken(foundSources(status.sources, 'fresh'));

  useEffect(() => {
    if (!finished || started.current) return;
    started.current = true;
    // What came in is in search now, and in the counts everywhere else.
    void client.invalidateQueries({ queryKey: ['search'] });
  }, [finished, client]);

  const fresh = foundSources(status.sources, 'fresh');
  const sources = taken ?? fresh;
  if (!sources.length) return null;

  const bring = async () => {
    setTaken(fresh);
    setStarting(true);
    try {
      client.setQueryData(pastChatKeys.status, await pastChatsApi.start());
    } catch (failure) {
      setTaken(undefined);
      toast.error(
        failure instanceof ApiError ? failure.message : 'Couldn’t bring them in. Try again.',
      );
    } finally {
      setStarting(false);
    }
  };

  if (finished) {
    const last = status.last;
    // Counted again now they're read: a file with nothing in it isn't a conversation.
    const ids = new Set(sources.map((s) => s.id));
    const here = foundSources(status.sources).filter((s) => ids.has(s.id));
    return (
      <ChatsFound
        sources={here.length ? here : sources}
        phase="done"
        title={(n) => <>{n} conversations are here</>}
        lead={
          <>
            Search them with <Kbd keys="mod+k" size="sm" />, or ask about one in any chat: “what did
            we decide about…?”
          </>
        }
        note={[
          last?.redacted
            ? `${plural(last.redacted, 'thing')} that looked like a key or a password ${last.redacted === 1 ? 'was' : 'were'} taken out.`
            : '',
          last?.skipped ? `${plural(last.skipped, 'file')} couldn’t be read and stayed out.` : '',
          'New ones come in by themselves.',
        ]
          .filter(Boolean)
          .join(' ')}
        action={
          <>
            <Button
              ref={primaryRef}
              variant={onDone ? 'surface' : 'solid'}
              leadingIcon={<Search />}
              onClick={() => setPalette(true)}
            >
              Search them
            </Button>
            {onDone && (
              <Button trailingIcon={<ArrowRight />} onClick={onDone}>
                Continue
              </Button>
            )}
          </>
        }
      />
    );
  }

  return (
    <ChatsFound
      sources={sources}
      phase={running || starting ? 'bringing' : 'found'}
      {...(running && {
        progress: {
          done: running.done,
          total: running.total,
          ...(running.current && { current: `Reading ${running.current}` }),
        },
      })}
      note="They come in to read and search, and to carry on here. Nothing in those apps changes, and anything that looks like a key or a password is taken out."
      action={
        running || starting ? undefined : (
          <>
            <Button ref={primaryRef} onClick={() => void bring()}>
              Bring them in
            </Button>
            {onLater && (
              <Button variant="ghost" onClick={onLater}>
                {laterLabel}
              </Button>
            )}
          </>
        )
      }
    />
  );
}
