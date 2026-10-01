import type { Artifact } from '@conch/protocol';
import {
  AlertDialog,
  ArtifactPanel,
  EmptyState,
  Skeleton,
  type ArtifactPanelVersion,
} from '@conch/nacre';
import { Shapes, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { downloadUrl } from './api';
import { ArtifactPreview } from './ArtifactPreview';
import styles from './Artifacts.module.css';
import {
  useArtifact,
  useArtifactVersion,
  useDeleteArtifact,
  useRefreshArtifact,
  useUpdateArtifact,
} from './queries';

const when = (at: number) => {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return new Date().toDateString() === date.toDateString()
    ? `Today, ${time}`
    : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
};

/** A chart's numbers laid out a line each, so its code reads and its changes are line by line. */
function readable(kind: Artifact['kind'], text: string | undefined) {
  if (kind !== 'chart' || text === undefined) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * One thing the assistant made, in its panel: beside a chat, or on its own as
 * a pinned app (`standalone`). Each version's text is fetched once and kept.
 */
export function ArtifactView({
  artifactId,
  version: wanted,
  onVersionChange,
  onClose,
  onDeleted,
  standalone,
}: {
  artifactId: string;
  version?: number;
  onVersionChange?: (n: number) => void;
  onClose?: () => void;
  onDeleted?: () => void;
  standalone?: boolean;
}) {
  const { data: artifact, isPending, isError } = useArtifact(artifactId);
  const update = useUpdateArtifact();
  const remove = useDeleteArtifact();
  const refresh = useRefreshArtifact();
  const [picked, setPicked] = useState<number>();
  const [allowed, setAllowed] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState(false);

  const kept = artifact?.versions ?? [];
  const latest = kept.at(-1)?.n;
  const choice = picked ?? wanted;
  const version = choice && kept.some((v) => v.n === choice) ? choice : latest;
  const index = kept.findIndex((v) => v.n === version);
  const previousN = index > 0 ? kept[index - 1]?.n : undefined;
  const current = useArtifactVersion(artifact?.id, version);
  const previous = useArtifactVersion(artifact?.id, previousN);

  if (isPending) return <Skeleton className={styles.loadingPanel} />;
  if (isError || !artifact || !version)
    return (
      <EmptyState
        size="sm"
        icon={<Shapes />}
        title="This isn’t here any more"
        description="It may have been deleted."
      />
    );

  const versions: ArtifactPanelVersion[] = kept.map((v) => ({
    n: v.n,
    when: when(v.at),
    note: v.note,
    refreshed: v.refreshed,
  }));
  const key = `${artifact.id}:${version}`;

  return (
    <>
      <ArtifactPanel
        key={artifact.id}
        className={styles.panel}
        title={artifact.title}
        kind={artifact.kind}
        versions={versions}
        version={version}
        onVersionChange={(n) => {
          setPicked(n);
          onVersionChange?.(n);
        }}
        preview={
          <ArtifactPreview
            artifact={artifact}
            version={version}
            content={current.data}
            allowScripts={allowed.has(key)}
            onAllowScripts={() => setAllowed((s) => new Set(s).add(key))}
          />
        }
        source={readable(artifact.kind, current.data)}
        previous={previousN ? readable(artifact.kind, previous.data) : undefined}
        downloadHref={downloadUrl(artifact.id, version)}
        pinned={Boolean(artifact.pinned)}
        onPinnedChange={(pinned) => update.mutate({ id: artifact.id, pinned })}
        onRefresh={artifact.refresh ? () => refresh.mutate(artifact.id) : undefined}
        refreshing={Boolean(artifact.refreshing) || refresh.isPending}
        onDelete={() => setConfirm(true)}
        onClose={onClose}
        standalone={standalone}
      />
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Delete “{artifact.title}”?</AlertDialog.Title>
            <AlertDialog.Description>
              All {kept.length === 1 ? 'of it' : `${kept.length} versions`} will be removed
              {artifact.pinned ? ', and it leaves your sidebar' : ''}. The chat it was made in
              stays.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              tone="danger"
              onClick={() =>
                remove.mutate(artifact.id, { onSuccess: () => (onDeleted ?? onClose)?.() })
              }
            >
              Delete
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
