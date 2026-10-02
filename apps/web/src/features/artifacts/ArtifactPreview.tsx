import { ChartSpec, type Artifact, type ArtifactVersionRef } from '@conch/protocol';
import {
  ArtifactChart,
  ArtifactTable,
  Callout,
  LiveDataAsk,
  LiveDataBar,
  SealedFrame,
  Skeleton,
  toast,
  useNacreTheme,
} from '@conch/nacre';
import { useEffect, useId, useMemo, useState } from 'react';

import { Markdown } from '../chat/Markdown';
import { frameUrl } from './api';
import styles from './Artifacts.module.css';
import { useLiveData } from './live';

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

/**
 * A page, sealed (ADR 0034), with its live data (ADR 0046): the question for
 * a site it wants to read, when it last read, and the page itself, whose
 * requests are answered through the gateway.
 */
export function LivePage({
  artifact,
  version,
  src,
  navigates,
  allowScripts,
  onAllowScripts,
  fill,
}: {
  artifact: Artifact;
  version: ArtifactVersionRef;
  src: string;
  navigates: boolean;
  allowScripts?: boolean;
  onAllowScripts?: () => void;
  fill?: boolean;
}) {
  const live = useLiveData(artifact, version);
  return (
    <div className={styles.livePage} data-fill={fill || undefined}>
      {live.ask && (
        <LiveDataAsk
          title={artifact.title}
          host={live.ask.host}
          urls={live.askUrls}
          local={live.ask.local}
          changed={live.ask.changed}
          tainted={live.info?.tainted}
          onAllow={live.allow}
          onDecline={() => live.ask && live.decline(live.ask.host)}
          allowing={live.allowing}
        />
      )}
      {live.info?.problem && (
        <Callout tone="warning" title="This page’s live data can’t be read">
          {live.info.problem} Ask for it again and it can be fixed.
        </Callout>
      )}
      {live.allowed.length > 0 && (
        <LiveDataBar
          state={live.status.failed ? 'failed' : 'live'}
          updatedAt={live.status.updatedAt}
          problem={live.status.failed}
          everySeconds={live.everySeconds}
          onRefresh={live.update}
          refreshing={live.status.reading}
          sources={[...new Map(live.allowed.map((s) => [s.host, s])).values()].map((s) => ({
            host: s.host,
            local: s.local,
          }))}
          onStop={live.stop}
        />
      )}
      <SealedFrame
        src={live.reload ? `${src}&live=${live.reload}` : src}
        title={artifact.title}
        navigates={navigates}
        scriptsAllowed={allowScripts}
        onAllowScripts={onAllowScripts}
        fill={fill}
        onOpenLink={askToOpen}
        onData={live.onData}
        refresh={live.refresh}
      />
    </div>
  );
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
      <LivePage
        artifact={artifact}
        version={version}
        src={frameUrl(artifact.id, version, resolvedMode === 'dark' ? 'dark' : 'light')}
        navigates={shown ? Boolean(shown.navigates) : true}
        allowScripts={allowScripts}
        onAllowScripts={onAllowScripts}
        fill={fill}
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
