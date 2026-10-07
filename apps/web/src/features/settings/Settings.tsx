import { ImportSourceId } from '@conch/protocol';
import {
  Button,
  Dialog,
  Field,
  Heading,
  IconButton,
  SegmentedControl,
  Sheet,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
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
  Menu,
  Mic,
  MonitorSmartphone,
  Globe,
  HeartPulse,
  Laptop,
  Monitor,
  SquareTerminal,
  Moon,
  Palette,
  Settings2,
  ShieldCheck,
  SquareSlash,
  Sun,
  User,
  UsersRound,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import { useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { Trail } from '../../app/trail';
import { useUi } from '../../app/ui';
import { NARROW } from '../../app/widths';
import { DevicesTab } from '../auth/DevicesTab';
import { SecurityTab } from '../auth/SecurityTab';
import { updatesWaiting, useUpdates } from '../updates/queries';
import { BrowserSettings } from '../browser/BrowserSettings';
import { HealthTab } from '../health/HealthTab';
import { OtherAppsTab } from '../otherapps/OtherAppsTab';
import { ComeHomeSection } from '../import/ComeHomeSection';
import { ComputerTab } from '../computer/ComputerTab';
import { ComeHomePage } from '../import/ComeHomePage';
import { MemoryView } from '../memory/MemoryView';
import { AboutYou } from './AboutYou';
import { AgentsTab } from '../agents/AgentsTab';
import { NotificationsTab } from '../notifications/NotificationsTab';
import { VoiceTab } from '../voice/VoiceTab';
import { TerminalSettings } from '../terminal/TerminalSettings';
import { ProvidersTab } from '../providers/ProvidersTab';
import { UsageTab } from '../usage/UsageTab';
import styles from './Settings.module.css';
import { CommandsTab } from './CommandsTab';
import {
  MEMORY_ALL,
  SETTINGS_TABS,
  behindName,
  behindOf,
  settingsAt,
  type SettingsTab,
} from './paths';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { Section } from './Section';
import { usePageInside } from './trail';

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
  // Bringing your things from another assistant: a place inside Memory.
  const from = item?.startsWith('from-') ? ImportSourceId.safeParse(item.slice(5)) : undefined;
  if (from?.success) return <ComeHomePage source={from.data} />;
  // Its way back is the trail above it (Memory › What Conch knows).
  if (item === MEMORY_ALL) return <MemoryView inSettings />;
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
            label="Learn from your chats"
            description="I’ll quietly keep what lasts — how you like things, what changed. I only ask when something looks unsafe. Off, I remember only what you ask me to."
          />
          <Switch
            checked={tidyMemory}
            onCheckedChange={(checked) =>
              void update.mutateAsync({ preferences: { tidyMemory: checked } })
            }
            label="Tidy up every night"
            description="Merge repeats and update what’s changed while you sleep, quietly. The last tidy-up can always be undone."
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
                {waiting > 0 && ` · ${waiting} to look at`}
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
          <Field>
            <Field.Label>Lustre</Field.Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[theme.lustre]}
              onValueChange={([v]) => theme.setTheme({ lustre: v ?? 1 })}
            />
            <Field.Description>The pearl shimmer under your pointer.</Field.Description>
          </Field>
          <Switch
            checked={theme.motion === 'reduced'}
            onCheckedChange={(on) => theme.setTheme({ motion: on ? 'reduced' : 'system' })}
            label="Reduce motion"
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
 * Eighteen places, read as five: the everyday basics, then who your assistant
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
      { value: 'agents', label: 'Agents', icon: <UsersRound /> },
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
      { value: 'devices', label: 'Devices', icon: <MonitorSmartphone /> },
      { value: 'health', label: 'Health', icon: <HeartPulse /> },
      { value: 'computer', label: 'This computer', icon: <Laptop /> },
    ],
  },
];

/** What each place is called, as its tab and its step in the trail say it. */
const placeNames = Object.fromEntries(
  groups.flatMap((group) => group.places.map((place) => [place.value, place.label])),
) as Record<SettingsTab, string>;

/**
 * Settings is a page of its own: it takes the whole window, its places where
 * the app's sidebar was, with a way back to where it opened over (and Escape).
 * On a phone its places float in from the side, like the chats do: the menu
 * button opens them, and Settings itself (`/settings`) opens with them out.
 *
 * Where you are reads as one trail, never a stack of back buttons: a page
 * inside a place (a provider's, what Conch remembers) says Memory › What
 * Conch knows above it, and the place is a step back to it. On a phone the
 * trail is the header, beside the menu.
 *
 * Each place has its address (`/settings/providers`, and a provider's own page
 * under it), so a reload, a link or the browser's Back lands where you were.
 * The page it opened over stays behind it, as it was.
 */
export function Settings() {
  const location = useLocation();
  const address = settingsAt(location.pathname);
  const tab = address ? (address.tab ?? 'general') : null;
  const home = address !== null && !address.tab;
  const restarting = useUi((s) => Boolean(s.restarting));
  const open = useUi((s) => s.openSettings);
  const close = useUi((s) => s.closeSettings);
  const { data: app } = useAppState();
  // The same width the window folds its own sidebar away at (app/widths.ts),
  // so the places beside the page and the chats beside it go together.
  const narrow = useMediaQuery(NARROW);
  const updates = updatesWaiting(useUpdates().data);
  const inside = usePageInside(tab, address?.item);
  const leave = behindName(behindOf(location));
  const [menu, setMenu] = useState(false);
  const panelTitle = useId();

  // On a phone, Settings itself (`/settings`) *is* its places, out over the page
  // — as the chats' sidebar is. Putting them away is going to the place behind
  // them, so the address always says where you are.
  const menuOut = narrow && (home || menu);
  // Putting the places away by choosing one is arriving at it: the focus goes
  // where you are, not back to the menu button (`chose`).
  const chose = useRef(false);
  const showMenu = (out: boolean) => {
    if (out) {
      chose.current = false;
      setMenu(true);
    } else if (home) {
      chose.current = true;
      open(tab ?? 'general', undefined, { replace: true });
    } else setMenu(false);
  };

  // The row above the page: the trail, in a phone's header or beside the page.
  const top = useRef<HTMLElement | null>(null);
  const setTop = (el: HTMLElement | null) => {
    top.current = el;
  };
  const columnRef = useRef<HTMLDivElement>(null);
  const landed = useRef(false);

  /**
   * Where you are takes the focus (NACRE.md § Where you are): the page's name
   * in the trail, so the way back is one Shift+Tab away, or — stepping back
   * out of a page, or arriving at a place from the menu — the place's heading.
   */
  const focusHere = () => {
    const here =
      top.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
      columnRef.current?.querySelector<HTMLElement>('h3');
    if (!here) return false;
    if (!here.hasAttribute('tabindex')) here.setAttribute('tabindex', '-1');
    here.focus({ preventScroll: true });
    return true;
  };

  // Arriving anywhere in Settings by a press leaves the focus nowhere — what
  // was pressed is gone with the page it was on. It goes to where you are now;
  // focus something else took (a field, a page that places it itself) stays.
  useEffect(() => {
    // Arriving at Settings itself, its place takes the focus (`onOpenAutoFocus`);
    // while the places are out on a phone, they do.
    if (!tab) {
      landed.current = false;
      return;
    }
    const arriving = !landed.current;
    landed.current = true;
    if (arriving || menuOut) return;
    const frame = requestAnimationFrame(() => {
      const at = document.activeElement;
      if (at && at !== document.body && at.getAttribute('role') !== 'dialog') return;
      focusHere();
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, inside, menuOut, location.key]);

  const trail = tab && (
    <Trail
      className={styles.trail}
      currentId={panelTitle}
      crumbs={
        inside
          ? [{ label: placeNames[tab], onSelect: () => open(tab) }, { label: inside }]
          : [{ label: placeNames[tab] }]
      }
    />
  );

  // The places, beside the page or floating over it on a phone.
  const places = (
    <div className={styles.nav}>
      <div className={styles.bar}>
        <Button variant="ghost" size="sm" leadingIcon={<ChevronLeft />} onClick={() => close()}>
          {leave}
        </Button>
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
                  // The place already chosen still opens it: from Settings itself,
                  // or from a page inside it (a provider's) to the place.
                  onClick={() => {
                    if (t.value === tab && (home || address?.item)) open(t.value);
                    if (narrow) chose.current = true;
                    setMenu(false);
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
  );

  const place = (value: SettingsTab): ReactNode => {
    if (!app) return null;
    switch (value) {
      case 'general':
        return <GeneralTab workspace={app.workspace} workspacePref={app.preferences.workspace} />;
      case 'agents':
        return <AgentsTab item={tab === 'agents' ? address?.item : undefined} />;
      case 'about':
        return <AboutYou initial={app.profile} />;
      case 'memory':
        return (
          <MemoryTab
            autoMemory={app.preferences.autoMemory}
            tidyMemory={app.preferences.tidyMemory}
            item={tab === 'memory' ? address?.item : undefined}
          />
        );
      case 'models':
        return <ModelsTab />;
      case 'commands':
        return <CommandsTab />;
      case 'usage':
        return <UsageTab />;
      case 'health':
        return <HealthTab />;
      case 'security':
        return <SecurityTab />;
      case 'devices':
        return <DevicesTab />;
      case 'notifications':
        return <NotificationsTab />;
      case 'voice':
        return <VoiceTab />;
      case 'providers':
        return <ProvidersTab />;
      case 'browser':
        return <BrowserSettings />;
      case 'terminal':
        return <TerminalSettings />;
      case 'other-apps':
        return <OtherAppsTab />;
      case 'appearance':
        return <AppearanceTab />;
      case 'computer':
        return <ComputerTab />;
    }
  };

  return (
    <Dialog.Root open={tab !== null && !restarting} onOpenChange={(o) => !o && close()}>
      <Dialog.Content
        size="full"
        hideClose
        className={styles.page}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // On a phone its places are out: they take the focus themselves.
          if (menuOut) return event.preventDefault();
          // Straight onto the place it opened at, so the arrow keys move from there.
          // Its places are beside it; on a phone they're away, and where you
          // are is the trail in its header.
          const content = event.currentTarget as HTMLElement | null;
          const here =
            content?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
            content?.querySelector<HTMLElement>('[aria-current="page"]');
          if (here) {
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
            // On a phone, moving through the menu mustn't leave it.
            activationMode={narrow ? 'manual' : 'automatic'}
            variant="pill"
            className={styles.tabs}
          >
            {narrow ? (
              <Sheet.Root open={menuOut} onOpenChange={showMenu}>
                <Sheet.Content
                  side="left"
                  size="sm"
                  hideClose
                  aria-describedby={undefined}
                  className={styles.sheet}
                  onOpenAutoFocus={(event) => {
                    const here = (
                      event.currentTarget as HTMLElement | null
                    )?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
                    if (here) {
                      event.preventDefault();
                      here.focus();
                    }
                  }}
                  // Put away by choosing a place, the focus goes to that place
                  // (the menu button it came from is no longer where you are).
                  onCloseAutoFocus={(event) => {
                    if (!chose.current) return;
                    chose.current = false;
                    if (focusHere()) event.preventDefault();
                  }}
                >
                  {places}
                </Sheet.Content>
              </Sheet.Root>
            ) : (
              places
            )}
            <div className={styles.panel}>
              {narrow ? (
                <header ref={setTop} className={styles.header}>
                  <IconButton label="Open settings menu" onClick={() => showMenu(true)}>
                    <Menu />
                  </IconButton>
                  {/* The menu has Settings' visible name; the page is named for screen readers. */}
                  <Dialog.Title className="nc-visually-hidden">Settings</Dialog.Title>
                  {trail}
                </header>
              ) : (
                <div ref={setTop} className={styles.crumbs}>
                  {inside && trail}
                </div>
              )}
              <div ref={columnRef} className={styles.column}>
                {SETTINGS_TABS.map((value) => (
                  <Tabs.Content
                    key={value}
                    value={value}
                    // On a phone its tab is in the menu, gone while the menu is
                    // away: the header names the place instead.
                    {...(narrow && { 'aria-labelledby': panelTitle })}
                  >
                    {place(value)}
                  </Tabs.Content>
                ))}
              </div>
            </div>
          </Tabs>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
