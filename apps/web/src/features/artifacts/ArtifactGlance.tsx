import { ChartSpec, type ArtifactKind } from '@conch/protocol';
import { ArtifactChart, ArtifactTable, Skeleton, Text } from '@conch/nacre';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Diagram, Picture } from './ArtifactPreview';
import styles from './Artifacts.module.css';
import { useArtifactVersion } from './queries';

/** The kinds a chat card shows a small picture of (ADR 0055): the rest open to be seen. */
export const GLANCEABLE = new Set<ArtifactKind>(['chart', 'table', 'mermaid', 'svg']);

/**
 * Whether the card is near the screen yet: a long chat doesn't fetch, or draw
 * a diagram, for cards nobody has scrolled to. Once seen, it stays drawn.
 */
export function useNearScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

/**
 * A small picture of what was made, for its card in the chat: a chart, the
 * first rows of a table, a diagram or a picture. Only to look at; the card
 * opens it to work on. It holds its place while it loads, so nothing moves.
 */
export function ArtifactGlance({
  artifactId,
  kind,
  version,
  title,
  near,
}: {
  artifactId: string;
  kind: ArtifactKind;
  version: number;
  title: string;
  near: boolean;
}): ReactNode {
  const glanceable = GLANCEABLE.has(kind);
  const { data: content } = useArtifactVersion(
    near && glanceable ? artifactId : undefined,
    version,
  );
  const chart = useMemo(() => {
    if (kind !== 'chart' || content === undefined) return undefined;
    try {
      const parsed = ChartSpec.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }, [kind, content]);
  if (!glanceable) return null;
  if (content === undefined) return <Skeleton className={styles.glanceWait} />;
  switch (kind) {
    case 'chart':
      return chart ? (
        <ArtifactChart chart={chart} height={116} compact />
      ) : (
        <span className={styles.glanceNote}>
          <Text size="sm" tone="muted">
            Open it to see it.
          </Text>
        </span>
      );
    case 'table':
      return <ArtifactTable csv={content} label={title} maxRows={5} compact />;
    case 'mermaid':
      return <Diagram code={content} title={title} quiet />;
    case 'svg':
      return <Picture svg={content} title={title} />;
    default:
      return null;
  }
}
