import type { Persona, Profile } from '@conch/protocol';
import {
  Button,
  Dialog,
  Field,
  Heading,
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
  Cable,
  Brain,
  Check,
  ChevronLeft,
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
import { useLocation } from 'react-router';

import { useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { SecurityTab } from '../auth/SecurityTab';
import { updatesWaiting, useUpdates } from '../updates/queries';
import { BrowserSettings } from '../browser/BrowserSettings';
import { HealthTab } from '../health/HealthTab';
import { OtherAppsTab } from '../otherapps/OtherAppsTab';
import { ComeHomeSection } from '../import/ComeHomeSection';
import { MemoryView } from '../memory/MemoryView';
import { NotificationsTab } from '../notifications/NotificationsTab';
import { VoiceTab } from '../voice/VoiceTab';
import { TerminalSettings } from '../terminal/TerminalSettings';
import { toneOptions } from '../onboarding/tones';
import { ProvidersTab } from '../providers/ProvidersTab';
import { UsageTab } from '../usage/UsageTab';
import styles from './Settings.module.css';
import { CommandsTab } from './CommandsTab';
import { MEMORY_ALL, settingsAt, type SettingsTab } from './paths';
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

function MemoryTab({
  autoMemory,
  tidyMemory,
  item,
}: {
  autoMemory: boolean;
  tidyMemory: boolean;
  /** `everything`: what Conch remembers, a page inside Memory. */
  item?: string;
}) {
  const memories = useMemories();
  const update = useUpdateSettings();
  const openSettings = useUi((s) => s.openSettings);
  if (item === MEMORY_ALL)
    return (
      <Stack gap={5}>
        <div>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<ChevronLeft />}
            onClick={() => openSettings('memory')}
          >
            Memory
          </Button>
        </div>
        <MemoryView inSettings />
      </Stack>
    );
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
            <Button size="sm" variant="surface" onClick={() => openSettings('memory', MEMORY_ALL)}>
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

interface Place {
  value: SettingsTab;
  label: string;
  icon: ReactNode;
}

/**
 * Sixteen places, read as five: the everyday basics, then who your assistant
 * is, where its intelligence comes from, what it can use, and keeping it safe.
 */
const groups: { label: string; hidden?: boolean; places: Place[] }[] = [
  {
    label: 'Conch',
    hidden: true,
    places: [
      { value: 'general', label: 'General', icon: <Settings2 /> },
      { value: 'appearance', label: 'Appearance', icon: <Palette /> },
      { value: 'notifications', label: 'Notifications', icon: <Bell /> },
    ],
  },
  {
    label: 'Your assistant',
    places: [
      { value: 'personality', label: 'Personality', icon: <Sparkles /> },
      { value: 'about', label: 'About you', icon: <User /> },
      { value: 'memory', label: 'Memory', icon: <Brain /> },
      { value: 'voice', label: 'Voice', icon: <Mic /> },
    ],
  },
  {
    label: 'Intelligence',
    places: [
      { value: 'models', label: 'Models', icon: <Gauge /> },
      { value: 'providers', label: 'Providers', icon: <Cpu /> },
      { value: 'commands', label: 'Commands', icon: <SquareSlash /> },
      { value: 'usage', label: 'Usage', icon: <BatteryMedium /> },
    ],
  },
  {
    label: 'Tools',
    places: [
      { value: 'browser', label: 'Browser', icon: <Globe /> },
      { value: 'terminal', label: 'Terminal', icon: <SquareTerminal /> },
      { value: 'other-apps', label: 'Other apps', icon: <Cable /> },
    ],
  },
  {
    label: 'Safe and sound',
    places: [
      { value: 'security', label: 'Security', icon: <ShieldCheck /> },
      { value: 'health', label: 'Health', icon: <HeartPulse /> },
    ],
  },
];

/**
 * Settings is a page of its own: it takes the whole window, its places where
 * the app's sidebar was, with Back (and Escape) to return. On a phone it's a
 * list, then the place you chose, with ‹ Settings to go back to the list.
 *
 * Each place has its address (`/settings/providers`, and a provider's own page
 * under it), so a reload, a link or the browser's Back lands where you were.
 * The page it opened over stays behind it, as it was.
 */
export function Settings() {
  const address = settingsAt(useLocation().pathname);
  const tab = address ? (address.tab ?? 'general') : null;
  const browsing = !address?.tab;
  const restarting = useUi((s) => Boolean(s.restarting));
  const open = useUi((s) => s.openSettings);
  const close = useUi((s) => s.closeSettings);
  const { data: app } = useAppState();
  const narrow = useMediaQuery('(max-width: 720px)');
  const updates = updatesWaiting(useUpdates().data);
  const view = narrow ? (browsing ? 'list' : 'place') : undefined;

  return (
    <Dialog.Root open={tab !== null && !restarting} onOpenChange={(o) => !o && close()}>
      <Dialog.Content
        size="full"
        hideClose
        className={styles.page}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Straight onto the place it opened at, so the arrow keys move from there.
          const here = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            '[role="tab"][data-state="active"]',
          );
          if (here && !here.closest('[hidden]')) {
            event.preventDefault();
            here.focus();
          }
        }}
      >
        {app && tab && (
          <Tabs
            value={tab}
            onValueChange={(v) => open(v as SettingsTab)}
            orientation="vertical"
            // On a phone, moving through the list mustn't leave it.
            activationMode={narrow ? 'manual' : 'automatic'}
            variant="pill"
            className={styles.tabs}
            data-view={view}
          >
            {/* On a phone one half shows at a time; the other stays, hidden, so the
                tabs and their panel still name each other. */}
            <div className={styles.nav} hidden={view === 'place'}>
              <div className={styles.bar}>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm" leadingIcon={<ChevronLeft />}>
                    Back
                  </Button>
                </Dialog.Close>
              </div>
              <Dialog.Title asChild>
                <Heading level={2} size="2xl" weight="regular" display className={styles.title}>
                  Settings
                </Heading>
              </Dialog.Title>
              <div className={styles.groups}>
                {groups.map((group) => (
                  <div key={group.label} className={styles.group}>
                    {!group.hidden && (
                      <Text
                        as="span"
                        size="xs"
                        weight="medium"
                        tone="subtle"
                        id={`settings-${group.label.toLowerCase().replaceAll(' ', '-')}`}
                        className={styles.groupLabel}
                      >
                        {group.label}
                      </Text>
                    )}
                    <Tabs.List
                      className={styles.list}
                      {...(group.hidden
                        ? { 'aria-label': group.label }
                        : {
                            'aria-labelledby': `settings-${group.label.toLowerCase().replaceAll(' ', '-')}`,
                          })}
                    >
                      {group.places.map((t) => (
                        <Tabs.Trigger
                          key={t.value}
                          value={t.value}
                          icon={t.icon}
                          dot={t.value === 'health' && updates ? 'Update available' : undefined}
                          // The place already chosen still opens it: from the list on a
                          // phone, or from a page inside it (a provider's) to the place.
                          onClick={() => {
                            if (t.value === tab && (browsing || address?.item)) open(t.value);
                          }}
                        >
                          {t.label}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.panel} hidden={view === 'list'}>
              {narrow && (
                <div className={styles.bar}>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<ChevronLeft />}
                    onClick={() => open()}
                  >
                    Settings
                  </Button>
                </div>
              )}
              <div className={styles.column}>
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
                    item={tab === 'memory' ? address?.item : undefined}
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
                <Tabs.Content value="other-apps">
                  <OtherAppsTab />
                </Tabs.Content>
                <Tabs.Content value="appearance">
                  <AppearanceTab />
                </Tabs.Content>
              </div>
            </div>
          </Tabs>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
