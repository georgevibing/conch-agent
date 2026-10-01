import { SKILL_DESCRIPTION_MAX, type SkillMode } from '@conch/protocol';
import {
  Button,
  Field,
  Heading,
  Input,
  Kbd,
  SegmentedControl,
  SkillCard,
  skillModeLabels,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAutoFocus } from '../../lib/useAutoFocus';
import { useAssistantName } from '../integrations/queries';
import { skillsApi } from './api';
import { errorText, useCreateSkill } from './queries';
import styles from './Skills.module.css';
import { SkillIdeas } from './SkillsView';

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
  // A suggested skill (ADR 0032) arrives with its draft: yours to read and change.
  const [start] = useState(
    () =>
      (location.state as {
        instructions?: string;
        title?: string;
        description?: string;
        /** From a suggestion: in how many chats you asked. */
        suggested?: number;
      } | null) ?? {},
  );
  const [instructions, setInstructions] = useState(start.instructions ?? '');
  const [title, setTitle] = useState(start.title ?? '');
  const [description, setDescription] = useState(start.description ?? '');
  const [name, setName] = useState<string>();
  const [touched, setTouched] = useState({
    title: Boolean(start.title),
    description: Boolean(start.description),
  });
  // A suggestion starts as something you ask for by name: using it by itself is your call.
  const [mode, setMode] = useState<Exclude<SkillMode, 'off'>>(start.suggested ? 'manual' : 'auto');
  const [writing, setWriting] = useState(false);
  const drafted = useRef('');
  const inFlight = useRef<AbortController | null>(null);
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

  useEffect(() => () => inFlight.current?.abort(), []);

  const submit = () => {
    if (!text || create.isPending) return;
    create.mutate(
      {
        instructions: text,
        ...(title.trim() && { title: title.trim() }),
        ...(description.trim() && { description: description.trim() }),
        mode,
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
    <div className={`${styles.page} ${styles.narrow}`}>
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
          {start.suggested
            ? `You’ve asked for this in ${start.suggested} chats, so ${assistant} wrote a first draft from what you said. Read it, change anything, and save it only if you want it.`
            : `Describe what it should do, in your own words. ${assistant} names it and writes a short description — change either if you like.`}
        </Text>
      </Stack>

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
        </Stack>
      )}

      <div className={styles.actions}>
        <Button
          variant="ghost"
          leadingIcon={<Sparkles />}
          disabled={text.length < DRAFT_MIN_CHARS || writing}
          onClick={() => draft(true)}
        >
          {title || description ? 'Write them again' : 'Name it for me'}
        </Button>
        <Stack direction="row" gap={2} align="center">
          <Text as="span" size="xs" tone="subtle">
            <Kbd keys="mod+enter" size="sm" />
          </Text>
          <Button onClick={submit} loading={create.isPending} disabled={!text}>
            Create skill
          </Button>
        </Stack>
      </div>
    </div>
  );
}
