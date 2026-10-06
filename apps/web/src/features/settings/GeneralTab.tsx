import { Button, PathPicker, Stack } from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { canPickHere, pickPath } from '../../lib/pick';
import { SaveStatus, Section } from './Section';
import { useAutosave } from './useAutosave';

/**
 * Settings → General: what belongs to Conch as a whole rather than to one
 * provider or feature — the folder every provider works in, and starting over.
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
      {/* One row: what it does, and the button beside it. */}
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
