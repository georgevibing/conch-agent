import type { CustomCommand } from '@conch/protocol';
import {
  Button,
  Field,
  Heading,
  IconButton,
  Input,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { api, ApiError } from '../../api/client';
import { keys, useAppState, useCapabilities, useCommands } from '../../api/queries';
import { builtins } from '../commands/slash';
import styles from './Skills.module.css';

/** `navigate('/skills', { state: { focus: COMMANDS_FOCUS } })`: straight to Your commands. */
export const COMMANDS_FOCUS = 'commands';

interface Draft {
  name: string;
  description: string;
  prompt: string;
  /** Name before editing (renames delete the old file). */
  original?: string;
}

const blank: Draft = { name: '', description: '', prompt: '' };

function CommandEditor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const client = useQueryClient();
  const [value, setValue] = useState(draft);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const name = value.name.trim().toLowerCase().replace(/^\//, '');

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.saveCommand({ name, description: value.description.trim(), prompt: value.prompt });
      if (draft.original && draft.original !== name) await api.deleteCommand(draft.original);
      await client.invalidateQueries({ queryKey: keys.commands });
      toast.success(`/${name} is ready`, { description: 'Type / in any chat to use it.' });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save this command.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.commandEditor}>
      <Stack gap={4}>
        <Field invalid={Boolean(error)}>
          <Field.Label>Name</Field.Label>
          <Input
            value={value.name}
            leading={
              <Text as="span" tone="subtle">
                /
              </Text>
            }
            placeholder="standup"
            maxLength={32}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
          {error ? (
            <Field.Error>{error}</Field.Error>
          ) : (
            <Field.Description>Lowercase letters, numbers and dashes.</Field.Description>
          )}
        </Field>
        <Field>
          <Field.Label optional>Description</Field.Label>
          <Input
            value={value.description}
            placeholder="Draft my standup update"
            maxLength={200}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
        </Field>
        <Field>
          <Field.Label>What it asks</Field.Label>
          <Textarea
            autosize
            minRows={3}
            maxRows={12}
            value={value.prompt}
            placeholder="Write a short standup update from these notes: {{input}}"
            onChange={(e) => setValue({ ...value, prompt: e.target.value })}
          />
          <Field.Description>
            Use <code>{'{{input}}'}</code> where the text you type after the command should go.
            Without it, your text is added to the end.
          </Field.Description>
        </Field>
        <Stack direction="row" gap={2} justify="end">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!name || !value.prompt.trim()}
          >
            Save command
          </Button>
        </Stack>
      </Stack>
    </div>
  );
}

function CommandRow({ command, onEdit }: { command: CustomCommand; onEdit: () => void }) {
  const client = useQueryClient();
  return (
    <li className={styles.commandRow}>
      <Stack gap={0.5} className={styles.commandText}>
        <Text as="span" weight="medium" className={styles.commandName}>
          /{command.name}
        </Text>
        <Text as="span" size="sm" tone="muted" truncate>
          {command.description || command.prompt}
        </Text>
      </Stack>
      <Stack direction="row" gap={1}>
        <IconButton label={`Edit /${command.name}`} size="sm" onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton
          label={`Delete /${command.name}`}
          size="sm"
          onClick={async () => {
            await api.deleteCommand(command.name);
            await client.invalidateQueries({ queryKey: keys.commands });
            toast(`/${command.name} deleted`, {
              action: {
                label: 'Undo',
                onClick: () =>
                  void api
                    .saveCommand(command)
                    .then(() => client.invalidateQueries({ queryKey: keys.commands })),
              },
            });
          }}
        >
          <Trash2 />
        </IconButton>
      </Stack>
    </li>
  );
}

/**
 * Skills → Your commands: prompts you use often, each a `/name` in any chat.
 * Conch's own commands and the provider's are only counted here: typing /
 * lists them all, where they're used.
 */
export function CommandsSection() {
  const { data: commands } = useCommands();
  const { data: app } = useAppState();
  const { data: caps } = useCapabilities(app?.engine.state === 'ready');
  const [editing, setEditing] = useState<Draft | null>(null);
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const wanted = (location.state as { focus?: string } | null)?.focus === COMMANDS_FOCUS;
  // Opened from ⌘K, /commands or an old Settings → Commands address: straight here.
  useEffect(() => {
    if (wanted) ref.current?.scrollIntoView({ block: 'start' });
  }, [wanted]);
  const theirs = caps?.commands.length ?? 0;

  return (
    <section ref={ref} id="commands" aria-labelledby="skills-commands" className={styles.section}>
      <div className={styles.commandsHead}>
        <Stack gap={0.5}>
          <Heading level={2} id="skills-commands" size="sm" tone="muted">
            Your commands
          </Heading>
          <Text size="xs" tone="subtle">
            Prompts you use often. Type / in any chat for these
            {theirs > 0
              ? `, Conch’s own ${builtins.length} commands and ${theirs} from your provider.`
              : ` and Conch’s own ${builtins.length} commands.`}
          </Text>
        </Stack>
        {!editing && (
          <Button
            variant="surface"
            size="sm"
            leadingIcon={<Plus />}
            onClick={() => setEditing(blank)}
          >
            New command
          </Button>
        )}
      </div>
      {editing && <CommandEditor draft={editing} onDone={() => setEditing(null)} />}
      {commands && commands.length === 0 && !editing && (
        <Text size="sm" tone="muted">
          None yet. For example, /standup could turn your notes into a tidy update.
        </Text>
      )}
      {commands && commands.length > 0 && (
        <ul className={styles.commandList} aria-label="Your commands">
          {commands.map((c) => (
            <CommandRow
              key={c.name}
              command={c}
              onEdit={() => setEditing({ ...c, original: c.name })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
