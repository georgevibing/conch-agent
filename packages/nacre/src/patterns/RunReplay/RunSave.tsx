import { Check, EyeOff, FolderOpen } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Collapsible } from '../../components/Collapsible';
import { Pearl } from '../../components/Pearl';
import { RadioGroup } from '../../components/RadioGroup';
import { Skeleton } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './RunSave.module.css';

export interface RunSaveFormat {
  id: string;
  title: string;
  detail: string;
}

/** One kind of thing taken out: "3 keys and tokens", and where they were, as they read now. */
export interface RunSaveRemoved {
  kind: string;
  label: string;
  examples: string[];
}

export interface RunSaveProps extends Omit<ComponentProps<'div'>, 'children'> {
  formats: RunSaveFormat[];
  format: string;
  onFormatChange: (id: string) => void;
  /** Keys and personal details taken out. On by default, in the app. */
  redact: boolean;
  onRedactChange: (on: boolean) => void;
  /** What would be taken out, worked out before saving. `undefined` while it's worked out. */
  removed?: RunSaveRemoved[];
  /** "12 chats · 418 steps": what goes in. */
  summary?: string;
  /** Which chats, for a batch: the app's own controls. */
  filters?: ReactNode;
  /** Where it goes, as a person reads it: "~/Downloads". */
  folder?: string;
  onChooseFolder?: () => void;
  onSave: () => void;
  saving?: boolean;
  /** It was saved: the file's name and the folder it's in. */
  saved?: { name: string; folder: string };
  /** Why it can't be saved, in a sentence. */
  problem?: string;
}

/**
 * Saving what the assistant did as a file, in one press: the format, whether
 * keys and personal details come out (on, with what came out shown before
 * anything is written), and the folder. The file stays on this computer.
 */
export function RunSave({
  formats,
  format,
  onFormatChange,
  redact,
  onRedactChange,
  removed,
  summary,
  filters,
  folder,
  onChooseFolder,
  onSave,
  saving,
  saved,
  problem,
  className,
  ...props
}: RunSaveProps) {
  if (saved) {
    return (
      <div className={cx(styles.save, styles.saved, className)} {...props}>
        <Pearl size="md" state="idle" glint label={null} />
        <div className={styles.savedText} role="status">
          <p className={styles.savedTitle}>
            <Check aria-hidden /> Saved in {saved.folder}
          </p>
          <p className={styles.fileName}>{saved.name}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cx(styles.save, className)} {...props}>
      {filters && <div className={styles.filters}>{filters}</div>}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Save it as</legend>
        <RadioGroup value={format} onValueChange={onFormatChange} aria-label="Save it as">
          {formats.map((f) => (
            <RadioGroup.Item key={f.id} value={f.id} label={f.title} description={f.detail} />
          ))}
        </RadioGroup>
      </fieldset>

      <div className={styles.group}>
        <Switch
          checked={redact}
          onCheckedChange={onRedactChange}
          label="Take out keys and personal details"
          description="Passwords, keys, email addresses, phone and card numbers, your folder names and the names in About you."
        />
        {redact && (
          <div className={styles.removed} aria-live="polite">
            {removed === undefined ? (
              <Skeleton className={styles.removedWait} />
            ) : removed.length === 0 ? (
              <p className={styles.removedNone}>Nothing to take out.</p>
            ) : (
              <Collapsible>
                <Collapsible.Trigger className={styles.removedLine}>
                  <EyeOff aria-hidden />
                  <span>Taking out {removed.map((r) => r.label).join(', ')}</span>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <ul className={styles.examples}>
                    {removed.flatMap((r) =>
                      r.examples.map((example) => (
                        <li key={`${r.kind}:${example}`}>
                          <code>{example}</code>
                        </li>
                      )),
                    )}
                  </ul>
                </Collapsible.Content>
              </Collapsible>
            )}
          </div>
        )}
      </div>

      {onChooseFolder && (
        <div className={styles.where}>
          <FolderOpen aria-hidden />
          <span className={styles.folder}>{folder ?? 'Downloads'}</span>
          <Button size="sm" variant="ghost" onClick={onChooseFolder}>
            Change
          </Button>
        </div>
      )}

      {problem && <Callout tone="warning">{problem}</Callout>}

      <div className={styles.footer}>
        {summary && <span className={styles.summary}>{summary}</span>}
        <Button onClick={onSave} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
