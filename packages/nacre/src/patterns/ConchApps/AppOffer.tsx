import { AppWindow, CircleAlert, History, RotateCw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { ReplyChips } from '../ReplyChips';
import { SkillSignatureBadge } from '../Skills/SkillSignatureBadge';
import { AppIcon } from './AppIcon';
import { AppAbilityList, AppChanges, AppSettingsFields, AppTools } from './AppParts';
import styles from './ConchApps.module.css';
import type {
  AppChangesView,
  AppManifestView,
  AppSignatureView,
  AppToolView,
  AppWords,
} from './types';

/** Mirrors `ConchAppOffer['state']`. `busy` is said apart, while a press is on its way. */
export type AppOfferState = 'ready' | 'added' | 'updated' | 'stale' | 'declined' | 'failed';

export interface AppOfferProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Add a new app, or update one you have. */
  action: 'add' | 'update';
  manifest: AppManifestView;
  tools: readonly AppToolView[];
  /** Where it came from: one made in this Conch carries no signature block. */
  source: { kind: 'made' | 'github' | 'link' | 'file' };
  signature: AppSignatureView;
  /** For an update: what's different. */
  changes?: AppChangesView;
  /** In the assistant's words: one sentence on what it made. */
  summary?: string;
  state: AppOfferState;
  /** Why it failed, in one sentence. */
  message?: string;
  /** The protocol's words for it: abilities, who it's from, what changed. */
  words: AppWords;
  /** Settings that already have a value (an update keeps them): no field for those. */
  saved?: readonly string[];
  /** The press is on its way: the card holds still. */
  busy?: boolean;
  /** **Add to my apps** or **Update**, with what the person typed into the card. */
  onAdd?: (settings: Record<string, string>) => void;
  /** **Open the page**: its first page, before it's added. */
  onOpenPage?: (pageId: string) => void;
  onNotNow?: () => void;
  /** Added: one of its examples, sent as the person's own words. */
  onTry?: (text: string) => void;
  /** Added: **Open Plant diary**. */
  onOpenApp?: () => void;
  // The rest of `ConchAppOffer`, so an offer can be spread straight in.
  offerId?: string;
  from?: string;
  draftId?: string;
  packageId?: string;
  hash?: string;
}

/**
 * An app the assistant made or found, offered under its reply (ADR 0061):
 * what it is, what it can do in plain words, what it needs from you, and
 * **Add to my apps**. The agent proposes; only this press adds it. Never a
 * dialog. Added, it turns into a short welcome — its icon lands with a ring
 * of pearl light, and its examples wait as chips to try. A newer offer, or
 * **Not now**, folds it to one quiet line.
 */
export function AppOffer({
  action,
  manifest,
  tools,
  source,
  signature,
  changes,
  summary,
  state,
  message,
  words,
  saved = [],
  busy,
  onAdd,
  onOpenPage,
  onNotNow,
  onTry,
  onOpenApp,
  offerId: _offerId,
  from: _from,
  draftId: _draftId,
  packageId: _packageId,
  hash: _hash,
  className,
  ref,
  ...props
}: AppOfferProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  // Added while on screen (not read from history): the welcome plays once.
  const [before, setBefore] = useState(state);
  const [arrived, setArrived] = useState(false);
  if (before !== state) {
    setBefore(state);
    setArrived(state === 'added' || state === 'updated');
  }

  // Focus follows the card when a change takes away the button it was on.
  const shown = useRef(state);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    root.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
  }, [state]);

  const { name, version } = manifest;
  const page = manifest.pages?.[0];
  const update = action === 'update';
  const needed = (manifest.settings ?? []).filter((s) => !saved.includes(s.key));
  const add = () => {
    if (!onAdd || busy) return;
    // Only what this card asked for, trimmed: nothing else rides along.
    const typed: Record<string, string> = {};
    for (const s of needed) {
      const value = values[s.key]?.trim();
      if (value) typed[s.key] = value;
    }
    onAdd(typed);
  };

  if (state === 'stale' || state === 'declined')
    return (
      <div
        ref={setRoot}
        role="note"
        className={cx(styles.offerLine, className)}
        data-state={state}
        {...props}
      >
        <AppIcon glyph={manifest.icon.glyph} color={manifest.icon.color} size="xs" />
        <span className={styles.offerLineText}>
          {state === 'stale' ? (
            <>
              <strong>{name}</strong> {version}
              <span className={styles.dot} aria-hidden>
                ·
              </span>
              A newer version is below
            </>
          ) : (
            <>
              {update ? 'Didn’t update ' : 'Didn’t add '}
              <strong>{name}</strong>
            </>
          )}
        </span>
      </div>
    );

  const head = (title: ReactNode, sub?: ReactNode, meta?: ReactNode) => (
    <div className={styles.offerHead}>
      <AppIcon
        glyph={manifest.icon.glyph}
        color={manifest.icon.color}
        size="md"
        className={styles.offerIcon}
      />
      <div className={styles.offerHeadText}>
        <p id={titleId} className={styles.offerTitle}>
          {title}
        </p>
        {sub && <p className={styles.offerTagline}>{sub}</p>}
        {meta && <p className={styles.offerMeta}>{meta}</p>}
      </div>
    </div>
  );

  let body: ReactNode;
  if (state === 'added' || state === 'updated') {
    const examples = (manifest.examples ?? []).map((text) => ({ text }));
    body = (
      <div className={styles.welcome} data-arrived={arrived || undefined}>
        <div className={styles.welcomeHead}>
          <span className={styles.welcomeMark}>
            <span className={styles.welcomeRing} aria-hidden />
            <AppIcon glyph={manifest.icon.glyph} color={manifest.icon.color} size="md" />
          </span>
          <div className={styles.offerHeadText}>
            <p id={titleId} className={styles.offerTitle} role="status">
              {state === 'updated' ? `${name} is updated to ${version}` : `${name} is in your apps`}
            </p>
            <p className={styles.offerTagline}>
              {examples.length
                ? 'Ask for it in your own words, or try one of these.'
                : manifest.tagline}
            </p>
          </div>
          {onOpenApp && (
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<AppWindow />}
              onClick={onOpenApp}
              className={styles.welcomeOpen}
              data-primary
            >
              Open {name}
            </Button>
          )}
        </div>
        {onTry && examples.length > 0 && (
          <ReplyChips
            replies={examples}
            onSend={onTry}
            label={`Try ${name}`}
            entrance={arrived}
            className={styles.welcomeChips}
          />
        )}
      </div>
    );
  } else if (state === 'failed') {
    body = (
      <>
        {head(name, undefined, words.from)}
        <p className={styles.offerProblem} role="alert">
          <CircleAlert aria-hidden />
          <span>
            {message ?? `${name} couldn’t be ${update ? 'updated' : 'added'}. Nothing changed.`}
          </span>
        </p>
        <div className={styles.offerActions}>
          {onAdd && (
            <Button
              size="sm"
              variant="soft"
              leadingIcon={<RotateCw />}
              onClick={add}
              loading={busy}
              data-primary
            >
              Try again
            </Button>
          )}
          {onNotNow && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onNotNow}
              disabled={busy}
              className={styles.notNow}
            >
              Not now
            </Button>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <>
        {head(
          name,
          manifest.tagline,
          update && changes ? (
            <>
              <History aria-hidden />
              Update · {changes.from} → {changes.to}
            </>
          ) : (
            `${words.from} · ${version}`
          ),
        )}
        {summary && <p className={styles.offerSummary}>{summary}</p>}
        {update && changes && words.changes && (
          <AppChanges changes={changes} words={words.changes} />
        )}
        <section className={styles.offerSection} aria-label={`What ${name} can do`}>
          <p className={styles.sectionLabel} aria-hidden>
            What it can do
          </p>
          <AppAbilityList
            abilities={words.abilities}
            pages={manifest.pages}
            label={`What ${name} can do`}
          />
          <AppTools tools={tools} />
        </section>
        {source.kind !== 'made' && (
          <SkillSignatureBadge
            state={signature.state}
            publisher={signature.publisher}
            fingerprint={signature.fingerprint}
            problem={signature.problem}
            lookalike={signature.lookalike}
            of="app"
          />
        )}
        <div className={styles.offerYours}>
          <AppSettingsFields
            settings={needed}
            values={values}
            onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
            disabled={busy}
            label={update ? 'What it needs from you now' : 'What it needs from you'}
          />
          <div className={styles.offerActions}>
            {onAdd && (
              <Button
                size="sm"
                variant="solid"
                onClick={add}
                loading={busy}
                aria-label={update ? `Update ${name}` : `Add ${name} to my apps`}
                data-primary
              >
                {update ? 'Update' : 'Add to my apps'}
              </Button>
            )}
            {page && onOpenPage && (
              <Button
                size="sm"
                variant="surface"
                leadingIcon={<AppWindow />}
                onClick={() => onOpenPage(page.id)}
                disabled={busy}
              >
                Open the page
              </Button>
            )}
            {onNotNow && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onNotNow}
                disabled={busy}
                className={styles.notNow}
              >
                Not now
              </Button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={setRoot}
      role="group"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={cx(styles.offer, className)}
      data-state={state}
      data-lustre=""
      {...props}
    >
      {body}
    </div>
  );
}
