import { SKILL_DESCRIPTION_MAX, type SkillMode } from '@conch/protocol';
import {
  Button,
  Callout,
  Field,
  Heading,
  Input,
  Kbd,
  Page,
  SegmentedControl,
  SkillCard,
  skillModeLabels,
  SkillPermissionList,
  SkillWriting,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { ArrowLeft, Sparkles, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAutoFocus } from '../../lib/useAutoFocus';
import { useAssistantName } from '../integrations/queries';
import { skillsApi } from './api';
import { errorText, useCreateSkill } from './queries';
import styles from './Skills.module.css';
import { SkillIdeas } from './SkillsView';
import type { SuggestedDraft } from './SkillSuggestions';

/** Wait this long after typing stops before asking for a title and description. */
const DRAFT_AFTER_MS = 1100;
/** Too little to say what it's for. */
const DRAFT_MIN_CHARS = 30;

/** `Weekly review` → `weekly-review`, as the gateway will name it. */
export function slugOf(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'new-skill'
  );
}

/** Enough to write a skill from: a few words. */
const WRITE_MIN_CHARS = 8;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Enough changed since the last draft that its title might be wrong now. */
function changedEnough(before: string, after: string) {
  return Math.abs(after.length - before.length) >= 24 || before.slice(0, 60) !== after.slice(0, 60);
}

/**
 * The front door for a skill: say what it should do, in your own words. As
 * you pause, Conch writes a title and a one-line description in the house
 * style — they shimmer, then write themselves in — and you can change either.
 */
export function NewSkill() {
  const navigate = useNavigate();
  const location = useLocation();
  const assistant = useAssistantName();
  const create = useCreateSkill();
  // A suggested skill (ADR 0032, ADR 0058) arrives with its draft: yours to read and change.
  const [start] = useState(() => (location.state as Partial<SuggestedDraft> | null) ?? {});
  const [instructions, setInstructions] = useState(start.instructions ?? '');
  const [title, setTitle] = useState(start.title ?? '');
  const [description, setDescription] = useState(start.description ?? '');
  const [name, setName] = useState<string>();
  const [touched, setTouched] = useState({
    title: Boolean(start.title),
    description: Boolean(start.description),
  });
  // A suggestion starts as something you ask for by name: using it by itself is your call.
  const [mode, setMode] = useState<Exclude<SkillMode, 'off'>>(
    start.suggested || start.learned ? 'manual' : 'auto',
  );
  const [writing, setWriting] = useState(false);
  const drafted = useRef('');
  const inFlight = useRef<AbortController | null>(null);
  // Write it for me: the whole skill from your idea. `before` is what you'd typed.
  const [writer, setWriter] = useState<{
    state: 'idle' | 'writing' | 'written';
    before?: string;
    noModel?: boolean;
  }>({ state: 'idle' });
  const writeFlight = useRef<AbortController | null>(null);
  const reveal = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Opening New skill is asking to write one: the words go straight in.
  const inputRef = useAutoFocus<HTMLTextAreaElement>();

  const text = instructions.trim();
  const needsWords = !touched.title || !touched.description;

  const draft = (force = false) => {
    if (text.length < DRAFT_MIN_CHARS || (!force && !needsWords)) return;
    if (!force && drafted.current && !changedEnough(drafted.current, text)) return;
    inFlight.current?.abort();
    const abort = new AbortController();
    inFlight.current = abort;
    drafted.current = text;
    setWriting(true);
    skillsApi.draft(text, abort.signal).then(
      (result) => {
        if (abort.signal.aborted) return;
        setWriting(false);
        setName(result.name);
        if (force || !touched.title) setTitle(result.title);
        if (force || !touched.description) setDescription(result.description);
        if (force) setTouched({ title: false, description: false });
      },
      () => {
        if (!abort.signal.aborted) setWriting(false);
      },
    );
  };

  // Write the title and description when the typing pauses.
  useEffect(() => {
    if (text.length < DRAFT_MIN_CHARS || !needsWords) return;
    const timer = setTimeout(
      () => draft(),
      drafted.current ? DRAFT_AFTER_MS * 1.6 : DRAFT_AFTER_MS,
    );
    return () => clearTimeout(timer);
    // `draft` reads the latest state; only the words should restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, needsWords]);

  useEffect(
    () => () => {
      inFlight.current?.abort();
      writeFlight.current?.abort();
      clearInterval(reveal.current);
    },
    [],
  );

  /** The steps come in a few words at a time, as if being written (all at once with less motion). */
  const show = (steps: string, done: () => void) => {
    clearInterval(reveal.current);
    drafted.current = steps.trim();
    if (reducedMotion()) {
      setInstructions(steps);
      done();
      return;
    }
    const words = steps.split(/(?<=\s)/);
    const per = Math.max(1, Math.ceil(words.length / 45));
    let at = 0;
    reveal.current = setInterval(() => {
      at = Math.min(words.length, at + per);
      setInstructions(words.slice(0, at).join(''));
      if (at >= words.length) {
        clearInterval(reveal.current);
        done();
      }
    }, 18);
  };

  /** Write the whole skill from `idea`: the steps, a title and a description. */
  const write = (idea: string) => {
    if (idea.trim().length < WRITE_MIN_CHARS) return;
    inFlight.current?.abort();
    writeFlight.current?.abort();
    const abort = new AbortController();
    writeFlight.current = abort;
    setWriter({ state: 'writing', before: idea });
    skillsApi.write(idea.trim(), abort.signal).then(
      (result) => {
        if (abort.signal.aborted) return;
        if (!result.generated) {
          setWriter({ state: 'idle', noModel: result.noModel });
          if (!result.noModel)
            toast.error('Couldn’t write the steps just now.', {
              description: 'Try again in a moment, or write them yourself.',
            });
          return;
        }
        setName(result.name);
        setTitle(result.title);
        setDescription(result.description);
        setTouched({ title: false, description: false });
        show(result.instructions, () => setWriter({ state: 'written', before: idea }));
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setWriter({ state: 'idle' });
        toast.error(errorText(error, 'Couldn’t write the steps just now.'));
      },
    );
  };

  /** Back to what you had typed before it was written. */
  const undoWrite = () => {
    clearInterval(reveal.current);
    writeFlight.current?.abort();
    setInstructions(writer.before ?? '');
    drafted.current = '';
    setWriter({ state: 'idle' });
    inputRef.current?.focus();
  };

  const submit = () => {
    if (!text || create.isPending) return;
    create.mutate(
      {
        instructions: text,
        ...(title.trim() && { title: title.trim() }),
        ...(description.trim() && { description: description.trim() }),
        mode,
        // Only what the work needed, as the draft said (ADR 0058).
        ...(start.permissions && {
          permissions: {
            capabilities: start.permissions.capabilities,
            ...(start.permissions.commands && { commands: start.permissions.commands }),
            ...(start.permissions.apps && { apps: start.permissions.apps }),
          },
        }),
        ...(start.suggestion && { suggestion: start.suggestion }),
      },
      {
        onSuccess: (skill) => {
          toast.success(`${skill.title} is ready`, {
            description:
              mode === 'auto'
                ? `${assistant} uses it when a request fits. Or type /${skill.name}.`
                : `Type /${skill.name} in any chat to use it.`,
          });
          void navigate(`/skills/${encodeURIComponent(skill.id)}`, { replace: true });
        },
        onError: (error) => toast.error(errorText(error, 'Couldn’t save that skill.')),
      },
    );
  };

  const shownTitle = title.trim() || 'New skill';
  const pending = writing && needsWords;

  return (
    <Page gap={6}>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<ArrowLeft />}
        className={styles.back}
        onClick={() => void navigate('/skills')}
      >
        Skills
      </Button>
      <Stack gap={1}>
        <Heading level={1} display size="4xl">
          Teach {assistant} a skill
        </Heading>
        <Text tone="muted">
          {start.learned
            ? `${assistant} wrote this from how your chat “${start.learned.chat}” went: the steps that worked, made to fit next time. Read it, change anything, and save it only if you want it.`
            : start.suggested
              ? `You’ve asked for this in ${start.suggested} chats, so ${assistant} wrote a first draft from what you said. Read it, change anything, and save it only if you want it.`
              : `Describe what it should do, in your own words — a sentence is enough for ${assistant} to write the steps, or write them yourself. It names it and writes a short description; change anything you like.`}
        </Text>
      </Stack>

      {start.learned?.untrusted && (
        <Callout tone="warning" title="Read the steps first">
          {start.learned.untrusted} A page can try to slip in a step of its own, so check each one
          is something you want done.
        </Callout>
      )}

      <Field>
        <Field.Label>What should {assistant} know how to do?</Field.Label>
        <Textarea
          ref={inputRef}
          autosize
          minRows={5}
          maxRows={16}
          size="lg"
          className={styles.prompt}
          value={instructions}
          readOnly={writer.state === 'writing'}
          aria-busy={writer.state === 'writing'}
          placeholder="Every Friday, look at my calendar and notes from the week and write a short review: what went well, what slipped, and three priorities for next week."
          onChange={(e) => setInstructions(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Field.Description>
          Steps, tone, what to include and what to leave out. It’s saved as a SKILL.md, the format
          Claude Code, Codex, OpenClaw and Hermes all read.
        </Field.Description>
      </Field>

      {writer.state !== 'idle' && (
        <SkillWriting
          state={writer.state}
          by={assistant}
          onAgain={() => write(writer.before ?? text)}
          onUndo={undoWrite}
        />
      )}

      {writer.noModel && (
        <Callout
          tone="info"
          title="Writing the steps needs a provider that can write"
          action={
            <Button size="sm" variant="soft" onClick={() => void navigate('/settings/providers')}>
              Connect one
            </Button>
          }
        >
          Claude Code, or a key for a model you pay for as you go, can write them. Until then, your
          words become the skill as they are.
        </Callout>
      )}

      {!text && (
        <Stack gap={2}>
          <Text size="sm" weight="medium" tone="muted">
            Or start from an idea
          </Text>
          <SkillIdeas
            onPick={(words) => {
              setInstructions(words);
              inputRef.current?.focus();
            }}
          />
        </Stack>
      )}

      {text.length > 0 && (
        <Stack gap={4}>
          <SkillCard
            variant="preview"
            name={name && !touched.title ? name : slugOf(shownTitle)}
            title={shownTitle}
            description={
              description ||
              (text.length < DRAFT_MIN_CHARS
                ? 'Keep going — a little more and I’ll describe it.'
                : '')
            }
            mode={mode}
            pending={pending}
          />
          <div className={styles.fields}>
            <Field>
              <Field.Label>Title</Field.Label>
              <Input
                value={title}
                maxLength={60}
                placeholder={pending ? 'Writing…' : 'Weekly review'}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTouched((t) => ({ ...t, title: true }));
                }}
              />
            </Field>
            <Field>
              <Field.Label>Use it</Field.Label>
              <SegmentedControl
                block
                value={mode}
                onValueChange={(v) => v && setMode(v as Exclude<SkillMode, 'off'>)}
                aria-label="Use it"
              >
                <SegmentedControl.Item value="auto">
                  {skillModeLabels.auto.label}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="manual">
                  {skillModeLabels.manual.label}
                </SegmentedControl.Item>
              </SegmentedControl>
              <Field.Description>{skillModeLabels[mode].description}</Field.Description>
            </Field>
            <Field className={styles.wide}>
              <Field.Label>Description</Field.Label>
              <Textarea
                autosize
                minRows={2}
                maxRows={4}
                maxLength={SKILL_DESCRIPTION_MAX}
                value={description}
                placeholder={pending ? 'Writing…' : 'Does X. Use when Y.'}
                onChange={(e) => {
                  setDescription(e.target.value.replace(/\n/g, ' '));
                  setTouched((t) => ({ ...t, description: true }));
                }}
                footer={
                  <Text as="span" size="xs" tone="subtle">
                    {description.length}/{SKILL_DESCRIPTION_MAX}
                  </Text>
                }
              />
              <Field.Description>
                What it does and when to use it. Assistants read this to decide when a skill fits.
              </Field.Description>
            </Field>
          </div>
          {start.permissions?.words && (
            <SkillPermissionList
              variant="compact"
              declared
              capabilities={start.permissions.capabilities}
              words={start.permissions.words}
            />
          )}
        </Stack>
      )}

      <div className={styles.actions}>
        <Stack direction="row" gap={1} align="center" wrap>
          <Button
            variant="soft"
            leadingIcon={<Waypoints />}
            disabled={text.length < WRITE_MIN_CHARS || writer.state === 'writing'}
            loading={writer.state === 'writing'}
            onClick={() => write(writer.state === 'written' ? (writer.before ?? text) : text)}
          >
            {writer.state === 'written' ? 'Write the steps again' : 'Write the steps for me'}
          </Button>
          <Button
            variant="ghost"
            leadingIcon={<Sparkles />}
            disabled={text.length < DRAFT_MIN_CHARS || writing || writer.state === 'writing'}
            onClick={() => draft(true)}
          >
            {title || description ? 'Name it again' : 'Name it for me'}
          </Button>
        </Stack>
        <Stack direction="row" gap={2} align="center">
          <Text as="span" size="xs" tone="subtle">
            <Kbd keys="mod+enter" size="sm" />
          </Text>
          <Button onClick={submit} loading={create.isPending} disabled={!text}>
            Create skill
          </Button>
        </Stack>
      </div>
    </Page>
  );
}
