import { ImportSourceId, type Profile } from '@conch/protocol';
import { Button, SettingsAdvanced, Stack, Switch, Text } from '@conch/nacre';
import { Brain } from 'lucide-react';

import { useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { ComeHomePage } from '../import/ComeHomePage';
import { ComeHomeSection } from '../import/ComeHomeSection';
import { PastChatsSection } from '../import/PastChatsSection';
import { MEMORY_ALL } from '../settings/paths';
import { SaveStatus, Section } from '../settings/Section';
import { useAdvanced } from '../settings/useAdvanced';
import {
  AboutYouPortrait,
  InYourOwnWords,
  WhatEveryChatStartsWith,
  useAboutYou,
  type AboutYouEditor,
} from './AboutYou';
import styles from './Memory.module.css';
import { MemoryView } from './MemoryView';
import { MorningNote } from './MorningNote';

/** `openSettings('memory', OWN_WORDS_FOCUS)`: your own words, under Advanced. */
export const OWN_WORDS_FOCUS = 'own-words';

/** The switches for how it learns, and the way to everything it remembers. */
function Learning({ autoMemory, tidyMemory }: { autoMemory: boolean; tidyMemory: boolean }) {
  const memories = useMemories();
  const update = useUpdateSettings();
  const openSettings = useUi((s) => s.openSettings);
  const all = memories.data ?? [];
  const waiting = all.filter((m) => m.pending).length;
  const kept = all.length - waiting;
  return (
    <Section
      title="Memory"
      description="Stored as plain files in ~/.conch/memory — yours to read, edit or delete."
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
          description="Merge repeats and update what’s changed while you sleep. A short note in the morning says what changed, each with Undo."
        />
        <div className={styles.door}>
          <Brain aria-hidden />
          <Stack gap={0.5} className={styles.doorText}>
            <Text size="sm" weight="medium">
              Everything it remembers
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
            Open memories
          </Button>
        </div>
      </Stack>
    </Section>
  );
}

function Page({
  profile,
  autoMemory,
  tidyMemory,
}: {
  profile: Profile;
  autoMemory: boolean;
  tidyMemory: boolean;
}) {
  const editor: AboutYouEditor = useAboutYou(profile);
  const [advanced, setAdvanced] = useAdvanced(OWN_WORDS_FOCUS);
  return (
    <Stack gap={8}>
      {/* What Conch learned and tidied since you last looked, each with Undo: here and nowhere else (ADR 0107). */}
      <MorningNote />
      <Section
        title="What Conch knows"
        description="Every chat starts knowing you, so you never have to repeat yourself. Press anything to correct it."
        status={<SaveStatus status={editor.status} />}
      >
        <AboutYouPortrait editor={editor} />
      </Section>
      <Learning autoMemory={autoMemory} tidyMemory={tidyMemory} />
      <ComeHomeSection />
      <PastChatsSection />
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <Section
          title="In your own words"
          description="Anything the portrait doesn’t hold, the way you’d say it. Every chat starts with it too."
        >
          <InYourOwnWords editor={editor} />
        </Section>
        <Section title="What every chat starts with">
          <WhatEveryChatStartsWith editor={editor} />
        </Section>
      </SettingsAdvanced>
    </Stack>
  );
}

/**
 * Settings → Memory, titled What Conch knows: About you first, as a portrait
 * of what you told it and what it learned; then how it learns, everything it
 * remembers, bringing your things from another assistant and your past chats;
 * and, under Advanced, your own words and what every chat starts with.
 */
export function MemoryTab({
  autoMemory,
  tidyMemory,
  item,
}: {
  autoMemory: boolean;
  tidyMemory: boolean;
  /** `everything`: what Conch remembers, a page inside Memory. */
  item?: string;
}) {
  const { data: app } = useAppState();
  // Bringing your things from another assistant: a place inside Memory.
  const from = item?.startsWith('from-') ? ImportSourceId.safeParse(item.slice(5)) : undefined;
  if (from?.success) return <ComeHomePage source={from.data} />;
  // Its way back is the trail above it (Memory › What Conch knows).
  if (item === MEMORY_ALL) return <MemoryView inSettings />;
  if (!app) return null;
  return <Page profile={app.profile} autoMemory={autoMemory} tidyMemory={tidyMemory} />;
}
