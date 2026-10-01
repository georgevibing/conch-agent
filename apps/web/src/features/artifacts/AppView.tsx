import { Button, Text } from '@conch/nacre';
import { MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useConversations } from '../../api/queries';
import styles from './Artifacts.module.css';
import { ArtifactView } from './ArtifactView';
import { useArtifact } from './queries';

/**
 * A pinned app on a page of its own (ADR 0034): it opens instantly from the
 * sidebar with the version you last had, and can fetch fresh data on request.
 */
export function AppView({ artifactId }: { artifactId: string }) {
  const navigate = useNavigate();
  const { data: artifact } = useArtifact(artifactId);
  const chat = useConversations().data?.find((c) => c.id === artifact?.conversationId);
  const refreshing = artifact?.refreshing;
  return (
    <div className={styles.app}>
      <ArtifactView artifactId={artifactId} standalone onDeleted={() => void navigate('/')} />
      {(chat || refreshing) && (
        <div className={styles.appFoot}>
          {chat && (
            <Text size="xs" tone="muted">
              Made in “{chat.title}”
            </Text>
          )}
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<MessageSquare />}
            onClick={() => void navigate(`/c/${refreshing ?? chat?.id}`)}
          >
            {refreshing ? 'Watch it refresh' : 'Open the chat'}
          </Button>
        </div>
      )}
    </div>
  );
}
