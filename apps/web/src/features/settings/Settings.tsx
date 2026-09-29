import type { Memory, Persona, Profile } from '@conch/protocol';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  RadioGroup,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  accents,
  toast,
  useMediaQuery,
  useNacreTheme,
  type AccentName,
  type ColorMode,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Check,
  Cpu,
  Gauge,
  Monitor,
  Moon,
  Palette,
  Plus,
  Sparkles,
  SquareSlash,
  Sun,
  Trash2,
  User,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { api } from '../../api/client';
import {
  keys,
  setEngineStatus,
  useAppState,
  useMemories,
  useUpdateSettings,
} from '../../api/queries';
import { useUi, type SettingsTab } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { EngineConnect } from '../engine/EngineConnect';
import { toneOptions } from '../onboarding/tones';
import styles from './Settings.module.css';
import { CommandsTab } from './CommandsTab';
import { ModelsTab } from './ModelsTab';
import { SaveStatus, Section } from './Section';
import { useAutosave } from './useAutosave';

function PersonalityTab({ initial }: { initial: Persona }) {
  const update = useUpdateSettings();
  const [persona, setPersona] = useState(initial);
  const status = useAutosave(persona, (p) =>
    update.mutateAsync({ persona: { ...p, name: p.name.trim() || 'Conch' } }),
  );
  return (
    <Section
      title="Personality"
      description="How your assistant introduces itself and sounds."
      status={<SaveStatus status={status} />}
    >
      <Stack gap={5}>
        <Field>
          <Field.Label>Name</Field.Label>
          <Input
            value={persona.name}
            maxLength={40}
            onChange={(e) => setPersona({ ...persona, name: e.target.value })}
          />
        </Field>
        <Stack gap={2}>
          <Text as="span" size="sm" weight="medium" id="settings-tone">
            Voice
          </Text>
          <RadioGroup
            variant="card"
            aria-labelledby="settings-tone"
            value={persona.tone}
            onValueChange={(tone) => setPersona({ ...persona, tone: tone as Persona['tone'] })}
            className={styles.tones}
          >
            {toneOptions.map((t) => (
              <RadioGroup.Item
                key={t.value}
                value={t.value}
                label={t.label}
                description={t.sample}
              />
            ))}
          </RadioGroup>
        </Stack>
        <Field>
          <Field.Label optional>Instructions</Field.Label>
          <Textarea
            autosize
            minRows={3}
            maxRows={10}
            value={persona.instructions}
            placeholder="Always use British spelling. Suggest tests when I share code."
            onChange={(e) => setPersona({ ...persona, instructions: e.target.value })}
          />
          <Field.Description>Anything you’d like followed in every conversation.</Field.Description>
        </Field>
      </Stack>
    </Section>
  );
}

function AboutTab({ initial }: { initial: Profile }) {
  const update = useUpdateSettings();
  const [profile, setProfile] = useState(initial);
  const status = useAutosave(profile, (p) => update.mutateAsync({ profile: p }));
  return (
    <Section
      title="About you"
      description="Always in context, so you never have to repeat yourself."
      status={<SaveStatus status={status} />}
    >
      <Stack gap={5}>
        <Field>
          <Field.Label>What should I call you?</Field.Label>
          <Input
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          />
        </Field>
        <Field>
          <Field.Label>About you</Field.Label>
          <Textarea
            autosize
            minRows={5}
            maxRows={14}
            value={profile.about}
            placeholder="What you do, what you care about, how you like to work…"
            onChange={(e) => setProfile({ ...profile, about: e.target.value })}
          />
        </Field>
      </Stack>
    </Section>
  );
}

function MemoryEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useAutoFocus<HTMLTextAreaElement>();
  return (
    <Textarea
      ref={ref}
      autosize
      minRows={1}
      maxRows={6}
      aria-label="Edit memory"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSave}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSave();
        }
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

function MemoryRow({ memory }: { memory: Memory }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.content);
  const refresh = () => void client.invalidateQueries({ queryKey: keys.memories });
  const save = async () => {
    setEditing(false);
    if (!value.trim() || value.trim() === memory.content) return setValue(memory.content);
    try {
      await api.updateMemory(memory.id, { content: value.trim() });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <li className={styles.memory}>
      {editing ? (
        <MemoryEditor
          value={value}
          onChange={setValue}
          onSave={() => void save()}
          onCancel={() => {
            setValue(memory.content);
            setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.memoryText}
          onClick={() => setEditing(true)}
          aria-label={`Edit: ${memory.content}`}
        >
          {memory.content}
        </button>
      )}
      <div className={styles.memoryMeta}>
        <Badge size="sm" tone={memory.source === 'user' ? 'neutral' : 'accent'} variant="soft">
          {memory.source === 'user' ? 'You added' : 'Learned'}
        </Badge>
        <Text as="span" size="xs" tone="subtle">
          {relativeTime(memory.updatedAt)}
        </Text>
        <span className={styles.spacer} />
        <IconButton
          size="sm"
          label="Forget"
          onClick={async () => {
            try {
              await api.deleteMemory(memory.id);
              refresh();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

function MemoryTab({ autoMemory }: { autoMemory: boolean }) {
  const client = useQueryClient();
  const memories = useMemories();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState('');
  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await api.addMemory(content);
      setDraft('');
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Section
      title="Memory"
      description="What I remember across conversations. Stored as plain files in ~/.conch/memory — yours to read, edit or delete."
    >
      <Stack gap={5}>
        <Switch
          checked={autoMemory}
          onCheckedChange={(checked) =>
            void update.mutateAsync({ preferences: { autoMemory: checked } })
          }
          label="Remember things automatically"
          description="I’ll save useful details as we talk and always show you when I do."
        />
        <form
          className={styles.addMemory}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="Add a memory"
            placeholder="Add something for me to remember…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="surface" leadingIcon={<Plus />} disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        {memories.data?.length === 0 && (
          <EmptyState
            size="sm"
            icon={<Brain />}
            title="Nothing remembered yet"
            description="Tell me things like “remember I’m vegetarian” in a chat, or add them here."
          />
        )}
        {Boolean(memories.data?.length) && (
          <ul className={styles.memories} aria-label="Memories">
            {memories.data?.map((m) => (
              <MemoryRow key={m.id} memory={m} />
            ))}
          </ul>
        )}
      </Stack>
    </Section>
  );
}

function EngineTab({ workspace, workspacePref }: { workspace: string; workspacePref?: string }) {
  const { data: app } = useAppState();
  const client = useQueryClient();
  const update = useUpdateSettings();
  const [folder, setFolder] = useState(workspacePref ?? '');
  const status = useAutosave(
    folder,
    (f) => update.mutateAsync({ preferences: { workspace: f.trim() } }),
    900,
  );
  const engine = app?.engine;
  return (
    <Stack gap={8}>
      <Section
        title="Claude Code"
        description="Conch delegates every conversation to Claude Code on this computer."
      >
        {engine?.state === 'ready' ? (
          <Stack gap={4}>
            <dl className={styles.facts}>
              <dt>Status</dt>
              <dd>
                <Badge tone="success" dot>
                  Connected
                </Badge>
              </dd>
              <dt>Account</dt>
              <dd>{engine.auth?.description ?? 'Signed in'}</dd>
              {engine.version && (
                <>
                  <dt>Version</dt>
                  <dd>{engine.version}</dd>
                </>
              )}
              {engine.executablePath && (
                <>
                  <dt>Location</dt>
                  <dd className={styles.mono}>{engine.executablePath}</dd>
                </>
              )}
            </dl>
            <Stack direction="row" gap={2}>
              <Button
                variant="surface"
                size="sm"
                onClick={async () => setEngineStatus(client, await api.engine(true))}
              >
                Check again
              </Button>
              {engine.auth?.method === 'api-key' && (
                <Button
                  variant="ghost"
                  tone="danger"
                  size="sm"
                  onClick={async () => setEngineStatus(client, await api.clearApiKey())}
                >
                  Remove API key
                </Button>
              )}
            </Stack>
          </Stack>
        ) : (
          <EngineConnect />
        )}
      </Section>
      <Section
        title="Working folder"
        description="Where Claude reads and writes files when you ask it to."
        status={<SaveStatus status={status} />}
      >
        <Field>
          <Field.Label>Folder</Field.Label>
          <Input
            value={folder}
            placeholder={workspace}
            spellCheck={false}
            className={styles.mono}
            onChange={(e) => setFolder(e.target.value)}
          />
          <Field.Description>
            Leave empty to use Conch’s own workspace ({workspace}).
          </Field.Description>
        </Field>
      </Section>
    </Stack>
  );
}

const accentSwatches = Object.keys(accents) as AccentName[];

function AppearanceTab() {
  const theme = useNacreTheme();
  const update = useUpdateSettings();
  return (
    <Stack gap={8}>
      <Section title="Appearance">
        <Stack gap={6}>
          <Stack gap={2}>
            <Text as="span" size="sm" weight="medium" id="mode-label">
              Mode
            </Text>
            <SegmentedControl
              aria-labelledby="mode-label"
              value={theme.mode}
              onValueChange={(mode) => mode && theme.setTheme({ mode: mode as ColorMode })}
            >
              <SegmentedControl.Item value="light" icon={<Sun />}>
                Light
              </SegmentedControl.Item>
              <SegmentedControl.Item value="dark" icon={<Moon />}>
                Dark
              </SegmentedControl.Item>
              <SegmentedControl.Item value="system" icon={<Monitor />}>
                System
              </SegmentedControl.Item>
            </SegmentedControl>
          </Stack>
          <Stack gap={2}>
            <Text as="span" size="sm" weight="medium" id="accent-label">
              Accent
            </Text>
            <div className={styles.swatches} role="radiogroup" aria-labelledby="accent-label">
              {accentSwatches.map((name) => {
                const selected = theme.accent === name;
                const { hue, chroma } = accents[name];
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={name}
                    title={name}
                    className={styles.swatch}
                    style={{ background: `oklch(0.64 ${chroma} ${hue})` }}
                    onClick={() => theme.setTheme({ accent: name })}
                  >
                    {selected && <Check aria-hidden />}
                  </button>
                );
              })}
            </div>
          </Stack>
          <Stack gap={2}>
            <Text as="span" size="sm" weight="medium" id="lustre-label">
              Lustre
            </Text>
            <Slider
              aria-labelledby="lustre-label"
              min={0}
              max={1}
              step={0.05}
              value={[theme.lustre]}
              onValueChange={([v]) => theme.setTheme({ lustre: v ?? 1 })}
            />
            <Text size="xs" tone="subtle">
              The pearl shimmer on surfaces as your pointer moves.
            </Text>
          </Stack>
          <Switch
            checked={theme.motion === 'reduced'}
            onCheckedChange={(on) => theme.setTheme({ motion: on ? 'reduced' : 'system' })}
            label="Reduce motion"
            description="Calmer transitions throughout Conch."
          />
        </Stack>
      </Section>
      <Section
        title="Start over"
        description="Replay the welcome and set-up. Your conversations and memories stay."
      >
        <div>
          <Button
            variant="surface"
            size="sm"
            onClick={() => void update.mutateAsync({ onboarded: false })}
          >
            Replay welcome
          </Button>
        </div>
      </Section>
    </Stack>
  );
}

const tabs: { value: SettingsTab; label: string; icon: ReactNode }[] = [
  { value: 'personality', label: 'Personality', icon: <Sparkles /> },
  { value: 'about', label: 'About you', icon: <User /> },
  { value: 'memory', label: 'Memory', icon: <Brain /> },
  { value: 'models', label: 'Models & modes', icon: <Gauge /> },
  { value: 'commands', label: 'Commands', icon: <SquareSlash /> },
  { value: 'engine', label: 'Claude Code', icon: <Cpu /> },
  { value: 'appearance', label: 'Appearance', icon: <Palette /> },
];

export function Settings() {
  const tab = useUi((s) => s.settings);
  const open = useUi((s) => s.openSettings);
  const close = useUi((s) => s.closeSettings);
  const { data: app } = useAppState();
  const narrow = useMediaQuery('(max-width: 720px)');

  return (
    <Dialog.Root open={tab !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Content size="xl" className={styles.dialog} aria-describedby={undefined}>
        <Dialog.Title className={styles.srOnly}>Settings</Dialog.Title>
        {app && tab && (
          <Tabs
            value={tab}
            onValueChange={(v) => open(v as SettingsTab)}
            orientation={narrow ? 'horizontal' : 'vertical'}
            variant="pill"
            className={styles.tabs}
          >
            <div className={styles.nav}>
              <Text as="span" size="sm" weight="semibold" className={styles.navTitle}>
                Settings
              </Text>
              <Tabs.List aria-label="Settings sections" className={styles.list}>
                {tabs.map((t) => (
                  <Tabs.Trigger key={t.value} value={t.value} icon={t.icon}>
                    {t.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </div>
            <div className={styles.panel}>
              <Tabs.Content value="personality">
                <PersonalityTab initial={app.persona} />
              </Tabs.Content>
              <Tabs.Content value="about">
                <AboutTab initial={app.profile} />
              </Tabs.Content>
              <Tabs.Content value="memory">
                <MemoryTab autoMemory={app.preferences.autoMemory} />
              </Tabs.Content>
              <Tabs.Content value="models">
                <ModelsTab />
              </Tabs.Content>
              <Tabs.Content value="commands">
                <CommandsTab />
              </Tabs.Content>
              <Tabs.Content value="engine">
                <EngineTab workspace={app.workspace} workspacePref={app.preferences.workspace} />
              </Tabs.Content>
              <Tabs.Content value="appearance">
                <AppearanceTab />
              </Tabs.Content>
            </div>
          </Tabs>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
