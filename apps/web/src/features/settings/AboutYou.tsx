import {
  PROFILE_KIND_WORDS,
  ProfileFactKind,
  UnderstoodProfile,
  avatarUrl,
  describeProfile,
  type Profile,
  type ProfileFact,
} from '@conch/protocol';
import {
  Button,
  Collapsible,
  Portrait,
  Stack,
  Text,
  Textarea,
  toast,
  type PortraitCard,
} from '@conch/nacre';
import { Briefcase, ChevronRight, Heart, House, Sparkles, Users, Wand2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, request } from '../../api/client';
import { keys, useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { MEMORY_ALL } from './paths';
import { Section, SaveStatus } from './Section';
import { useAutosave } from './useAutosave';
import styles from './AboutYou.module.css';

const ICONS = {
  work: <Briefcase />,
  home: <House />,
  person: <Users />,
  interest: <Heart />,
  way: <Sparkles />,
} as const;

const EXAMPLES: Record<ProfileFactKind, string> = {
  work: 'Designer at a small studio',
  home: 'Lives in Lisbon since 2019',
  person: 'Sam',
  interest: 'Bouldering',
  way: 'Short answers first',
};

/** The five cards, named as the assistant reads them. */
const CARDS: PortraitCard[] = ProfileFactKind.options.map((kind) => ({
  kind,
  title: PROFILE_KIND_WORDS[kind].title,
  icon: ICONS[kind],
  example: EXAMPLES[kind],
  ...(kind === 'person' && {
    detailLabel: 'Who they are to you',
    detailExample: 'partner · birthday 3 May',
  }),
}));

const newId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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

const same = (a: Pick<ProfileFact, 'kind' | 'text'>, b: Pick<ProfileFact, 'kind' | 'text'>) =>
  a.kind === b.kind && a.text.trim().toLowerCase() === b.text.trim().toLowerCase();

/**
 * Settings → About you: a portrait, not a form. Your name and a line that
 * sums you up; a card for each part of your life; your own words, which Conch
 * can read into cards for you; and, plainly, what every chat starts with.
 */
export function AboutYou({ initial }: { initial: Profile }) {
  const update = useUpdateSettings();
  const memories = useMemories();
  const openSettings = useUi((s) => s.openSettings);
  const client = useQueryClient();
  const { data: app } = useAppState();
  // The photo has its own route, so it stays out of what's typed here and saved as you go.
  const [profile, setProfile] = useState<Omit<Profile, 'avatar'>>(() => {
    const { avatar: _photo, ...rest } = initial;
    return { ...rest, facts: initial.facts ?? [] };
  });
  const [suggested, setSuggested] = useState<ProfileFact[]>([]);
  const [reading, setReading] = useState(false);
  const status = useAutosave(profile, (p) => update.mutateAsync({ profile: p }));
  const photo = avatarUrl(app?.profile ?? initial);

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
  const facts = profile.facts;
  const setFacts = (next: ProfileFact[]) => setProfile((p) => ({ ...p, facts: next }));
  const remembered = (memories.data ?? []).filter((m) => !m.pending).length;

  const read = async () => {
    setReading(true);
    try {
      const found = await request(UnderstoodProfile, '/api/profile/understand', {
        method: 'POST',
        body: { about: profile.about },
      });
      // Only what isn't on a card already.
      const fresh = found.facts.filter(
        (f) => !facts.some((g) => same(f, g)) && !suggested.some((g) => same(f, g)),
      );
      if (!fresh.length) toast('Everything there is already on your cards.');
      setSuggested((s) => [...s, ...fresh]);
    } catch (error) {
      toast.error((error as Error).message || 'That couldn’t be read just now.');
    } finally {
      setReading(false);
    }
  };

  const keep = (ids: string[]) => {
    const kept = suggested.filter((f) => ids.includes(f.id));
    setFacts([...facts, ...kept]);
    setSuggested(suggested.filter((f) => !ids.includes(f.id)));
  };

  return (
    <Stack gap={8}>
      <Section
        title="About you"
        description="Every chat starts knowing this, so you never have to repeat yourself."
        status={<SaveStatus status={status} />}
      >
        <Portrait
          name={profile.name}
          onNameChange={(name) => setProfile((p) => ({ ...p, name }))}
          photo={photo}
          onPhotoSave={savePhoto}
          onPhotoRemove={removePhoto}
          summary={summarise(facts)}
          cards={CARDS}
          facts={facts}
          suggested={suggested}
          onAdd={(fact) => setFacts([...facts, { ...fact, id: newId() } as ProfileFact])}
          onChange={(fact) =>
            setFacts(facts.map((f) => (f.id === fact.id ? (fact as ProfileFact) : f)))
          }
          onRemove={(id) => setFacts(facts.filter((f) => f.id !== id))}
          onKeep={(id) => keep([id])}
          onKeepAll={() => keep(suggested.map((f) => f.id))}
          onDismiss={(id) => setSuggested(suggested.filter((f) => f.id !== id))}
        />
      </Section>

      <Section
        title="In your own words"
        description="Anything the cards don’t hold, the way you’d say it. I read this too."
      >
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
              Lay it out as cards
            </Button>
          </div>
        </Stack>
      </Section>

      <Collapsible className={styles.starts}>
        <Collapsible.Trigger chevron className={styles.startsTrigger}>
          What every chat starts with
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Stack gap={3} className={styles.startsBody}>
            <Text size="xs" tone="muted">
              Exactly what your assistant reads about you, word for word, before anything you say.
            </Text>
            <pre className={styles.prompt}>
              {['# About the user', ...describeProfile(profile)].join('\n')}
            </pre>
            {remembered > 0 && (
              <Text size="sm" tone="muted">
                It also remembers {remembered === 1 ? 'one thing' : `${remembered} things`} from
                your chats.{' '}
                <Button
                  variant="ghost"
                  size="sm"
                  trailingIcon={<ChevronRight />}
                  onClick={() => openSettings('memory', MEMORY_ALL)}
                >
                  See them
                </Button>
              </Text>
            )}
          </Stack>
        </Collapsible.Content>
      </Collapsible>
    </Stack>
  );
}
