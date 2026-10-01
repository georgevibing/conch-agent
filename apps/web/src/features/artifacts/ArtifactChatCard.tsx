import { ArtifactCard } from '@conch/nacre';

import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import styles from './Artifacts.module.css';
import { useArtifacts } from './queries';

/**
 * Where something the assistant made sits in the chat (ADR 0034). The title
 * and pin are live; the version is the one this moment of the chat made.
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
  return (
    <div className={styles.chatCard}>
      <ArtifactCard
        title={artifact?.title ?? item.title}
        kind={item.artifactKind}
        version={item.version}
        action={item.action}
        note={item.note}
        pinned={Boolean(artifact?.pinned)}
        active={active}
        disabled={data !== undefined && !artifact}
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
