import type { Persona, Profile } from '@conch/protocol';
import {
  Button,
  Dialog,
  Field,
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
  useMediaQuery,
  useNacreTheme,
  type AccentName,
  type ColorMode,
} from '@conch/nacre';
import {
  BatteryMedium,
  Bell,
  Brain,
  Check,
  Cpu,
  Gauge,
  Mic,
  Globe,
  HeartPulse,
  Monitor,
  SquareTerminal,
  Moon,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  Sun,
  User,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi, type SettingsTab } from '../../app/ui';
import { SecurityTab } from '../auth/SecurityTab';
import { updatesWaiting, useUpdates } from '../updates/queries';
import { BrowserSettings } from '../browser/BrowserSettings';
import { HealthTab } from '../health/HealthTab';
import { ComeHomeSection } from '../import/ComeHomeSection';
import { NotificationsTab } from '../notifications/NotificationsTab';
import { VoiceTab } from '../voice/VoiceTab';
import { TerminalSettings } from '../terminal/TerminalSettings';
import { toneOptions } from '../onboarding/tones';
import { ProvidersTab } from '../providers/ProvidersTab';
import { UsageTab } from '../usage/UsageTab';
import styles from './Settings.module.css';
import { CommandsTab } from './CommandsTab';
import { GeneralTab } from './GeneralTab';
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

function MemoryTab({ autoMemory, tidyMemory }: { autoMemory: boolean; tidyMemory: boolean }) {
  const memories = useMemories();
  const update = useUpdateSettings();
  const navigate = useNavigate();
  const closeSettings = useUi((s) => s.closeSettings);
  const all = memories.data ?? [];
  const waiting = all.filter((m) => m.pending).length;
  const kept = all.length - waiting;
  return (
    <Stack gap={8}>
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
          <Switch
            checked={tidyMemory}
            onCheckedChange={(checked) =>
              void update.mutateAsync({ preferences: { tidyMemory: checked } })
            }
            label="Tidy up every night"
            description="Merge repeats, update what’s changed and learn from your chats while you sleep. Every change is shown, with Undo."
          />
          <div className={styles.memoryDoor}>
            <Brain aria-hidden />
            <Stack gap={0.5} className={styles.memoryDoorText}>
              <Text size="sm" weight="medium">
                What Conch knows about you
              </Text>
              <Text size="xs" tone="muted">
                {kept === 0
                  ? 'Nothing remembered yet.'
                  : kept === 1
                    ? '1 memory'
                    : `${kept} memories`}
                {waiting > 0 && ` · ${waiting} waiting for your OK`}
              </Text>
            </Stack>
            <Button
              size="sm"
              variant="surface"
              onClick={() => {
                closeSettings();
                void navigate('/memory');
              }}
            >
              Open
            </Button>
          </div>
        </Stack>
      </Section>
      <ComeHomeSection />
    </Stack>
  );
}

const accentSwatches = Object.keys(accents) as AccentName[];

function AppearanceTab() {
  const theme = useNacreTheme();
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
    </Stack>
  );
}

const tabs: { value: SettingsTab; label: string; icon: ReactNode }[] = [
  { value: 'general', label: 'General', icon: <Settings2 /> },
  { value: 'personality', label: 'Personality', icon: <Sparkles /> },
  { value: 'about', label: 'About you', icon: <User /> },
  { value: 'memory', label: 'Memory', icon: <Brain /> },
  { value: 'models', label: 'Models & modes', icon: <Gauge /> },
  { value: 'commands', label: 'Commands', icon: <SquareSlash /> },
  { value: 'usage', label: 'Usage', icon: <BatteryMedium /> },
  { value: 'health', label: 'Health', icon: <HeartPulse /> },
  { value: 'security', label: 'Security', icon: <ShieldCheck /> },
  { value: 'notifications', label: 'Notifications', icon: <Bell /> },
  { value: 'voice', label: 'Voice', icon: <Mic /> },
  { value: 'providers', label: 'Providers', icon: <Cpu /> },
  { value: 'browser', label: 'Browser', icon: <Globe /> },
  { value: 'terminal', label: 'Terminal', icon: <SquareTerminal /> },
  { value: 'appearance', label: 'Appearance', icon: <Palette /> },
];

export function Settings() {
  const tab = useUi((s) => s.settings);
  const open = useUi((s) => s.openSettings);
  const close = useUi((s) => s.closeSettings);
  const { data: app } = useAppState();
  const narrow = useMediaQuery('(max-width: 720px)');
  const updates = updatesWaiting(useUpdates().data);

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
                  <Tabs.Trigger
                    key={t.value}
                    value={t.value}
                    icon={t.icon}
                    dot={t.value === 'health' && updates ? 'Update available' : undefined}
                  >
                    {t.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </div>
            <div className={styles.panel}>
              <Tabs.Content value="general">
                <GeneralTab workspace={app.workspace} workspacePref={app.preferences.workspace} />
              </Tabs.Content>
              <Tabs.Content value="personality">
                <PersonalityTab initial={app.persona} />
              </Tabs.Content>
              <Tabs.Content value="about">
                <AboutTab initial={app.profile} />
              </Tabs.Content>
              <Tabs.Content value="memory">
                <MemoryTab
                  autoMemory={app.preferences.autoMemory}
                  tidyMemory={app.preferences.tidyMemory}
                />
              </Tabs.Content>
              <Tabs.Content value="models">
                <ModelsTab />
              </Tabs.Content>
              <Tabs.Content value="commands">
                <CommandsTab />
              </Tabs.Content>
              <Tabs.Content value="usage">
                <UsageTab />
              </Tabs.Content>
              <Tabs.Content value="health">
                <HealthTab />
              </Tabs.Content>
              <Tabs.Content value="security">
                <SecurityTab />
              </Tabs.Content>
              <Tabs.Content value="notifications">
                <NotificationsTab />
              </Tabs.Content>
              <Tabs.Content value="voice">
                <VoiceTab />
              </Tabs.Content>
              <Tabs.Content value="providers">
                <ProvidersTab />
              </Tabs.Content>
              <Tabs.Content value="browser">
                <BrowserSettings />
              </Tabs.Content>
              <Tabs.Content value="terminal">
                <TerminalSettings />
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
