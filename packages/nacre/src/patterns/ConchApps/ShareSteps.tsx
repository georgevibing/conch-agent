import { CircleCheck, ExternalLink, FileArchive, Link2, RotateCw, Upload } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { SignInCode } from '../Providers/SignInCode';
import styles from './ShareSteps.module.css';
import { isWebLink, type PublishStateView } from './types';

export interface ShareStepsProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** The app's name: “Plant diary”. */
  name: string;
  /** Its id, for the file's name: `plant-diary.conchapp`. */
  appId: string;
  /** Where publishing on GitHub stands (`PublishState`). */
  state: PublishStateView;
  /** **Publish on GitHub**, and on from where it stopped. */
  onPublish?: () => void;
  /** **Save as a file**: the system's Save dialog. */
  onSaveFile?: () => void;
  /** Saving the file now. */
  saving?: boolean;
  /**
   * When GitHub's program is missing: the web's `GetIt` for the need, which
   * installs it with progress and carries on. Without it, `onInstall`.
   */
  getIt?: ReactNode;
  onInstall?: () => void;
  /**
   * It wasn't made here: only its maker can publish it, and the file
   * carries their signature, not yours. `url` is where it was added from
   * (a GitHub repository or a link), offered to pass on instead.
   */
  elsewhere?: { url?: string };
}

/**
 * Sharing an app is one press (ADR 0061): **Publish on GitHub** or **Save
 * as a file**, each with a sentence. Publishing walks through what only the
 * person can do — install GitHub's app, sign in with a code — and carries on
 * by itself, then gives the address anyone with Conch can add it from.
 * Either way the package carries the person's signature.
 */
export function ShareSteps({
  name,
  appId,
  state,
  onPublish,
  onSaveFile,
  saving,
  getIt,
  onInstall,
  elsewhere,
  className,
  ...props
}: ShareStepsProps) {
  const titleId = useId();
  let body: ReactNode;
  if (elsewhere) {
    const url = isWebLink(elsewhere.url) ? elsewhere.url : undefined;
    return (
      <section
        aria-labelledby={titleId}
        className={cx(styles.share, className)}
        data-state="elsewhere"
        {...props}
      >
        <p id={titleId} className={styles.title}>
          Share {name}
        </p>
        <div className={styles.ways}>
          {url && (
            <div className={styles.way}>
              <span className={styles.wayIcon} aria-hidden>
                <Link2 />
              </span>
              <div className={styles.wayText}>
                <p className={styles.wayTitle}>Where you got it</p>
                <p className={styles.wayAbout}>
                  Anyone with Conch can add {name} from here, and get its maker’s updates.
                </p>
                <div className={styles.address}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.link}
                    aria-label={`${url} (opens in a new tab)`}
                  >
                    {url.replace(/^https:\/\//, '')}
                    <ExternalLink aria-hidden />
                  </a>
                  <CopyButton value={url} label="Copy the address" />
                </div>
              </div>
            </div>
          )}
          <div className={styles.way}>
            <span className={styles.wayIcon} aria-hidden>
              <FileArchive />
            </span>
            <div className={styles.wayText}>
              <p className={styles.wayTitle}>As a file</p>
              <p className={styles.wayAbout}>
                <span className={styles.file}>{appId}.conchapp</span>, to send any way you like.
                It’s added by dropping it on Apps.
              </p>
            </div>
            {onSaveFile && (
              <Button size="sm" variant="surface" onClick={onSaveFile} loading={saving}>
                Save as a file
              </Button>
            )}
          </div>
        </div>
        <p className={styles.fine}>
          It wasn’t made here, so Conch doesn’t publish it. The file keeps its maker’s signature.
        </p>
      </section>
    );
  }
  switch (state.state) {
    case 'idle':
      body = (
        <>
          <div className={styles.ways}>
            <div className={styles.way}>
              <IntegrationLogo brand="github" name="GitHub" color="#24292f" size="sm" decorative />
              <div className={styles.wayText}>
                <p className={styles.wayTitle}>On GitHub</p>
                <p className={styles.wayAbout}>
                  A public page anyone with Conch can add {name} from. Publishing again shares the
                  newest version.
                </p>
              </div>
              {onPublish && (
                <Button size="sm" leadingIcon={<Upload />} onClick={onPublish}>
                  Publish on GitHub
                </Button>
              )}
            </div>
            <div className={styles.way}>
              <span className={styles.wayIcon} aria-hidden>
                <FileArchive />
              </span>
              <div className={styles.wayText}>
                <p className={styles.wayTitle}>As a file</p>
                <p className={styles.wayAbout}>
                  <span className={styles.file}>{appId}.conchapp</span>, to send any way you like.
                  It’s added by dropping it on Apps.
                </p>
              </div>
              {onSaveFile && (
                <Button size="sm" variant="surface" onClick={onSaveFile} loading={saving}>
                  Save as a file
                </Button>
              )}
            </div>
          </div>
          <p className={styles.fine}>
            Either way it carries your signature, so people see it’s from you.
          </p>
        </>
      );
      break;
    case 'needs-program':
      body = (
        <div className={styles.step}>
          <p className={styles.stepTitle}>Needs GitHub’s app.</p>
          <p className={styles.stepAbout}>
            Conch publishes through GitHub’s own program, so it never keeps a GitHub password.
          </p>
          <div className={styles.actions}>
            {getIt ??
              (onInstall && (
                <Button size="sm" onClick={onInstall}>
                  Install GitHub’s app
                </Button>
              ))}
          </div>
        </div>
      );
      break;
    case 'needs-sign-in':
      body = isWebLink(state.url) ? (
        <SignInCode
          code={state.code}
          url={state.url}
          title="Sign in to GitHub with this code"
          openLabel="Open GitHub"
          waiting="Conch carries on by itself when you’re done."
        />
      ) : (
        <Callout tone="warning" title="GitHub’s sign-in page didn’t look right">
          Conch didn’t open it. Try again in a moment.
        </Callout>
      );
      break;
    case 'publishing':
      body = (
        <div className={styles.step} aria-live="polite">
          <p className={styles.stepTitle}>Publishing {name}…</p>
          <Progress value={null} size="sm" label={state.step} />
        </div>
      );
      break;
    case 'published':
      body = (
        <div className={styles.step}>
          <p className={styles.done} role="status">
            <CircleCheck aria-hidden />
            {name} {state.version} is on GitHub
          </p>
          <div className={styles.address}>
            {isWebLink(state.url) ? (
              <a
                href={state.url}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.link}
                aria-label={`${state.url} (opens in a new tab)`}
              >
                {state.url.replace(/^https:\/\//, '')}
                <ExternalLink aria-hidden />
              </a>
            ) : (
              <span className={styles.link}>{state.url}</span>
            )}
            <CopyButton value={state.url} label="Copy the address" />
          </div>
          <p className={styles.stepAbout}>Anyone with Conch can add it from this address.</p>
          {onPublish && (
            <div className={styles.actions}>
              <Button size="sm" variant="ghost" leadingIcon={<Upload />} onClick={onPublish}>
                Publish again
              </Button>
              {onSaveFile && (
                <Button size="sm" variant="ghost" onClick={onSaveFile} loading={saving}>
                  Save as a file
                </Button>
              )}
            </div>
          )}
        </div>
      );
      break;
    case 'failed':
      body = (
        <Callout
          tone="danger"
          live="polite"
          title={`${name} wasn’t published`}
          action={
            onPublish && (
              <Button size="sm" variant="surface" leadingIcon={<RotateCw />} onClick={onPublish}>
                Try again
              </Button>
            )
          }
        >
          {state.message}
        </Callout>
      );
      break;
  }
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={state.state === 'publishing' || undefined}
      className={cx(styles.share, className)}
      data-state={state.state}
      {...props}
    >
      <p id={titleId} className={styles.title}>
        Share {name}
      </p>
      {body}
    </section>
  );
}
