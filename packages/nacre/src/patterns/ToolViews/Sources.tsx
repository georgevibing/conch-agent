import { ArrowUpRight, Globe } from 'lucide-react';

import { outside, ShowAll, useShowAll, ViewFrame, webLink, type ViewFrameProps } from './shared';
import styles from './ToolViews.module.css';

export interface FoundSource {
  title: string;
  url: string;
  snippet?: string;
}
export interface SourcesProps extends Omit<ViewFrameProps, 'label' | 'heading'> {
  sources: FoundSource[];
}

/** Public source references, rendered as text with deliberate links out. */
export function Sources({ sources, ...props }: SourcesProps) {
  const { folded, showAll, limit } = useShowAll(sources.length);
  const shown = folded ? sources.slice(0, limit) : sources;
  return (
    <ViewFrame label={`Sources, ${sources.length} results`} {...props}>
      {sources.length === 0 ? (
        <p className={styles.empty}>No sources found.</p>
      ) : (
        <ul className={styles.rows}>
          {shown.map((source, index) => {
            const candidate = webLink(source.url);
            let url: string | undefined;
            try {
              if (candidate) {
                const parsed = new URL(candidate);
                if (!parsed.username && !parsed.password) url = parsed.href;
              }
            } catch {
              /* Malformed outside link. */
            }
            const inner = (
              <>
                <span className={styles.fileIcon}>
                  <Globe aria-hidden />
                </span>
                <span className={styles.fileText}>
                  <span className={styles.sourceTitle}>{source.title}</span>
                  <span className={styles.meta}>
                    {url ? new URL(url).hostname : 'Unavailable link'}
                  </span>
                  {source.snippet && <span className={styles.meta}>{source.snippet}</span>}
                </span>
                {url && <ArrowUpRight aria-hidden className={styles.open} />}
              </>
            );
            return (
              <li key={`${source.url}-${index}`}>
                {url ? (
                  <a className={styles.fileRow} href={url} {...outside} data-lustre="">
                    {inner}
                  </a>
                ) : (
                  <span className={styles.fileRow}>{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {folded && <ShowAll onClick={showAll}>Show all {sources.length} sources</ShowAll>}
    </ViewFrame>
  );
}
