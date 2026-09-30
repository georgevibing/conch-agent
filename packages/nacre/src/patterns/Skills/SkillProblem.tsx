import { Copy, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { Textarea } from '../../components/Textarea';

/** A description written for a skill, to look over before it's saved. */
export interface DescriptionDraft {
  description: string;
  /** Written by a model, taken from the instructions' first sentence, or nothing to go on. */
  from: 'model' | 'text' | 'none';
  /** No model is connected that could write it. */
  noModel: boolean;
}

/** What can be done about a broken skill, from the page it's on. */
export type SkillProblemFix =
  | {
      /** The skill is yours and only lacks a description: write one. */
      kind: 'describe';
      onDraft: () => Promise<DescriptionDraft>;
      onSave: (description: string) => Promise<unknown>;
      /** Default 160, the strictest reader's limit. */
      maxLength?: number;
    }
  | {
      /** Another app's skill: Conch won't edit it where it lives, but a copy is yours. */
      kind: 'copy';
      /** Whose folder it's in: “Claude Code”, “OpenClaw”… */
      owner: string;
      onCopy: () => unknown;
    }
  | {
      /** The file couldn't be read: look at it, then look again. */
      kind: 'check';
      onCheck: () => unknown;
    };

export interface SkillProblemProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** What's wrong, in a sentence. */
  problem: string;
  fix: SkillProblemFix;
}

const notes: Record<'model' | 'text' | 'none' | 'failed', (noModel: boolean) => string> = {
  model: () => 'Written from its instructions. Change anything you like, then save.',
  text: (noModel) =>
    `${noModel ? 'No model is connected to write one' : 'A model couldn’t write one just now'}, so this is the first sentence of its instructions. Make it say what the skill does and when to use it.`,
  none: () =>
    'It has no instructions to write one from. Type what the skill does and when to use it.',
  failed: () => 'Conch couldn’t write one just now. Type what the skill does and when to use it.',
};

/** Runs a press that may return a promise, showing progress until it settles. */
function usePending() {
  const [pending, setPending] = useState(false);
  const run = (task: () => unknown) => {
    const result = task();
    if (!(result instanceof Promise)) return;
    setPending(true);
    void result.catch(() => undefined).finally(() => setPending(false));
  };
  return [pending, run] as const;
}

function Describe({ fix }: { fix: Extract<SkillProblemFix, { kind: 'describe' }> }) {
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ text: string; note: string }>();
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const max = fix.maxLength ?? 160;
  const text = draft?.text.trim() ?? '';
  const shown = draft !== undefined;

  // The keyboard goes to the draft when it appears, so it can be read and changed.
  useEffect(() => {
    if (shown) field.current?.focus();
  }, [shown]);

  const write = async () => {
    setDrafting(true);
    try {
      const result = await fix.onDraft();
      setDraft({
        text: result.description.slice(0, max),
        note: notes[result.from](result.noModel),
      });
    } catch {
      setDraft({ text: '', note: notes.failed(false) });
    } finally {
      setDrafting(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!text) return;
    setSaving(true);
    try {
      await fix.onSave(text);
    } catch {
      // The caller says what went wrong; the draft stays so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<Sparkles />}
        loading={drafting}
        onClick={() => void write()}
      >
        Write the description for me
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void save(e)} aria-label="Description to save">
      <Stack gap={3}>
        <Field>
          <Field.Label>Description</Field.Label>
          <Field.Description>{draft.note}</Field.Description>
          <Textarea
            ref={field}
            autosize
            minRows={2}
            maxRows={4}
            maxLength={max}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value.replace(/\n/g, ' ') })}
            footer={
              <Text as="span" size="xs" tone="subtle">
                {draft.text.length}/{max}
              </Text>
            }
          />
        </Field>
        <Stack direction="row" gap={2} justify="end">
          <Button variant="ghost" size="sm" onClick={() => setDraft(undefined)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!text}>
            Save
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

/**
 * A skill that can't be used, and the one thing that fixes it — never a
 * dead end. Missing description: Conch writes one from the skill's own words
 * for a quick look, editable, then one Save. Another app's skill: it says
 * where it lives and offers a copy you can edit. A file Conch couldn't read:
 * look at it, then look again.
 */
export function SkillProblem({ problem, fix, ...props }: SkillProblemProps) {
  const [pending, run] = usePending();

  // The button sits under the words, so a phone never squeezes them into a column.
  const control =
    fix.kind === 'describe' ? (
      <Describe fix={fix} />
    ) : fix.kind === 'copy' ? (
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<Copy />}
        loading={pending}
        onClick={() => run(fix.onCopy)}
      >
        Make a copy I can edit
      </Button>
    ) : (
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<RefreshCw />}
        loading={pending}
        onClick={() => run(fix.onCheck)}
      >
        Look again
      </Button>
    );

  return (
    <Callout tone="warning" title="This skill can’t be used yet" {...props}>
      <Stack gap={3}>
        <span>
          {problem}
          {fix.kind === 'copy' &&
            ` It lives in ${fix.owner}’s folder, and Conch won’t change it there.`}
          {fix.kind === 'check' && ' Check the file in its folder, then look again.'}
        </span>
        <div>{control}</div>
      </Stack>
    </Callout>
  );
}
