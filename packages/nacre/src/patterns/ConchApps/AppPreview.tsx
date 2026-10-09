import { Check, ChevronDown, CircleAlert, History, RotateCw } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Skeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { SkillSignatureBadge } from '../Skills/SkillSignatureBadge';
import { AppIcon } from './AppIcon';
import { AppAbilityList, AppChanges, AppSettingsFields, AppTools } from './AppParts';
import styles from './AppPreview.module.css';
import {
  PartReview,
  partReady,
  type PartChannelView,
  type PartProviderView,
  type PartTestView,
  type PartValues,
} from './PartReview';
import type {
  AppChangesView,
  AppManifestView,
  AppSignatureView,
  AppToolView,
  AppWords,
} from './types';

/** One app found at a link or in a file (mirrors `ConchAppFound`, with its words). */
export interface AppPreviewApp {
  manifest: AppManifestView;
  tools: readonly AppToolView[];
  signature: AppSignatureView;
  /** Why it can't be added, in words; empty when it can. */
  problems?: readonly { message: string; file?: string; line?: number }[];
  /** What to know before adding it, in words: it replaces an app from another maker. */
  warnings?: readonly { message: string }[];
  /** The version you have, when you have it. */
  installed?: string;
  /** Its picture (ADR 0090), drawn instead of the glyph. */
  picture?: string;
  /** Its settings that already have a value (from the app you have): no field for those. */
  saved?: readonly string[];
  changes?: AppChangesView;
  /** `appAbilities`, `appSourceLine`, and `describeChanges` when it's an update. */
  words: AppWords;
  /** A provider or a chat app it brings (ADR 0119): reviewed and tested before it's added. */
  brings?: { provider?: PartProviderView; channel?: PartChannelView };
}

export interface AppPreviewProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** Reading the link or the file; showing what's in it; or it couldn't be read. */
  state: 'loading' | 'ready' | 'failed';
  /** Where it's looking, in a few words: “github.com/ada/plant-diary”. */
  looking: string;
  apps?: readonly AppPreviewApp[];
  /** Why the link or the file couldn't be read, in one sentence. */
  message?: string;
  /** The app being added now (its id). */
  busy?: string;
  /** Apps added from this preview (their ids). */
  added?: readonly string[];
  /** **Add to my apps** or **Update**, with what the person typed (and its part's key, ADR 0119). */
  onAdd?: (appId: string, settings: Record<string, string>, part?: PartValues) => void;
  /** **Test it**, for an app that brings a provider or a chat app (ADR 0119). */
  onTest?: (appId: string, values: PartValues) => Promise<PartTestView>;
  /** After a failure: read the link again. */
  onRetry?: () => void;
}

/**
 * What a link or a `.conchapp` holds, before anything is added (ADR 0061):
 * one app laid out like the card in a chat — what it can do, who it's from,
 * what it needs — or a collection to pick from. What stops one being added
 * is said in words; one you have already offers **Update**, with what
 * changed first.
 */
export function AppPreview({
  state,
  looking,
  apps = [],
  message,
  busy,
  added = [],
  onAdd,
  onTest,
  onRetry,
  className,
  ...props
}: AppPreviewProps) {
  const titleId = useId();

  if (state === 'loading')
    return (
      <section
        aria-labelledby={titleId}
        aria-busy
        className={cx(styles.preview, className)}
        {...props}
      >
        <p id={titleId} className={styles.looking}>
          <Spinner size="xs" label={null} />
          Looking at {looking}…
        </p>
        <div className={styles.skeleton} aria-hidden>
          <Skeleton shape="block" width="3.5rem" height="3.5rem" />
          <div className={styles.skeletonText}>
            <Skeleton width="40%" />
            <Skeleton width="75%" />
          </div>
        </div>
        <Skeleton lines={4} aria-hidden />
      </section>
    );

  if (state === 'failed' || !apps.length)
    return (
      <section aria-labelledby={titleId} className={cx(styles.preview, className)} {...props}>
        <Callout
          tone="warning"
          live="polite"
          title={<span id={titleId}>Nothing to add from {looking}</span>}
          action={
            onRetry && (
              <Button size="sm" variant="surface" leadingIcon={<RotateCw />} onClick={onRetry}>
                Try again
              </Button>
            )
          }
        >
          {message ?? 'There’s no Conch app there. Check the link, or ask whoever shared it.'}
        </Callout>
      </section>
    );

  if (apps.length === 1) {
    const [app] = apps as [AppPreviewApp];
    return (
      <section aria-labelledby={titleId} className={cx(styles.preview, className)} {...props}>
        <FoundApp
          app={app}
          titleId={titleId}
          size="lg"
          busy={busy === app.manifest.id}
          added={added.includes(app.manifest.id)}
          onAdd={onAdd}
          onTest={onTest}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={cx(styles.preview, className)} {...props}>
      <p id={titleId} className={styles.collectionTitle}>
        {apps.length} apps at {looking}
      </p>
      <ul className={styles.collection}>
        {apps.map((app) => (
          <CollectionRow
            key={app.manifest.id}
            app={app}
            busy={busy === app.manifest.id}
            added={added.includes(app.manifest.id)}
            onAdd={onAdd}
            onTest={onTest}
          />
        ))}
      </ul>
    </section>
  );
}

/** -1 when `a` is an earlier `major.minor.patch` than `b`, 1 when later, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Where one found app stands, for its button. */
function standing(app: AppPreviewApp, added: boolean) {
  if (added) return 'added' as const;
  if (app.problems?.length) return 'blocked' as const;
  if (app.installed === app.manifest.version) return 'have' as const;
  if (app.installed) return 'update' as const;
  return 'new' as const;
}

function CollectionRow({
  app,
  busy,
  added,
  onAdd,
  onTest,
}: {
  app: AppPreviewApp;
  busy: boolean;
  added: boolean;
  onAdd?: AppPreviewProps['onAdd'];
  onTest?: AppPreviewProps['onTest'];
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const titleId = useId();
  const { manifest } = app;
  const stand = standing(app, added);
  return (
    <li className={styles.row} data-open={open || undefined}>
      <div className={styles.rowHead}>
        <AppIcon
          glyph={manifest.icon.glyph}
          color={manifest.icon.color}
          src={app.picture}
          size="md"
        />
        <div className={styles.rowText}>
          <p className={styles.rowName}>{manifest.name}</p>
          <p className={styles.rowTagline}>{manifest.tagline}</p>
        </div>
        {stand === 'added' || stand === 'have' ? (
          <Badge tone="success" icon={<Check />}>
            {stand === 'added' ? 'Added' : 'You have it'}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant={open ? 'ghost' : 'surface'}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={
              open
                ? `Hide ${manifest.name}`
                : `${stand === 'update' ? 'Update' : stand === 'blocked' ? 'See' : 'Add'} ${manifest.name}…`
            }
            trailingIcon={<ChevronDown className={styles.chevron} />}
            onClick={() => setOpen(!open)}
          >
            {open
              ? 'Hide'
              : stand === 'update'
                ? 'Update'
                : stand === 'blocked'
                  ? 'Why not'
                  : 'Add'}
          </Button>
        )}
      </div>
      {open && (
        <div id={detailsId} className={styles.rowDetails}>
          <FoundApp
            app={app}
            titleId={titleId}
            size="md"
            bare
            busy={busy}
            added={added}
            onAdd={onAdd}
            onTest={onTest}
          />
        </div>
      )}
    </li>
  );
}

function FoundApp({
  app,
  titleId,
  size,
  bare,
  busy,
  added,
  onAdd,
  onTest,
}: {
  app: AppPreviewApp;
  titleId: string;
  size: 'md' | 'lg';
  /** Inside a row that already shows its name. */
  bare?: boolean;
  busy: boolean;
  added: boolean;
  onAdd?: AppPreviewProps['onAdd'];
  onTest?: AppPreviewProps['onTest'];
}) {
  const { manifest, words, brings } = app;
  const [values, setValues] = useState<Record<string, string>>({});
  const [partValues, setPartValues] = useState<PartValues>({ key: '', fields: {} });
  const [test, setTest] = useState<PartTestView>({ state: 'idle' });
  const partHasValues = Boolean(
    brings &&
    (brings.provider?.key
      ? !brings.provider.key.optional
      : (brings.channel?.fields.length ?? 0) > 0),
  );
  const partBlocks = Boolean(brings && partHasValues && onTest && test.state !== 'passed');
  const runTest = async () => {
    if (!onTest) return;
    setTest({ state: 'testing' });
    try {
      setTest(await onTest(manifest.id, partValues));
    } catch {
      setTest({ state: 'failed', message: 'The test didn’t run. Try again.' });
    }
  };
  const stand = standing(app, added);
  const update = stand === 'update';
  // An earlier version than the one you have: said as it is, never as "new".
  const older =
    update && app.installed ? compareVersions(manifest.version, app.installed) < 0 : false;
  const needed = (manifest.settings ?? []).filter((s) => !app.saved?.includes(s.key));
  const add = () => {
    if (!onAdd || busy) return;
    const typed: Record<string, string> = {};
    for (const s of needed) {
      const value = values[s.key]?.trim();
      if (value) typed[s.key] = value;
    }
    if (!brings) return onAdd(manifest.id, typed);
    onAdd(manifest.id, typed, {
      key: partValues.key.trim(),
      fields: Object.fromEntries(
        Object.entries(partValues.fields)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v),
      ),
    });
  };

  let foot: ReactNode;
  if (stand === 'blocked')
    foot = (
      <div className={styles.problems} role="note" aria-labelledby={`${titleId}-why`}>
        <p id={`${titleId}-why`} className={styles.problemsTitle}>
          <CircleAlert aria-hidden />
          {manifest.name} can’t be added
        </p>
        <ul>
          {app.problems?.map((p) => (
            <li key={`${p.file ?? ''}${p.line ?? ''}${p.message}`}>
              {p.message}
              {p.file && (
                <span className={styles.where}>
                  {' '}
                  ({p.file}
                  {p.line ? `, line ${p.line}` : ''})
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  else if (stand === 'added' || stand === 'have')
    foot = (
      <p className={styles.done} role="status">
        <Check aria-hidden />
        {stand === 'added'
          ? `${manifest.name} is in your apps.`
          : `You have version ${manifest.version}.`}
      </p>
    );
  else
    foot = (
      <>
        <AppSettingsFields
          settings={needed}
          values={values}
          onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          disabled={busy}
          label="What it needs from you"
        />
        {brings && (brings.provider || brings.channel) && (
          <PartReview
            {...(brings.provider && { provider: brings.provider })}
            {...(brings.channel && { channel: brings.channel })}
            values={partValues}
            onValuesChange={(next) => {
              setPartValues(next);
              if (test.state !== 'idle' && test.state !== 'testing') setTest({ state: 'idle' });
            }}
            test={test}
            {...(onTest && { onTest: () => void runTest() })}
            disabled={busy}
          />
        )}
        <div className={styles.actions}>
          {onAdd && (
            <Button
              onClick={add}
              loading={busy}
              disabled={
                partBlocks || Boolean(brings && partHasValues && !partReady(brings, partValues))
              }
              aria-label={
                older
                  ? `Use ${manifest.name} ${manifest.version}`
                  : update
                    ? `Update ${manifest.name}`
                    : `Add ${manifest.name} to my apps`
              }
            >
              {older ? 'Use this version' : update ? 'Update' : 'Add to my apps'}
            </Button>
          )}
        </div>
      </>
    );

  return (
    <div className={styles.found}>
      {!bare && (
        <div className={styles.head}>
          <AppIcon
            glyph={manifest.icon.glyph}
            color={manifest.icon.color}
            src={app.picture}
            size={size}
          />
          <div className={styles.headText}>
            <p id={titleId} className={styles.name}>
              {manifest.name}
            </p>
            <p className={styles.tagline}>{manifest.tagline}</p>
            <p className={styles.meta}>
              {words.from} · {manifest.version}
            </p>
          </div>
        </div>
      )}
      {bare && (
        <p id={titleId} className={styles.meta}>
          {words.from} · {manifest.version}
        </p>
      )}
      {update && app.installed && (
        <p className={styles.installed}>
          <History aria-hidden />
          {older
            ? `You have a newer version, ${app.installed}.`
            : `You have version ${app.installed}.`}
        </p>
      )}
      {manifest.description && <p className={styles.description}>{manifest.description}</p>}
      {update && app.changes && words.changes && (
        <AppChanges
          changes={app.changes}
          words={words.changes}
          title={older ? `How ${manifest.version} is different` : undefined}
        />
      )}
      {stand !== 'blocked' && stand !== 'added' && app.warnings?.length ? (
        <Callout tone="warning" title="Before you add it">
          {app.warnings.length === 1 ? (
            app.warnings[0]?.message
          ) : (
            <ul className={styles.warnings}>
              {app.warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          )}
        </Callout>
      ) : null}
      <div>
        <p className={styles.label} aria-hidden>
          What it can do
        </p>
        <AppAbilityList
          abilities={words.abilities}
          pages={manifest.pages}
          label={`What ${manifest.name} can do`}
        />
        <AppTools tools={app.tools} />
      </div>
      <SkillSignatureBadge
        state={app.signature.state}
        publisher={app.signature.publisher}
        fingerprint={app.signature.fingerprint}
        problem={app.signature.problem}
        lookalike={app.signature.lookalike}
        of="app"
      />
      {foot}
    </div>
  );
}
