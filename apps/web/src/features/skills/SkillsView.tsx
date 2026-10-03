import type { Skill } from '@conch/protocol';
import {
  Button,
  EmptyState,
  Heading,
  Input,
  Page,
  SegmentedControl,
  Skeleton,
  SkillCard,
  SkillIcon,
  Stack,
  Text,
} from '@conch/nacre';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAssistantName } from '../integrations/queries';
import { fuzzyFilter } from '../search/fuzzy';
import { useSkills } from './queries';
import { SkillSuggestions } from './SkillSuggestions';
import styles from './Skills.module.css';
import { PublishersSection, useTurnOn } from './SkillTrust';
import { skillIdeas } from './templates';

type Show = 'all' | 'mine' | 'found';

/** Ideas to start from: each opens a new skill with the words filled in. */
export function SkillIdeas({ onPick }: { onPick: (instructions: string) => void }) {
  return (
    <div className={styles.ideas}>
      {skillIdeas.map((idea) => (
        <Button
          key={idea.id}
          variant="surface"
          size="sm"
          leadingIcon={<SkillIcon name={idea.id} title={idea.label} size="xs" />}
          onClick={() => onPick(idea.instructions)}
        >
          {idea.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Skills: things the assistant knows how to do. Yours first, then the ones
 * found in other agents' folders (they start off). One box finds any of them.
 */
export function SkillsView() {
  const { data, isPending } = useSkills();
  // The quick switch: on keeps "When I ask"; one from elsewhere says what it can do first.
  const turnOn = useTurnOn();
  const toggle = (skill: Skill, on: boolean) =>
    turnOn.turn(skill, on ? (skill.mode === 'manual' ? 'manual' : 'auto') : 'off');
  const navigate = useNavigate();
  const assistant = useAssistantName();
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');

  const skills = useMemo(() => data?.skills ?? [], [data]);
  const mine = skills.filter((s) => s.source === 'conch');
  const found = skills.filter((s) => s.source !== 'conch');
  const q = query.trim();
  const matches = useMemo(
    () =>
      q
        ? fuzzyFilter(skills, q, (s) => `${s.title} ${s.name} ${s.description}`, 60).filter(
            ({ item }) => show === 'all' || (show === 'mine') === (item.source === 'conch'),
          )
        : [],
    [skills, q, show],
  );
  const sources = (data?.sources ?? []).filter((s) => s.id !== 'conch' && s.count > 0);

  const open = (skill: Skill) => void navigate(`/skills/${encodeURIComponent(skill.id)}`);
  const start = (instructions?: string) =>
    void navigate('/skills/new', instructions ? { state: { instructions } } : undefined);

  const card = (skill: Skill, highlight?: readonly (readonly [number, number])[]) => (
    <li key={skill.id}>
      <SkillCard
        name={skill.name}
        title={skill.title}
        description={skill.description}
        mode={skill.mode}
        // Conch's own need no label, and a provider that reads it says so already.
        source={
          skill.source === 'conch' || skill.loadedBy === skill.sourceLabel
            ? undefined
            : skill.sourceLabel
        }
        loadedBy={skill.loadedBy}
        problem={skill.problem}
        highlight={highlight
          ?.filter(([start]) => start < skill.title.length)
          .map(([start, end]) => [start, Math.min(end, skill.title.length)] as const)}
        onOpen={() => open(skill)}
        onToggle={(on) => toggle(skill, on)}
      />
    </li>
  );

  return (
    <Page gap={6}>
      <header className={styles.pageHeader}>
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Skills
          </Heading>
          <Text tone="muted">
            Things {assistant} knows how to do. Teach one once, then use it with any model — or type
            / and its name.
          </Text>
        </Stack>
        <Button leadingIcon={<Plus />} onClick={() => start()}>
          New skill
        </Button>
      </header>

      <SkillSuggestions />

      {isPending ? (
        <div className={styles.cards}>
          <Skeleton shape="block" height="6.5rem" />
          <Skeleton shape="block" height="6.5rem" />
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          size="lg"
          icon={<Sparkles />}
          title={`Teach ${assistant} a skill`}
          description={`Write down how you like something done, once. ${assistant} gives it a name, and uses it whenever a request fits — with any model you pick.`}
          actions={
            <Stack gap={4} align="center">
              <Button leadingIcon={<Plus />} onClick={() => start()}>
                New skill
              </Button>
              <SkillIdeas onPick={start} />
            </Stack>
          }
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <Input
              size="sm"
              type="search"
              aria-label="Find a skill"
              placeholder="Find a skill"
              leading={<Search />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.search}
            />
            {found.length > 0 && mine.length > 0 && (
              <SegmentedControl
                size="sm"
                value={show}
                onValueChange={(v) => v && setShow(v as Show)}
                aria-label="Show"
              >
                <SegmentedControl.Item value="all">All</SegmentedControl.Item>
                <SegmentedControl.Item value="mine">Yours</SegmentedControl.Item>
                <SegmentedControl.Item value="found">From other apps</SegmentedControl.Item>
              </SegmentedControl>
            )}
          </div>

          {q ? (
            matches.length ? (
              <ul className={styles.cards} aria-label="Matching skills">
                {matches.map(({ item, match }) => card(item, match.ranges))}
              </ul>
            ) : (
              <Stack gap={2} align="start">
                <Text tone="muted">No skill matches “{q}”.</Text>
                <Button variant="surface" size="sm" leadingIcon={<Plus />} onClick={() => start()}>
                  Teach it one
                </Button>
              </Stack>
            )
          ) : (
            <>
              {show !== 'found' && (
                <section aria-labelledby="skills-mine" className={styles.section}>
                  <Heading level={2} id="skills-mine" size="sm" tone="muted">
                    Yours
                  </Heading>
                  {mine.length ? (
                    <ul className={styles.cards}>{mine.map((s) => card(s))}</ul>
                  ) : (
                    <Stack gap={3} align="start">
                      <Text tone="muted" size="sm">
                        None yet. Start from an idea, or write your own.
                      </Text>
                      <SkillIdeas onPick={start} />
                    </Stack>
                  )}
                </section>
              )}
              {show !== 'mine' && found.length > 0 && (
                <section aria-labelledby="skills-found" className={styles.section}>
                  <Stack gap={0.5}>
                    <Heading level={2} id="skills-found" size="sm" tone="muted">
                      From other apps
                    </Heading>
                    <Text size="xs" tone="subtle">
                      Found in {sources.map((s) => s.label).join(', ')}. They use the same format,
                      so they work here too — read one, then turn it on.
                    </Text>
                  </Stack>
                  <ul className={styles.cards}>{found.map((s) => card(s))}</ul>
                </section>
              )}
            </>
          )}
          <PublishersSection />
        </>
      )}
      {turnOn.dialog}
    </Page>
  );
}
