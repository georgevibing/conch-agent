import type { CustomCommand } from '@conch/protocol';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, SquareSlash, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { api, ApiError } from '../../api/client';
import { keys, useAppState, useCapabilities, useCommands } from '../../api/queries';
import { builtins } from '../commands/slash';
import { Section } from './Section';
import styles from './Settings.module.css';

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

export function CommandsTab() {
  const { data: commands } = useCommands();
  const { data: app } = useAppState();
  const { data: caps } = useCapabilities(app?.engine.state === 'ready');
  const [editing, setEditing] = useState<Draft | null>(null);

  return (
    <Stack gap={8}>
      <Section
        title="Your commands"
        description="Save prompts you use often, then run them by typing / in any chat."
      >
        <Stack gap={4}>
          {editing ? (
            <CommandEditor draft={editing} onDone={() => setEditing(null)} />
          ) : (
            <div>
              <Button variant="surface" leadingIcon={<Plus />} onClick={() => setEditing(blank)}>
                New command
              </Button>
            </div>
          )}
          {commands && commands.length === 0 && !editing && (
            <EmptyState
              size="sm"
              icon={<SquareSlash />}
              title="No commands yet"
              description="For example, /standup could turn your notes into a tidy update."
            />
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
        </Stack>
      </Section>

      <Section title="Built in" description="Conch’s own commands. They never go to the model.">
        <ul className={styles.commandList}>
          {builtins.map((b) => (
            <li key={b.name} className={styles.commandRow}>
              <Stack gap={0.5} className={styles.commandText}>
                <Text as="span" weight="medium" className={styles.commandName}>
                  /{b.name}
                  {b.argumentHint && (
                    <Text as="span" tone="subtle" weight="regular">
                      {' '}
                      {b.argumentHint}
                    </Text>
                  )}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  {b.description}
                </Text>
              </Stack>
            </li>
          ))}
        </ul>
      </Section>

      {caps && caps.commands.length > 0 && (
        <Section
          title="From Claude Code"
          description="Commands and skills your Claude Code setup provides, including your plugins."
        >
          <Text size="sm" tone="muted">
            <Badge tone="neutral">{caps.commands.length}</Badge> available — type / in a chat to
            search them.
          </Text>
        </Section>
      )}
    </Stack>
  );
}
