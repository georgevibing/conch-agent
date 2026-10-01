import { ChartSpec, type Artifact } from '@conch/protocol';
import {
  ArtifactChart,
  ArtifactTable,
  Callout,
  SealedFrame,
  Skeleton,
  toast,
  useNacreTheme,
} from '@conch/nacre';
import { useEffect, useId, useMemo, useState } from 'react';

import { Markdown } from '../chat/Markdown';
import { frameUrl } from './api';
import styles from './Artifacts.module.css';

/** A picture as an image: inside an <img>, an SVG can't run code or fetch anything. */
const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function Picture({ svg, title }: { svg: string; title: string }) {
  return <img className={styles.picture} src={svgImage(svg)} alt={title} />;
}

/**
 * A Mermaid diagram, drawn here (the library loads only when one is shown) at
 * its strictest: no scripts, no HTML labels, no links. Shown as a picture.
 */
function Diagram({ code, title }: { code: string; title: string }) {
  const { resolvedMode } = useNacreTheme();
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [result, setResult] = useState<{ code: string; svg?: string; error?: string }>();
  useEffect(() => {
    let live = true;
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolvedMode === 'dark' ? 'dark' : 'neutral',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          fontFamily: 'system-ui, sans-serif',
        });
        const { svg } = await mermaid.render(id, code);
        if (live) setResult({ code, svg });
      })
      .catch((error: unknown) => {
        if (live)
          setResult({ code, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
  }, [code, id, resolvedMode]);
  if (!result || result.code !== code) return <Skeleton className={styles.loading} />;
  if (result.error || !result.svg)
    return (
      <Callout tone="warning" title="This diagram didn’t draw">
        Its text is in Code. Ask for it again and it can be fixed.
      </Callout>
    );
  return <Picture svg={result.svg} title={`${title} (diagram)`} />;
}

/**
 * A page asked to open a link. It never goes by itself: you see where to, and
 * it opens in a tab of its own that knows nothing about Conch.
 */
function askToOpen(url: string) {
  const host = new URL(url).host;
  toast(`Open ${host}?`, {
    description: url.length > 120 ? `${url.slice(0, 120)}…` : url,
    action: {
      label: 'Open',
      onClick: () => void window.open(url, '_blank', 'noopener,noreferrer'),
    },
  });
}

/** The thing itself, by kind. Pages run sealed; everything else is drawn by Conch. */
export function ArtifactPreview({
  artifact,
  version,
  content,
  allowScripts,
  onAllowScripts,
  fill,
}: {
  artifact: Artifact;
  version: number;
  content: string | undefined;
  allowScripts?: boolean;
  onAllowScripts?: () => void;
  fill?: boolean;
}) {
  const { resolvedMode } = useNacreTheme();
  const chart = useMemo(() => {
    if (artifact.kind !== 'chart' || content === undefined) return undefined;
    try {
      const parsed = ChartSpec.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [artifact.kind, content]);

  if (artifact.kind === 'html') {
    const shown = artifact.versions.find((v) => v.n === version);
    return (
      <SealedFrame
        src={frameUrl(artifact.id, version, resolvedMode === 'dark' ? 'dark' : 'light')}
        title={artifact.title}
        navigates={shown ? Boolean(shown.navigates) : true}
        scriptsAllowed={allowScripts}
        onAllowScripts={onAllowScripts}
        fill={fill}
        onOpenLink={askToOpen}
      />
    );
  }
  if (content === undefined) return <Skeleton className={styles.loading} />;
  switch (artifact.kind) {
    case 'markdown':
      return <Markdown text={content} sealed />;
    case 'svg':
      return <Picture svg={content} title={artifact.title} />;
    case 'mermaid':
      return <Diagram code={content} title={artifact.title} />;
    case 'table':
      return <ArtifactTable csv={content} label={`${artifact.title}, as a table`} />;
    case 'chart':
      return chart ? (
        <ArtifactChart chart={chart} />
      ) : (
        <Callout tone="warning" title="This chart didn’t draw">
          Its numbers are in Code.
        </Callout>
      );
  }
}
