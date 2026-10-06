import { Button, PathPicker, SettingsAdvanced, Stack } from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { canPickHere, pickPath } from '../../lib/pick';
import { SaveStatus, Section } from './Section';
import { useAdvanced } from './useAdvanced';
import { useAutosave } from './useAutosave';

/**
 * Settings → General: what belongs to Conch as a whole rather than to one
 * provider or feature — the folder every provider works in, and, under
 * Advanced, starting over.
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
  const [advanced, setAdvanced] = useAdvanced();

  return (
    <Stack gap={8}>
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
          onChoose={canPickHere() ? () => pickPath('workspace') : undefined}
          placeholder="~/Projects"
        />
      </Section>
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <Section title="Start over" description="Your conversations and memories stay.">
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
      </SettingsAdvanced>
    </Stack>
  );
}
