import {
  Button,
  Field,
  PathPicker,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  accents,
  useNacreTheme,
  type AccentName,
  type ColorMode,
} from '@conch/nacre';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { chooseOnComputer } from '../folders/FolderChooser';
import { MutedSuggestions } from './MutedSuggestions';
import { SaveStatus, Section } from './Section';
import styles from './Settings.module.css';
import { useAutosave } from './useAutosave';

const accentSwatches = Object.keys(accents) as AccentName[];

/** How Conch looks on this device: light or dark, its colour, the shimmer, motion. */
function Appearance() {
  const theme = useNacreTheme();
  return (
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
          <Field.Label>Shimmer</Field.Label>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[theme.lustre]}
            onValueChange={([v]) => theme.setTheme({ lustre: v ?? 1 })}
          />
          <Field.Description>The pearly sheen under your pointer.</Field.Description>
        </Field>
        <Switch
          checked={theme.motion === 'reduced'}
          onCheckedChange={(on) => theme.setTheme({ motion: on ? 'reduced' : 'system' })}
          label="Reduce motion"
        />
      </Stack>
    </Section>
  );
}

/**
 * Settings → General: what belongs to Conch as a whole rather than to one
 * provider or feature — how it looks, the folder every provider works in, how
 * new chats are named and what they offer, the tips on a new chat, and
 * starting over. The model, thinking and mode new chats start with are the
 * composer's own (Make this my default), so they're not here.
 */
export function GeneralTab({
  workspace,
  workspacePref,
}: {
  workspace: string;
  workspacePref?: string;
}) {
  const { data: app } = useAppState();
  const update = useUpdateSettings();
  const [folder, setFolder] = useState(workspacePref ?? '');
  const folderStatus = useAutosave(
    folder,
    (next) => update.mutateAsync({ preferences: { workspace: next.trim() } }),
    900,
  );
  const assistant = app?.persona.name ?? 'Conch';
  const prefs = app?.preferences;
  const tipsAway = app?.preferences.tipsPutAway.length ?? 0;

  return (
    <Stack gap={8}>
      <Appearance />
      <Section
        title="Working folder"
        description={`Where ${assistant} reads and writes files.`}
        status={<SaveStatus status={folderStatus} />}
      >
        <PathPicker
          kind="folder"
          label="Working folder"
          value={folder || workspace}
          suggestions={[
            {
              path: workspace,
              title: 'Conch’s own workspace',
              detail: 'A folder just for your assistant',
            },
          ]}
          onChange={(path) => setFolder(path === workspace ? '' : path)}
          // The desktop app's Open dialog, or Conch's folder browser from any other device.
          onChoose={() => chooseOnComputer({ purpose: 'workspace', current: folder || workspace })}
          canType={false}
        />
      </Section>
      <Section title="Chats">
        <Stack gap={5}>
          <Switch
            checked={prefs?.autoTitle ?? true}
            onCheckedChange={(autoTitle) => update.mutate({ preferences: { autoTitle } })}
            label="Name new chats automatically"
            description="From its first message, for a fraction of a cent."
          />
          <MutedSuggestions
            assistant={assistant}
            muted={prefs?.mutedSuggestions ?? []}
            onChange={(mutedSuggestions) => update.mutate({ preferences: { mutedSuggestions } })}
          />
        </Stack>
      </Section>
      {/* One row each: what it does, and the button beside it. */}
      <Section
        title="Tips on a new chat"
        description={
          tipsAway
            ? `${tipsAway === 1 ? 'One tip is' : `${tipsAway} tips are`} put away. The rest show one at a time, under the box.`
            : 'What Conch can do for you next, one at a time, under the box. Each has a × to put it away.'
        }
        status={
          tipsAway ? (
            <Button
              variant="surface"
              size="sm"
              onClick={() => void update.mutateAsync({ preferences: { tipsPutAway: [] } })}
            >
              Show tips again
            </Button>
          ) : undefined
        }
      />
      <Section
        title="Start over"
        description="See the welcome again. Your conversations and memories stay."
        status={
          <Button
            variant="surface"
            size="sm"
            onClick={() => void update.mutateAsync({ onboarded: false })}
          >
            Replay welcome
          </Button>
        }
      />
    </Stack>
  );
}
