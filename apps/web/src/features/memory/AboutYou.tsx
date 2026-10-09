import {
  UnderstoodProfile,
  avatarUrl,
  describeProfile,
  type Memory,
  type MemoryKind,
  type Profile,
  type ProfileFact,
  type ProfileFactKind,
} from '@conch/protocol';
import {
  Button,
  Portrait,
  Stack,
  Text,
  Textarea,
  toast,
  type PortraitFact,
  type PortraitGroup,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Heart, House, MessageSquareText, Users, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api, request } from '../../api/client';
import { keys, useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useAutosave } from '../settings/useAutosave';
import { guessFactKind } from './guess';
import styles from './Memory.module.css';

/** `openSettings('memory', TELL_FOCUS)`: Memory, with the line to tell Conch something ready to type in. */
export const TELL_FOCUS = 'tell';

/** The parts of your life, in the order a portrait reads: how you like answers first. */
const GROUPS: (PortraitGroup & { kind: ProfileFactKind })[] = [
  {
    kind: 'way',
    title: 'How you like answers',
    icon: <MessageSquareText />,
    invite: 'How do you like answers?',
    example: 'Short answers first',
  },
  {
    kind: 'person',
    title: 'People',
    icon: <Users />,
    invite: 'Who’s close to you?',
    example: 'Sam',
    detailLabel: 'Who they are to you',
    detailExample: 'partner · birthday 3 May',
  },
  {
    kind: 'work',
    title: 'Work and projects',
    icon: <Briefcase />,
    invite: 'What do you work on?',
    example: 'Designer at a small studio',
  },
  {
    kind: 'home',
    title: 'Places',
    icon: <House />,
    invite: 'Where do you live?',
    example: 'Lives in Lisbon since 2019',
  },
  {
    kind: 'interest',
    title: 'What you’re into',
    icon: <Heart />,
    invite: 'What are you into?',
    example: 'Bouldering',
  },
];

/** Where a memory sits on the portrait. Facts (about this computer, a lesson) stay in the list. */
const MEMORY_GROUP: Partial<Record<MemoryKind, ProfileFactKind>> = {
  preference: 'way',
  person: 'person',
  project: 'work',
};

const newId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const same = (a: Pick<ProfileFact, 'kind' | 'text'>, b: Pick<ProfileFact, 'kind' | 'text'>) =>
  a.kind === b.kind && a.text.trim().toLowerCase() === b.text.trim().toLowerCase();

/** One line that sums you up: what you do, where you live, who's close. */
export function summarise(facts: readonly ProfileFact[]): string {
  const first = (kind: ProfileFactKind) => facts.find((f) => f.kind === kind)?.text;
  const people = facts.filter((f) => f.kind === 'person').map((f) => f.text);
  const close =
    people.length > 2
      ? `${people.slice(0, 2).join(', ')} +${people.length - 2}`
      : people.join(', ');
  return [first('work'), first('home'), close].filter(Boolean).join(' · ');
}

/** “3 May”, or “3 May 2024” from another year. */
function day(at: number): string {
  const date = new Date(at);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
  });
}

/** Where a memory came from, in a few words: “Learned from a chat on 3 May”. */
export function sourceOf(memory: Memory): string {
  const on = day(memory.createdAt);
  if (memory.provenance?.via === 'import') return `Brought from another assistant on ${on}`;
  if (memory.source === 'user') return `You asked me to remember this on ${on}`;
  if (memory.source === 'tidy') return `From a tidy-up on ${on}`;
  return `Learned from a chat on ${on}`;
}

/** What it learned, as facts on the portrait: kept, still true, about you, not already said. */
export function learnedFacts(
  memories: readonly Memory[],
  told: readonly ProfileFact[],
): (PortraitFact & { memory: Memory })[] {
  return memories.flatMap((memory) => {
    const kind = MEMORY_GROUP[memory.kind];
    if (!kind || memory.pending || memory.invalidAt || memory.about) return [];
    if (told.some((f) => same(f, { kind, text: memory.content }))) return [];
    return [{ id: `m:${memory.id}`, kind, text: memory.content, learned: true, memory }];
  });
}

/**
 * About you, kept as you change it: your name, your cards and your own words,
 * saved a moment after you stop. One per page, shared by the portrait at the
 * top of Memory and your own words under its Advanced.
 */
export function useAboutYou(initial: Profile) {
  const update = useUpdateSettings();
  // The photo has its own route, so it stays out of what's typed here and saved as you go.
  const [profile, setProfile] = useState<Omit<Profile, 'avatar'>>(() => {
    const { avatar: _photo, ...rest } = initial;
    return { ...rest, facts: initial.facts ?? [] };
  });
  const [suggested, setSuggested] = useState<ProfileFact[]>([]);
  // What arrived while you were here: it surfaces with a glint, once.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const status = useAutosave(profile, (p) => update.mutateAsync({ profile: p }));
  const facts = profile.facts;
  const setFacts = (next: (all: ProfileFact[]) => ProfileFact[]) =>
    setProfile((p) => ({ ...p, facts: next(p.facts) }));
  const arrive = (ids: string[]) => setFresh((s) => new Set([...s, ...ids]));
  return {
    profile,
    setProfile,
    facts,
    setFacts,
    suggested,
    setSuggested,
    fresh,
    arrive,
    status,
  };
}

export type AboutYouEditor = ReturnType<typeof useAboutYou>;

/**
 * The portrait at the top of Memory: who you are, what you told Conch and
 * what it learned from your chats, together. Every chip can be corrected or
 * removed where it is, with Undo; one line at the foot tells it something new.
 */
export function AboutYouPortrait({ editor }: { editor: AboutYouEditor }) {
  const { profile, setProfile, facts, setFacts, suggested, setSuggested, fresh, arrive } = editor;
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data: app } = useAppState();
  const memories = useMemories();
  const photo = avatarUrl(app?.profile ?? {});
  const refresh = () => void client.invalidateQueries({ queryKey: keys.memories });
  const tell = useRef<HTMLInputElement>(null);
  const focus = useUi((s) => s.settingsFocus);
  // ⌘K → Tell Conch something about you: the line, ready.
  useEffect(() => {
    if (focus !== TELL_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    tell.current?.scrollIntoView({ block: 'center' });
    tell.current?.focus();
  }, [focus]);
  const fail = (e: unknown) => toast.error((e as Error).message || 'That didn’t work just now.');

  const savePhoto = async (blob: Blob) => {
    client.setQueryData(keys.state, await api.savePhoto(blob));
  };
  const removePhoto = async () => {
    // Kept a moment, so Undo can put it back as it was.
    const was = photo ? await fetch(photo).then((r) => (r.ok ? r.blob() : undefined)) : undefined;
    client.setQueryData(keys.state, await api.removePhoto());
    toast('Your photo is gone.', {
      ...(was && {
        action: {
          label: 'Undo',
          onClick: () => void savePhoto(was).catch(() => toast.error('It couldn’t be put back.')),
        },
      }),
    });
  };

  const learned = learnedFacts(memories.data ?? [], facts);
  const shown: PortraitFact[] = [
    ...facts.map((f) => ({ ...f, arriving: fresh.has(f.id) })),
    ...learned.map(({ memory, ...fact }) => ({
      ...fact,
      arriving: fresh.has(fact.id),
      maxLength: 2000,
      source: sourceOf(memory),
      ...(memory.conversationId && {
        sourceAction: {
          label: 'Open the chat',
          onSelect: () => void navigate(`/c/${memory.conversationId}`),
        },
      }),
    })),
  ];
  const memoryOf = (id: string) => learned.find((f) => f.id === id)?.memory;

  const add = (fact: { kind: string; text: string; detail?: string }) => {
    const id = newId();
    setFacts((all) => [...all, { ...fact, id } as ProfileFact]);
    arrive([id]);
  };

  const change = (fact: PortraitFact) => {
    const memory = memoryOf(fact.id);
    if (memory) {
      void api.updateMemory(memory.id, { content: fact.text }).then(refresh, fail);
      return;
    }
    setFacts((all) =>
      all.map((f) =>
        f.id === fact.id
          ? { id: f.id, kind: f.kind, text: fact.text, ...(fact.detail && { detail: fact.detail }) }
          : f,
      ),
    );
  };

  const remove = (id: string) => {
    const memory = memoryOf(id);
    if (memory) {
      void api.deleteMemory(memory.id).then(() => {
        refresh();
        toast('Forgotten', {
          description: memory.content,
          action: {
            label: 'Undo',
            onClick: () => void api.addMemory(memory.content, memory.kind).then(refresh, fail),
          },
        });
      }, fail);
      return;
    }
    const at = facts.findIndex((f) => f.id === id);
    const was = facts[at];
    if (!was) return;
    setFacts((all) => all.filter((f) => f.id !== id));
    toast(`Removed “${was.text}”`, {
      action: {
        label: 'Undo',
        onClick: () => {
          setFacts((all) => [...all.slice(0, at), was, ...all.slice(at)]);
          arrive([was.id]);
        },
      },
    });
  };

  const keep = (ids: string[]) => {
    const kept = suggested.filter((f) => ids.includes(f.id));
    setFacts((all) => [...all, ...kept]);
    setSuggested(suggested.filter((f) => !ids.includes(f.id)));
    arrive(ids);
  };

  return (
    <Portrait
      name={profile.name}
      onNameChange={(name) => setProfile((p) => ({ ...p, name }))}
      photo={photo}
      onPhotoSave={savePhoto}
      onPhotoRemove={removePhoto}
      summary={summarise(facts)}
      groups={GROUPS}
      facts={shown}
      suggested={suggested}
      onAdd={add}
      onChange={change}
      onRemove={remove}
      onKeep={(id) => keep([id])}
      onKeepAll={() => keep(suggested.map((f) => f.id))}
      onDismiss={(id) => setSuggested(suggested.filter((f) => f.id !== id))}
      onTell={(text, kind) => add({ kind, text })}
      guessKind={guessFactKind}
      tellRef={tell}
    />
  );
}

/** Your own words, which every chat starts with too; Conch can read them into chips. */
export function InYourOwnWords({ editor }: { editor: AboutYouEditor }) {
  const { profile, setProfile, facts, suggested, setSuggested } = editor;
  const [reading, setReading] = useState(false);
  const read = async () => {
    setReading(true);
    try {
      const found = await request(UnderstoodProfile, '/api/profile/understand', {
        method: 'POST',
        body: { about: profile.about },
      });
      // Only what isn't on the portrait already.
      const fresh = found.facts.filter(
        (f) => !facts.some((g) => same(f, g)) && !suggested.some((g) => same(f, g)),
      );
      if (!fresh.length) toast('Everything there is already on your portrait.');
      setSuggested([...suggested, ...fresh]);
    } catch (error) {
      toast.error((error as Error).message || 'That couldn’t be read just now.');
    } finally {
      setReading(false);
    }
  };
  return (
    <Stack gap={3}>
      <Textarea
        autosize
        minRows={4}
        maxRows={14}
        value={profile.about}
        aria-label="In your own words"
        placeholder="What you do, what you care about, how you like to work…"
        onChange={(e) => setProfile((p) => ({ ...p, about: e.target.value }))}
      />
      <div>
        <Button
          variant="surface"
          size="sm"
          leadingIcon={<Wand2 />}
          loading={reading}
          disabled={!profile.about.trim()}
          onClick={() => void read()}
        >
          Lay it out on your portrait
        </Button>
      </div>
    </Stack>
  );
}

/** Word for word, what the assistant reads about you before anything you say. */
export function WhatEveryChatStartsWith({ editor }: { editor: AboutYouEditor }) {
  return (
    <Stack gap={2}>
      <Text size="xs" tone="muted">
        Word for word, what your assistant reads before anything you say.
      </Text>
      <pre className={styles.prompt}>
        {['# About the user', ...describeProfile(editor.profile)].join('\n')}
      </pre>
    </Stack>
  );
}
