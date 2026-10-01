import { FileKey2, Folder, FolderOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { RadioGroup } from '../../components/RadioGroup';
import { cx } from '../../utils/cx';
import styles from './PathPicker.module.css';

export interface PathSuggestion {
  path: string;
  /** "Passwords", "Projects". */
  title: string;
  /** "iCloud Drive · KeePassXC opened it lately". */
  detail?: string;
}

export interface PathPickerProps {
  kind?: 'file' | 'folder';
  /** The chosen path. */
  value?: string;
  onChange: (path: string) => void;
  /**
   * Opens the system's Open dialog (resolves undefined when cancelled). Leave
   * it out where there's no dialog to show (another device): typing is offered.
   */
  onChoose?: () => Promise<string | undefined>;
  /** Found for the person, chosen with one click. */
  suggestions?: PathSuggestion[];
  /** The accessible name of the choice. */
  label: string;
  /** For typing, e.g. "~/Documents/Passwords.kdbx". */
  placeholder?: string;
  /** "Choose another file…" by default. */
  chooseLabel?: string;
  /** A line under it. */
  hint?: ReactNode;
  className?: string;
}

function split(path: string): { name: string; parent: string } {
  const clean = path.replace(/[/\\]+$/, '');
  const at = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return { name: clean.slice(at + 1) || clean, parent: at > 0 ? clean.slice(0, at) : '' };
}

/** A path shown the way people read one: its name, then where it is. */
function pretty(path: string): string {
  return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Z]:\\Users\\[^\\]+/i, '~');
}

/**
 * Choosing a file or folder without typing a path: what Conch found, one
 * click each; the system's own Open dialog for anything else; and typing it,
 * only as a last resort (from another device, where no dialog can show).
 */
export function PathPicker({
  kind = 'file',
  value,
  onChange,
  onChoose,
  suggestions = [],
  label,
  placeholder,
  chooseLabel,
  hint,
  className,
}: PathPickerProps) {
  const [typing, setTyping] = useState(!onChoose && suggestions.length === 0);
  const [busy, setBusy] = useState(false);
  /** Why the Open dialog didn't come up, when it didn't. */
  const [failed, setFailed] = useState<string>();
  const Icon = kind === 'folder' ? Folder : FileKey2;
  const options = [...suggestions];
  if (value && !options.some((s) => s.path === value)) {
    const { name, parent } = split(value);
    options.unshift({ path: value, title: name, detail: pretty(parent) });
  }

  const choose = async () => {
    if (!onChoose) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const path = await onChoose();
      if (path) onChange(path);
    } catch (error) {
      // Never a button that does nothing: say so, and offer typing instead.
      setFailed(
        error instanceof Error && error.message ? error.message : 'The Open dialog didn’t come up.',
      );
      setTyping(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx(styles.picker, className)}>
      {options.length > 0 && (
        <RadioGroup
          variant="card"
          aria-label={label}
          value={value ?? ''}
          onValueChange={onChange}
          className={styles.options}
        >
          {options.map((s) => (
            <RadioGroup.Item
              key={s.path}
              value={s.path}
              icon={<Icon />}
              label={s.title}
              description={s.detail ?? pretty(split(s.path).parent)}
              title={s.path}
            />
          ))}
        </RadioGroup>
      )}
      {typing ? (
        <Input
          size="sm"
          aria-label={label}
          placeholder={placeholder}
          value={value ?? ''}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
      <div className={styles.actions}>
        {onChoose && (
          <Button
            size="sm"
            variant="surface"
            leadingIcon={<FolderOpen />}
            loading={busy}
            onClick={() => void choose()}
          >
            {chooseLabel ??
              (options.length
                ? kind === 'folder'
                  ? 'Choose another folder…'
                  : 'Choose another file…'
                : kind === 'folder'
                  ? 'Choose a folder…'
                  : 'Choose a file…')}
          </Button>
        )}
        {!typing && (
          <Button size="sm" variant="ghost" onClick={() => setTyping(true)}>
            Type a path
          </Button>
        )}
      </div>
      {failed && (
        <p role="status" className={styles.hint}>
          {failed} Type the path instead.
        </p>
      )}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
