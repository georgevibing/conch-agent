import { ArtifactCard } from '@conch/nacre';

import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { ArtifactGlance, GLANCEABLE, useNearScreen } from './ArtifactGlance';
import styles from './Artifacts.module.css';
import { useArtifacts } from './queries';

/**
 * Where something the assistant made sits in the chat (ADR 0034). The title
 * and pin are live; the version is the one this moment of the chat made.
 * A chart, a table, a diagram or a picture shows a small picture of itself
 * (ADR 0060), so the dock is for working on it, not for seeing it.
 */
export function ArtifactChatCard({
  conversationId,
  item,
}: {
  conversationId: string;
  item: Extract<TranscriptItem, { kind: 'artifact' }>;
}) {
  const { data } = useArtifacts();
  const artifact = data?.find((a) => a.id === item.artifactId);
  const open = useUi((s) => s.artifactOpen);
  const openArtifact = useUi((s) => s.openArtifact);
  const latest = artifact?.versions.at(-1)?.n;
  const active = open?.artifactId === item.artifactId && (open.version ?? latest) === item.version;
  const [ref, near] = useNearScreen<HTMLDivElement>();
  const gone = data !== undefined && !artifact;
  return (
    <div className={styles.chatCard} ref={ref}>
      <ArtifactCard
        title={artifact?.title ?? item.title}
        kind={item.artifactKind}
        version={item.version}
        action={item.action}
        note={item.note}
        pinned={Boolean(artifact?.pinned)}
        active={active}
        disabled={gone}
        preview={
          GLANCEABLE.has(item.artifactKind) && !gone ? (
            <ArtifactGlance
              artifactId={item.artifactId}
              kind={item.artifactKind}
              version={item.version}
              title={artifact?.title ?? item.title}
              near={near}
            />
          ) : undefined
        }
        onClick={() =>
          openArtifact(
            conversationId,
            item.artifactId,
            item.version === latest ? undefined : item.version,
          )
        }
      />
    </div>
  );
}
