import {
  type GeneratorOptions,
  generatePassword,
  isConcealed,
  passwordScore,
  type SaveVaultItemBody,
  templateFor,
  type VaultFieldKind,
  type VaultFieldRole,
  type VaultItemDetail,
  type VaultItemType,
} from '@conch/protocol';
import {
  Button,
  DropdownMenu,
  Field,
  IconButton,
  Input,
  PasswordGenerator,
  Popover,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  toast,
  VaultItemIcon,
  type GeneratorSettings,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { useAutoFocus } from '../../lib/useAutoFocus';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import { copySecret } from './clipboard';
import styles from './Passwords.module.css';
import { vaultKeys } from './queries';

interface DraftField {
  key: string;
  id?: string;
  label: string;
  kind: VaultFieldKind;
  role?: VaultFieldRole;
  /** Undefined: a stored secret left as it is (the browser never had it). */
  value?: string;
  /** A stored secret exists for this field. */
  stored: boolean;
}

const KIND_CHOICES: { kind: VaultFieldKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'secret', label: 'Password or secret' },
  { kind: 'totp', label: 'One-time code' },
  { kind: 'url', label: 'Web address' },
  { kind: 'email', label: 'Email' },
  { kind: 'phone', label: 'Phone' },
  { kind: 'date', label: 'Date' },
  { kind: 'pin', label: 'PIN' },
  { kind: 'multiline', label: 'Several lines' },
  { kind: 'secretText', label: 'Hidden text' },
];

let counter = 0;
const key = () => `f${++counter}`;

function draftFrom(type: VaultItemType, item?: VaultItemDetail): DraftField[] {
  if (item)
    return item.fields.map((f) => ({
      key: key(),
      id: f.id,
      label: f.label,
      kind: f.kind,
      role: f.role,
      value: f.value,
      stored: f.value === undefined && f.filled,
    }));
  return templateFor(type).fields.map((f) => ({ key: key(), ...f, value: '', stored: false }));
}

const GENERATOR_DEFAULTS: GeneratorSettings = {
  style: 'random',
  length: 20,
  symbols: true,
  digits: true,
  unambiguous: true,
};

/** Remembered for the session, so the next new password uses the same kind. */
let lastGenerator = GENERATOR_DEFAULTS;

function GenerateButton({ onUse }: { onUse: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(lastGenerator);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton size="sm" label="Make a strong password">
          <Sparkles />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content align="end" padding="md">
        <PasswordGenerator
          settings={settings}
          onSettingsChange={(next) => {
            lastGenerator = next;
            setSettings(next);
          }}
          generate={(s) => generatePassword(s as Partial<GeneratorOptions>)}
          score={passwordScore}
          onCopy={(v) => void copySecret(v)}
          onUse={(v) => {
            onUse(v);
            setOpen(false);
          }}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

function FieldInput({
  field,
  onChange,
}: {
  field: DraftField;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const secret = isConcealed(field.kind);
  if (field.stored && field.value === undefined)
    return (
      <Stack direction="row" gap={2} align="center">
        <Input id={id} aria-label={field.label} value="••••••••••••" readOnly size="sm" />
        <Button size="sm" variant="ghost" onClick={() => onChange('')}>
          Change
        </Button>
      </Stack>
    );
  if (field.kind === 'multiline' || field.kind === 'secretText')
    return (
      <Textarea
        aria-label={field.label}
        value={field.value ?? ''}
        rows={field.kind === 'secretText' ? 4 : 3}
        spellCheck={field.kind !== 'secretText'}
        onChange={(e) => onChange(e.target.value)}
        className={field.kind === 'secretText' ? styles.mono : undefined}
      />
    );
  const strength =
    field.role === 'password' && field.value ? passwordScore(field.value) : undefined;
  return (
    <Stack gap={1}>
      <Input
        aria-label={field.label}
        size="sm"
        value={field.value ?? ''}
        type={
          field.kind === 'email'
            ? 'email'
            : field.kind === 'url'
              ? 'url'
              : field.kind === 'phone'
                ? 'tel'
                : field.kind === 'date'
                  ? 'date'
                  : 'text'
        }
        inputMode={field.kind === 'pin' || field.kind === 'number' ? 'numeric' : undefined}
        placeholder={
          field.kind === 'totp'
            ? 'Paste the setup key, or the otpauth:// link'
            : field.kind === 'monthYear'
              ? 'MM/YY'
              : undefined
        }
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        className={secret ? styles.mono : undefined}
        onChange={(e) => onChange(e.target.value)}
        trailing={field.kind === 'secret' ? <GenerateButton onUse={onChange} /> : undefined}
      />
      {strength !== undefined && (
        <Text size="xs" tone="subtle">
          {['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][strength]}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Adding or changing an item. Starts from its kind's fields; anything can be
 * added, renamed or taken away. A saved secret stays as it is unless you
 * choose to change it — the page never had it, and never needs it.
 */
export function ItemEditor({
  item,
  type: newType,
  guard,
  onDone,
  onCancel,
}: {
  item?: VaultItemDetail;
  type?: VaultItemType;
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const type = item?.type ?? newType ?? 'login';
  const template = templateFor(type);
  const [title, setTitle] = useState(item?.title ?? '');
  const [fields, setFields] = useState(() => draftFrom(type, item));
  const [urls, setUrls] = useState<string[]>(
    item?.urls.length ? item.urls : template.urls ? [''] : [],
  );
  const [tags, setTags] = useState((item?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [favorite, setFavorite] = useState(item?.favorite ?? false);
  const [agentAccess, setAgentAccess] = useState(item?.agentAccess ?? 'ask');
  const [agentRead, setAgentRead] = useState(item?.agentRead ?? 'ask');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const titleRef = useAutoFocus<HTMLInputElement>();

  const patch = (k: string, change: Partial<DraftField>) =>
    setFields((list) => list.map((f) => (f.key === k ? { ...f, ...change } : f)));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(undefined);
    const site = urls.find(Boolean);
    const body: SaveVaultItemBody = {
      type,
      title:
        title.trim() ||
        (site ? site.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : template.name),
      fields: fields
        .filter((f) => f.label.trim())
        .map((f) => ({
          ...(f.id && { id: f.id }),
          label: f.label.trim(),
          kind: f.kind,
          ...(f.role && { role: f.role }),
          ...(f.value !== undefined && { value: f.value }),
        })),
      urls: urls.map((u) => u.trim()).filter(Boolean),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      notes,
      favorite,
      agentAccess,
      agentRead,
      allowedSites: item?.allowedSites ?? [],
    };
    setSaving(true);
    try {
      const saved = item
        ? await guard(() => vaultApi.update(item.id, body))
        : await vaultApi.create(body);
      if (!saved) return;
      client.setQueryData(vaultKeys.item(saved.id), saved);
      void client.invalidateQueries({ queryKey: vaultKeys.all });
      toast.success(item ? 'Saved' : `“${saved.title}” added to your passwords`);
      onDone(saved.id);
    } catch (e) {
      setProblem(errorText(e, 'Couldn’t save it.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={styles.detail}
      onSubmit={(e) => void save(e)}
      aria-label={item ? `Edit ${item.title}` : `New ${template.name.toLowerCase()}`}
    >
      <div className={styles.detailHead}>
        <VaultItemIcon
          kind={type}
          domain={urls[0]?.replace(/^https?:\/\//, '').split('/')[0]}
          title={title || template.name}
          size="lg"
        />
        <div className={styles.detailTitle}>
          <Input
            ref={titleRef}
            aria-label="Name"
            placeholder={
              template.urls ? 'Name, e.g. Netflix' : `Name this ${template.name.toLowerCase()}`
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
      </div>

      <div className={styles.editorGrid}>
        {fields.map((f) => (
          <div key={f.key} className={styles.editorRow}>
            <Input
              aria-label="Field name"
              size="sm"
              value={f.label}
              onChange={(e) => patch(f.key, { label: e.target.value })}
              className={styles.editorLabel}
            />
            <FieldInput field={f} onChange={(value) => patch(f.key, { value })} />
            <IconButton
              size="sm"
              label={`Remove ${f.label || 'field'}`}
              onClick={() => setFields((list) => list.filter((x) => x.key !== f.key))}
            >
              <X />
            </IconButton>
          </div>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="ghost" leadingIcon={<Plus />} className={styles.addField}>
              Add a field
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start">
            {KIND_CHOICES.map((c) => (
              <DropdownMenu.Item
                key={c.kind}
                onSelect={() =>
                  setFields((list) => [
                    ...list,
                    {
                      key: key(),
                      label: c.kind === 'totp' ? 'One-time code' : c.label,
                      kind: c.kind,
                      ...(c.kind === 'totp' && { role: 'totp' as const }),
                      value: '',
                      stored: false,
                    },
                  ])
                }
              >
                {c.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {(template.urls || urls.length > 0) && (
        <Field>
          <Field.Label size="sm">Websites</Field.Label>
          <Stack gap={2}>
            {urls.map((u, i) => (
              <Stack key={i} direction="row" gap={2} align="center">
                <Input
                  size="sm"
                  aria-label={`Website ${i + 1}`}
                  placeholder="netflix.com"
                  value={u}
                  inputMode="url"
                  onChange={(e) =>
                    setUrls((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
                <IconButton
                  size="sm"
                  label="Remove this website"
                  onClick={() => setUrls((list) => list.filter((_, j) => j !== i))}
                >
                  <X />
                </IconButton>
              </Stack>
            ))}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Plus />}
              onClick={() => setUrls((list) => [...list, ''])}
              className={styles.addField}
            >
              Add a website
            </Button>
          </Stack>
        </Field>
      )}

      <Field>
        <Field.Label size="sm">Notes</Field.Label>
        <Textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field>
        <Field.Label size="sm">Tags</Field.Label>
        <Input
          size="sm"
          placeholder="Work, Family"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <Field.Description>
          Separate them with commas. They become filters in the list.
        </Field.Description>
      </Field>
      <Field>
        <Field.Label size="sm" id="agent-access">
          Your assistant
        </Field.Label>
        <Select
          aria-labelledby="agent-access"
          value={agentAccess}
          onValueChange={(v) => setAgentAccess(v as typeof agentAccess)}
        >
          <Select.Item value="ask">May fill it in, asking you each time</Select.Item>
          <Select.Item value="allow">May fill it in on its websites without asking</Select.Item>
          <Select.Item value="never">Never uses it</Select.Item>
        </Select>
        <Field.Description>
          It never sees the password: Conch types it into the page itself, and only on this item’s
          websites.
        </Field.Description>
      </Field>
      {agentAccess !== 'never' && (
        <Field>
          <Field.Label size="sm" id="agent-read">
            When it needs to read something itself
          </Field.Label>
          <Select
            aria-labelledby="agent-read"
            value={agentRead}
            onValueChange={(v) => setAgentRead(v as typeof agentRead)}
          >
            <Select.Item value="ask">Ask me each time, in the chat</Select.Item>
            <Select.Item value="allow">Let it read without asking</Select.Item>
          </Select>
          <Field.Description>
            For a PIN on a phone call, a note, or a key for a command. Signing in on a website never
            needs this.
          </Field.Description>
        </Field>
      )}
      <Switch label="Favourite" checked={favorite} onCheckedChange={setFavorite} />

      {problem && (
        <Text tone="danger" size="sm" role="alert">
          {problem}
        </Text>
      )}
      <div className={styles.editorActions}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {item ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
