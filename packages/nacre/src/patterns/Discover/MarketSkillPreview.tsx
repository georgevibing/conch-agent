import { ArrowUpRight, Ban, FileText, Pin, Scale, ShieldAlert } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Checkbox } from '../../components/Checkbox';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../utils/cx';
import { Diff } from '../Diff/Diff';
import { SkillIcon } from '../Skills/SkillIcon';
import { SkillPermissionList } from '../Skills/SkillPermissionList';
import { SkillReview } from '../Skills/SkillReview';
import styles from './Discover.module.css';
import { marketTrustAbout, MarketTrustBadge } from './MarketTrustBadge';
import {
  fromWords,
  hostWords,
  pinWords,
  roughly,
  type MarketListingView,
  type MarketPreviewView,
} from './types';

/** Only an https address is ever opened from a skill's words. */
const isWebLink = (url: string | undefined): url is string =>
  Boolean(url && /^https:\/\//.test(url));

export interface MarketSkillPreviewProps extends Omit<
  ComponentProps<'section'>,
  'children' | 'title'
> {
  /** What the card said, shown at once while the skill is read. */
  listing: MarketListingView;
  /** The skill downloaded and read; absent while Conch reads it. */
  preview?: MarketPreviewView;
  /** Reading it failed, in one sentence. */
  error?: string;
  onRetry?: () => void;
  /** How it's used once added. */
  mode?: 'auto' | 'manual';
  onModeChange?: (mode: 'auto' | 'manual') => void;
  /** **Add skill** (or **Update** for an update). */
  onAdd?: () => void;
  adding?: boolean;
  /** Words for the button: “Add skill”, “Add and carry on”, “Update”. */
  addLabel?: string;
  /** Shown instead of the button once it's added: **Open it**, **Try it**. */
  done?: ReactNode;
  /** The heading's level, to fit where it is. */
  headingLevel?: 1 | 2;
}

/**
 * One skill from Discover, read before it's added (ADR 0074): what it does,
 * what it will be able to do in plain words, what Conch found reading every
 * file, who published it and where, the exact version, and its licence.
 * One button adds it. A worrying one needs a tick that says you read what
 * was found; one its licence or its registry rules out has no button at all.
 * For an update, what's different comes first, file by file, and a wider
 * list of what it may do is said before anything else.
 */
export function MarketSkillPreview({
  listing,
  preview,
  error,
  onRetry,
  mode = 'auto',
  onModeChange,
  onAdd,
  adding,
  addLabel,
  done,
  headingLevel = 1,
  className,
  ...props
}: MarketSkillPreviewProps) {
  const titleId = useId();
  const [readIt, setReadIt] = useState(false);
  const shown = preview?.listing ?? listing;
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const Sub = headingLevel === 1 ? 'h2' : 'h3';
  const danger = preview?.review.verdict === 'danger';
  const update = Boolean(preview?.changes);
  const used = shown.installs ?? 0;

  return (
    <section aria-labelledby={titleId} className={cx(styles.preview, className)} {...props}>
      <header className={styles.previewHead}>
        <SkillIcon name={shown.name} title={shown.title} size="lg" />
        <div className={styles.previewTitle}>
          <Title id={titleId} className={styles.previewName}>
            {shown.title}
          </Title>
          <p className={styles.previewFrom}>
            <MarketTrustBadge trust={shown.trust} size="md" />
            <span>
              From {shown.sourceLabel}
              {fromWords(shown.sourceLabel, shown.publisher.name) !== shown.sourceLabel && (
                <>
                  , by{' '}
                  {isWebLink(shown.publisher.url) ? (
                    <a href={shown.publisher.url} target="_blank" rel="noreferrer noopener">
                      {shown.publisher.name}
                    </a>
                  ) : (
                    shown.publisher.name
                  )}
                </>
              )}
              {used > 0 && ` · ${roughly(used)} people use it`}
            </span>
          </p>
        </div>
      </header>

      <p className={styles.previewDescription}>
        {shown.description || 'It doesn’t say what it does.'}
      </p>
      <p className={styles.trustNote}>{shown.trustNote ?? marketTrustAbout(shown.trust)}</p>

      {error ? (
        <Callout
          tone="warning"
          title="Conch couldn’t read it just now"
          action={
            onRetry && (
              <Button size="sm" variant="surface" onClick={onRetry}>
                Try again
              </Button>
            )
          }
        >
          {error}
        </Callout>
      ) : !preview ? (
        <div className={styles.reading} role="status">
          <p>Reading every file in it before anything is added…</p>
          <Skeleton lines={4} />
        </div>
      ) : (
        <>
          {preview.changes && (
            <section aria-labelledby={`${titleId}-changes`} className={styles.block}>
              <Sub id={`${titleId}-changes`} className={styles.blockTitle}>
                What’s different
              </Sub>
              {preview.changes.wider && (
                <Callout
                  tone="warning"
                  icon={<ShieldAlert />}
                  title="It asks to do more than before"
                >
                  <p>Before, it could {listWords(preview.changes.permissions.before.words)}.</p>
                </Callout>
              )}
              {preview.changes.files.length ? (
                <ul className={styles.changes}>
                  {preview.changes.files.map((f) => (
                    <li key={f.path}>
                      <details className={styles.change}>
                        <summary>
                          <FileText aria-hidden />
                          <code>{f.path}</code>
                          <span className={styles.changeKind} data-change={f.change}>
                            {f.change === 'added'
                              ? 'New'
                              : f.change === 'removed'
                                ? 'Gone'
                                : 'Changed'}
                          </span>
                        </summary>
                        {f.diff ? (
                          <Diff diff={f.diff} header={false} />
                        ) : (
                          <p className={styles.changeNote}>
                            {f.change === 'removed'
                              ? 'Taken out.'
                              : 'Not text, or too long to show here.'}
                          </p>
                        )}
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.changeNote}>Only where it’s pinned changed.</p>
              )}
            </section>
          )}

          <section aria-labelledby={`${titleId}-can`} className={styles.block}>
            <Sub id={`${titleId}-can`} className={styles.blockTitle}>
              What it will be able to do
            </Sub>
            <SkillPermissionList
              variant="compact"
              declared={preview.permissions.declared}
              capabilities={preview.permissions.capabilities}
              words={preview.permissions.words}
            />
            <p className={styles.smallPrint}>
              A chat it’s used in is held to this list: anything else asks you first. Nothing in it
              runs when it’s added.
            </p>
          </section>

          <SkillReview verdict={preview.review.verdict} findings={preview.review.findings} />

          <dl className={styles.facts}>
            <div>
              <dt>
                <Pin aria-hidden /> Version
              </dt>
              <dd>Pinned to {pinWords(preview.pin)}. It only changes when you take an update.</dd>
            </div>
            <div>
              <dt>
                <Scale aria-hidden /> Licence
              </dt>
              <dd>
                {preview.license.kind === 'open'
                  ? `${preview.license.name ?? 'Open'}: free to use and copy.`
                  : preview.license.kind === 'restricted'
                    ? 'Only for use inside its maker’s own apps.'
                    : preview.license.name
                      ? `It says “${preview.license.name}”.`
                      : 'It doesn’t say.'}
              </dd>
            </div>
            {isWebLink(shown.url) && (
              <div>
                <dt>
                  <ArrowUpRight aria-hidden /> Its page
                </dt>
                <dd>
                  <a href={shown.url} target="_blank" rel="noreferrer noopener">
                    On {hostWords(shown.url)}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <details className={styles.instructions}>
            <summary>Read its instructions</summary>
            <pre className={styles.instructionsText}>{preview.instructions || 'It has none.'}</pre>
            {preview.files.length > 0 && (
              <p className={styles.smallPrint}>
                It also has{' '}
                {preview.files.length === 1 ? 'a file' : `${preview.files.length} files`}:{' '}
                {preview.files.slice(0, 12).join(', ')}
                {preview.files.length > 12 ? '…' : ''}
              </p>
            )}
          </details>

          {preview.blocked ? (
            <Callout tone="danger" icon={<Ban />} title="Conch won’t add this one">
              <p>{preview.blocked}</p>
            </Callout>
          ) : done ? (
            <div className={styles.actions}>{done}</div>
          ) : (
            onAdd && (
              <div className={styles.addArea}>
                {!update && onModeChange && (
                  <div className={styles.modeRow}>
                    <span className={styles.modeLabel} id={`${titleId}-mode`}>
                      Use it
                    </span>
                    <SegmentedControl
                      size="sm"
                      value={mode}
                      onValueChange={(v) => v && onModeChange(v as 'auto' | 'manual')}
                      aria-labelledby={`${titleId}-mode`}
                    >
                      <SegmentedControl.Item value="auto">When it fits</SegmentedControl.Item>
                      <SegmentedControl.Item value="manual">Only when I ask</SegmentedControl.Item>
                    </SegmentedControl>
                  </div>
                )}
                {danger && (
                  <Checkbox
                    checked={readIt}
                    onCheckedChange={(v) => setReadIt(v === true)}
                    label="I’ve read what Conch found, and I still want it"
                  />
                )}
                <div className={styles.actions}>
                  <Button
                    onClick={onAdd}
                    loading={adding}
                    disabled={danger && !readIt}
                    variant={danger ? 'surface' : 'solid'}
                  >
                    {addLabel ?? (update ? 'Update' : danger ? 'Add anyway' : 'Add skill')}
                  </Button>
                </div>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}

/** ["read the web", "run commands"] → "read the web and run commands"; nothing → "only read". */
function listWords(words: string[]): string {
  const plain = words.map((w) => w.replace(/`/g, ''));
  if (!plain.length) return 'only read';
  if (plain.length === 1) return plain[0] as string;
  return `${plain.slice(0, -1).join(', ')} and ${plain.at(-1)}`;
}
