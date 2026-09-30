import {
  SKILL_DESCRIPTION_MAX,
  SkillName,
  type SkillDetail,
  type SkillMode,
} from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  CopyButton,
  EmptyState,
  Field,
  Heading,
  Input,
  SegmentedControl,
  SkillIcon,
  SkillProblem,
  skillModeLabels,
  Skeleton,
  Stack,
  Text,
  Textarea,
  toast,
  type SkillProblemFix,
} from '@conch/nacre';
import { ArrowLeft, Copy, MessageSquare, SearchX, Sparkles, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { SaveStatus } from '../settings/Section';
import { useAutosaveState } from '../settings/useAutosave';
import { skillsApi } from './api';
import {
  errorText,
  skillKeys,
  useCopySkill,
  useRemoveSkill,
  useSkill,
  useUpdateSkill,
} from './queries';
import styles from './Skills.module.css';

export function SkillDetailView({ skillId }: { skillId: string }) {
  const { data: skill, isPending, isError } = useSkill(skillId);
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className={`${styles.page} ${styles.narrow}`}>
        <Skeleton shape="block" height="4rem" />
        <Skeleton shape="block" height="12rem" />
      </div>
    );
  }
  if (isError || !skill) {
    return (
      <div className={`${styles.page} ${styles.narrow}`}>
        <EmptyState
          icon={<SearchX />}
          title="That skill isn’t here any more"
          description="It may have been renamed, removed, or moved out of its folder."
          actions={<Button onClick={() => void navigate('/skills')}>See all skills</Button>}
        />
      </div>
    );
  }
  return <SkillPage key={skill.id} skill={skill} />;
}

function SkillPage({ skill }: { skill: SkillDetail }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const update = useUpdateSkill();
  const copy = useCopySkill();
  const remove = useRemoveSkill();
  const [confirming, setConfirming] = useState(false);
  const [fields, setFields] = useState({
    title: skill.title,
    description: skill.description,
    instructions: skill.instructions,
  });
  const [name, setName] = useState(skill.name);
  const [rewriting, setRewriting] = useState(false);
  const nameCheck = SkillName.safeParse(name);

  const { status, settle } = useAutosaveState(
    fields,
    (next) =>
      update.mutateAsync({
        id: skill.id,
        patch: {
          ...(next.title.trim() && { title: next.title.trim() }),
          ...(next.description.trim() && { description: next.description.trim() }),
          ...(next.instructions.trim() && { instructions: next.instructions.trim() }),
        },
      }),
    800,
  );

  const rename = () => {
    if (name === skill.name || !nameCheck.success) return;
    update.mutate(
      { id: skill.id, patch: { name } },
      {
        onSuccess: (renamed) => {
          toast.success(`Now /${renamed.name}`);
          void navigate(`/skills/${encodeURIComponent(renamed.id)}`, { replace: true });
        },
        onError: () => setName(skill.name),
      },
    );
  };

  const rewrite = async () => {
    setRewriting(true);
    try {
      const draft = await skillsApi.draft(fields.instructions);
      setFields((f) => ({ ...f, title: draft.title, description: draft.description }));
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t write them just now.'));
    } finally {
      setRewriting(false);
    }
  };

  const setMode = (mode: SkillMode) => update.mutate({ id: skill.id, patch: { mode } });
  const tryIt = () => void navigate('/', { state: { draft: `/${skill.name} ` } });

  const makeCopy = () =>
    copy.mutateAsync(skill.id).then((copied) => {
      toast.success('Copied into Conch', { description: 'This copy is yours to change.' });
      void navigate(`/skills/${encodeURIComponent(copied.id)}`);
    });

  /** Read the folders again, for a file that couldn't be read a moment ago. */
  const lookAgain = async () => {
    await skillsApi.list(true).catch(() => undefined);
    const fresh = await client
      .fetchQuery({ queryKey: skillKeys.one(skill.id), queryFn: () => skillsApi.get(skill.id) })
      .catch(() => undefined);
    void client.invalidateQueries({ queryKey: skillKeys.all });
    if (fresh?.problem) toast('Still the same', { description: fresh.problem });
  };

  // A broken skill offers the one thing that fixes it (working agreement 11).
  const describable =
    skill.problemKind === 'no-description' || skill.problemKind === 'no-front-matter';
  const problemFix: SkillProblemFix | undefined = !skill.problem
    ? undefined
    : describable && skill.editable
      ? {
          kind: 'describe',
          maxLength: SKILL_DESCRIPTION_MAX,
          onDraft: () => skillsApi.describe(skill.id),
          onSave: async (description) => {
            await update.mutateAsync({ id: skill.id, patch: { description } });
            // Into the form below too, without saving it a second time.
            const next = { ...fields, description };
            settle(next);
            setFields(next);
            toast.success('Description saved', { description: 'The skill is ready to use.' });
          },
        }
      : describable
        ? { kind: 'copy', owner: skill.sourceLabel, onCopy: makeCopy }
        : { kind: 'check', onCheck: lookAgain };

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

      <header className={styles.hero}>
        <SkillIcon
          name={skill.name}
          title={fields.title || skill.title}
          size="lg"
          muted={skill.mode === 'off'}
        />
        <div className={styles.heroText}>
          <Heading level={1} display size="3xl">
            {fields.title || skill.title}
          </Heading>
          <Text tone="muted">{fields.description || skill.description}</Text>
          <div className={styles.facts}>
            <Text as="span" size="xs" tone="subtle">
              {skill.editable ? 'Yours' : `From ${skill.sourceLabel}`}
            </Text>
            <span className={styles.path} title={skill.path}>
              {skill.path}
            </span>
            <CopyButton value={skill.path} label="Copy folder path" size="sm" />
          </div>
        </div>
      </header>

      <Stack direction="row" gap={2} wrap>
        <Button
          leadingIcon={<MessageSquare />}
          onClick={tryIt}
          disabled={skill.mode === 'off' || Boolean(skill.problem)}
        >
          Try it in a chat
        </Button>
        {/* A broken one offers its copy below, with the reason. */}
        {!skill.editable && problemFix?.kind !== 'copy' && (
          <Button
            variant="surface"
            leadingIcon={<Copy />}
            loading={copy.isPending}
            onClick={() => void makeCopy().catch(() => undefined)}
          >
            Make a copy to edit
          </Button>
        )}
        {skill.editable && (
          <Button
            variant="ghost"
            tone="danger"
            leadingIcon={<Trash2 />}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </Stack>

      {skill.problem && problemFix && <SkillProblem problem={skill.problem} fix={problemFix} />}
      {!skill.editable && problemFix?.kind !== 'copy' && (
        <Callout tone="info" title={`From ${skill.sourceLabel}`}>
          Conch reads this folder but never changes it. Skills found in other apps start off — read
          it below, then choose when to use it.
        </Callout>
      )}
      {skill.loadedBy && (
        <Text size="sm" tone="muted">
          {skill.loadedBy} also reads this folder by itself, so it may use this skill whatever you
          choose here.
        </Text>
      )}

      <Field>
        <Field.Label>Use it</Field.Label>
        <SegmentedControl
          value={skill.mode}
          onValueChange={(v) => v && setMode(v as SkillMode)}
          aria-label="Use it"
        >
          {(['auto', 'manual', 'off'] as const).map((mode) => (
            <SegmentedControl.Item key={mode} value={mode} disabled={Boolean(skill.problem)}>
              {skillModeLabels[mode].label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <Field.Description>
          {skill.mode === 'off'
            ? 'Never used.'
            : skill.mode === 'auto'
              ? `Used whenever a request fits. Or type /${skill.name}.`
              : `Only when you type /${skill.name}.`}
        </Field.Description>
      </Field>

      {skill.editable ? (
        <Stack gap={4}>
          <Stack direction="row" justify="between" align="center" gap={3}>
            <Heading level={2} size="lg">
              Details
            </Heading>
            <SaveStatus status={status} />
          </Stack>
          <div className={styles.fields}>
            <Field>
              <Field.Label>Title</Field.Label>
              <Input
                value={fields.title}
                maxLength={60}
                onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field invalid={!nameCheck.success}>
              <Field.Label>Command</Field.Label>
              <Input
                value={name}
                leading={<span aria-hidden>/</span>}
                spellCheck={false}
                maxLength={64}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename();
                }}
              />
              {nameCheck.success ? (
                <Field.Description>
                  Also the folder’s name. Saved when you leave the field.
                </Field.Description>
              ) : (
                <Field.Error>{nameCheck.error.issues[0]?.message}</Field.Error>
              )}
            </Field>
            <Field className={styles.wide}>
              <Field.Label>Description</Field.Label>
              <Textarea
                autosize
                minRows={2}
                maxRows={4}
                maxLength={SKILL_DESCRIPTION_MAX}
                value={fields.description}
                onChange={(e) =>
                  setFields((f) => ({ ...f, description: e.target.value.replace(/\n/g, ' ') }))
                }
                footer={
                  <Text as="span" size="xs" tone="subtle">
                    {fields.description.length}/{SKILL_DESCRIPTION_MAX}
                  </Text>
                }
              />
              <Field.Description>
                What it does and when to use it — this is how an assistant decides it fits.
              </Field.Description>
            </Field>
          </div>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Sparkles />}
            loading={rewriting}
            onClick={() => void rewrite()}
            className={styles.back}
          >
            Write the title and description again
          </Button>
          <Field>
            <Field.Label>Instructions</Field.Label>
            <Textarea
              autosize
              minRows={8}
              maxRows={30}
              className={styles.instructions}
              value={fields.instructions}
              onChange={(e) => setFields((f) => ({ ...f, instructions: e.target.value }))}
            />
          </Field>
        </Stack>
      ) : (
        <Stack gap={2}>
          <Heading level={2} size="lg">
            Instructions
          </Heading>
          <pre className={styles.readOnly}>{skill.instructions}</pre>
        </Stack>
      )}

      {skill.files.length > 0 && (
        <Stack gap={2}>
          <Heading level={2} size="sm" tone="muted">
            Files it can use
          </Heading>
          <ul className={styles.files}>
            {skill.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </Stack>
      )}

      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Content tone="danger">
          <AlertDialog.Title>Delete {skill.title}?</AlertDialog.Title>
          <AlertDialog.Description>
            Its folder is removed from this computer, and /{skill.name} stops working. Chats that
            used it keep what they said.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep it</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                tone="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(skill.id, {
                    onSuccess: () => {
                      toast(`${skill.title} deleted`);
                      void navigate('/skills', { replace: true });
                    },
                  })
                }
              >
                Delete skill
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}
