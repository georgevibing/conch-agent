import type { Found, ServerPreset, ServerProbe } from '@conch/protocol';
import {
  Button,
  Field,
  Heading,
  Input,
  IntegrationCard,
  IntegrationHandshake,
  PasswordInput,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { ExternalLink } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { providersApi } from './api';
import { FoundHere } from './FoundHere';
import styles from './Providers.module.css';
import { errorText, useAddServer } from './queries';
import { SERVER_TILE } from './words';

/** Long enough to stop typing; short enough to feel live. */
const LOOK_AFTER_MS = 600;

/** The host an address points at, however it was typed (`gpu-box:8000`, `https://…`). */
function hostOf(address: string): string | undefined {
  if (!address) return undefined;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `http://${address}`).host;
  } catch {
    return undefined;
  }
}

/** Only this computer's own addresses: Ollama and LM Studio's cards talk to them, not to others. */
function onThisComputer(address: string | undefined): boolean {
  const name = address
    ? hostOf(address)
        ?.replace(/:\d+$/, '')
        .replace(/^\[|\]$/g, '')
    : '';
  return name === 'localhost' || name === '::1' || /^127\./.test(name ?? '');
}

/** What the address line says, from what Conch found there. */
function probeWords(probe: ServerProbe): string {
  if (probe.ok) {
    const what = probe.kind ? `${probe.kind}, with` : 'A chat server, with';
    return `${what} ${probe.models ?? 0} model${probe.models === 1 ? '' : 's'}. Ready to add.`;
  }
  return probe.message ?? 'Nothing answered there.';
}

export interface AddServerProps {
  presets: ServerPreset[];
  /** Servers already running on this computer, to add in one press. */
  found: Found[];
  /** Added: open its page. */
  onAdded: (id: string) => void;
  /** Open another provider's page (Ollama and LM Studio have their own). */
  onOpen?: (id: string) => void;
}

/** Servers that are better connected through their own card. */
const OWN_CARDS: Record<string, string> = { Ollama: 'ollama', 'LM Studio': 'lm-studio' };

/**
 * Add a server you run yourself, or a service with an OpenAI-compatible
 * address. Conch looks at the address as you type it and says what it found —
 * "llama.cpp, with 3 models" — so "Add" only appears once it will work.
 */
export function AddServer({ presets, found, onAdded, onOpen }: AddServerProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [preset, setPreset] = useState<ServerPreset>();
  /** The host the key was typed for: it's only ever shown to that one. */
  const [keyHost, setKeyHost] = useState<string>();
  /** What Conch found, and for which address and key: an answer to an older question is no answer. */
  const [answer, setAnswer] = useState<{ ask: string; probe: ServerProbe }>();
  const add = useAddServer();

  const typed = url.trim();
  const host = hostOf(typed);
  // A key typed for one address isn't sent to look at another.
  const keyElsewhere = Boolean(key.trim()) && keyHost !== undefined && keyHost !== host;
  const typedKey = keyElsewhere ? '' : key.trim();
  const ask = `${typed}\n${typedKey}`;
  const lookable = typed.length >= 4;
  const probe = lookable && answer?.ask === ask ? answer.probe : undefined;
  const looking = lookable && !probe;

  // Focus lands on what the page is; the way back is Settings' trail above it.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, []);

  // Look at the address as it's typed, once typing stops; only the latest question is answered.
  useEffect(() => {
    if (!lookable) return;
    let current = true;
    const timer = setTimeout(() => {
      providersApi
        .probeServer(typed, typedKey || undefined)
        .then((found) => {
          if (current) setAnswer({ ask, probe: found });
        })
        .catch(() => {
          if (current)
            setAnswer({ ask, probe: { ok: false, message: 'Conch couldn’t look there.' } });
        });
    }, LOOK_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ask, lookable, typed, typedKey]);

  const choose = (next: ServerPreset) => {
    // Another service: the key typed for the last one stays out of it.
    if (next.id !== preset?.id) {
      setKey('');
      setKeyHost(undefined);
    }
    setPreset(next);
    setUrl(next.url);
    setName(next.name);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { id } = await add.mutateAsync({
        url: url.trim(),
        ...(name.trim() && { name: name.trim() }),
        ...(typedKey && { key: typedKey }),
      });
      toast.success(
        `${name.trim() || probe?.kind || 'Your server'} is connected. Its models are in the picker.`,
      );
      onAdded(id);
    } catch (error) {
      setAnswer({
        ask,
        probe: { ok: false, message: errorText(error, 'That server couldn’t be added.') },
      });
    }
  };

  const wantsKey = probe?.needsKey || (preset && !preset.local);
  const problem = probe && !probe.ok ? probeWords(probe) : undefined;

  return (
    <section aria-labelledby={titleId} className={styles.detail}>
      <Stack gap={3} className={styles.detailHeader}>
        <IntegrationHandshake
          name={SERVER_TILE.name}
          brand="server"
          phase={probe?.ok ? 'connected' : looking ? 'waiting' : 'idle'}
        />
        <Heading level={3} size="xl" id={titleId} ref={titleRef} tabIndex={-1}>
          Add a server
        </Heading>
        <Text tone="muted">{SERVER_TILE.description}</Text>
      </Stack>

      <FoundHere found={found} />

      <form onSubmit={submit}>
        <Stack gap={4}>
          <Field invalid={Boolean(problem && !probe?.needsKey)}>
            <Field.Label>Address</Field.Label>
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreset(undefined);
              }}
              placeholder="localhost:8080, or https://…"
              autoComplete="off"
              spellCheck={false}
              invalid={Boolean(problem && !probe?.needsKey)}
            />
            {problem && probe?.needsKey ? (
              <Field.Description aria-live="polite">{problem}</Field.Description>
            ) : problem ? (
              <Field.Error>{problem}</Field.Error>
            ) : (
              <Field.Description aria-live="polite">
                {looking
                  ? 'Looking…'
                  : probe?.ok
                    ? probeWords(probe)
                    : 'Where the server answers. Plain http works on this computer and your own network.'}
              </Field.Description>
            )}
          </Field>
          {probe?.kind && OWN_CARDS[probe.kind] && onOpen && onThisComputer(probe.url) && (
            <div>
              <Button
                type="button"
                variant="surface"
                size="sm"
                onClick={() => onOpen(OWN_CARDS[probe.kind ?? ''] ?? '')}
              >
                Open {probe.kind}
              </Button>
            </div>
          )}
          <Field>
            <Field.Label>Name</Field.Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={probe?.kind ?? 'The GPU box'}
              maxLength={60}
            />
            <Field.Description>What it’s called in the picker.</Field.Description>
          </Field>
          <Field>
            <Field.Label>{wantsKey ? 'Key' : 'Key, if it asks for one'}</Field.Label>
            <PasswordInput
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyHost(host);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <Field.Description aria-live="polite">
              {keyElsewhere
                ? `That key was typed for ${keyHost}. Type it again to use it with this address.`
                : 'Sent to this server and nowhere else, and kept like every key in Conch.'}
              {preset?.keyUrl && (
                <>
                  {' '}
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                    Get a {preset.name} key <ExternalLink aria-hidden size={12} />
                  </a>
                </>
              )}
            </Field.Description>
          </Field>
          <div>
            <Button
              type="submit"
              loading={add.isPending}
              disabled={!probe?.ok && !(probe?.needsKey && typedKey)}
            >
              Add server
            </Button>
          </div>
        </Stack>
      </form>

      <section aria-labelledby={`${titleId}-start`} className={styles.section}>
        <Heading level={4} size="xs" tone="subtle" id={`${titleId}-start`}>
          Start from one people often use
        </Heading>
        <ul className={styles.tiles}>
          {presets.map((p, index) => (
            <li key={p.id}>
              <IntegrationCard
                variant="catalog"
                index={index}
                name={p.name}
                brand={p.local ? 'server' : p.id}
                color={p.color}
                tagline={p.tagline}
                local={p.local}
                note={p.local ? 'On your computer' : 'Needs its key'}
                onOpen={() => choose(p)}
              />
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
