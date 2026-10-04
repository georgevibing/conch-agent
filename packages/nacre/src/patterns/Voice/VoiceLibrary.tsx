import { Check, Download, Pause, Play, Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import styles from './Voice.module.css';

export interface LibraryVoice {
  id: string;
  /** "Lessac" */
  name: string;
  /** In its own words: "American English", "Ελληνικά". */
  language: string;
  bytes: number;
  state: 'ready' | 'missing' | 'downloading';
  done?: number;
  total?: number;
  /** Why the last download stopped. */
  problem?: string;
}

export interface VoiceLibraryProps extends Omit<ComponentProps<'ul'>, 'onChange' | 'onPause'> {
  voices: LibraryVoice[];
  /** The voice in use, if it's one of these. */
  chosen?: string;
  onDownload: (id: string) => void;
  onPause: (id: string) => void;
  onChoose: (id: string) => void;
  onTry: (id: string) => void;
  onRemove?: (id: string) => void;
  /** The voice being tried right now. */
  trying?: string;
}

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * Natural voices that run on the computer (ADR 0077): one row each, with what
 * it takes to have it (its size, then its progress) and, once it's here, Try
 * and Use. The one in use says so in words, not only with a mark.
 */
export function VoiceLibrary({
  voices,
  chosen,
  onDownload,
  onPause,
  onChoose,
  onTry,
  onRemove,
  trying,
  className,
  ...props
}: VoiceLibraryProps) {
  return (
    <ul className={cx(styles.library, className)} {...props}>
      {voices.map((voice) => {
        const inUse = chosen === voice.id;
        return (
          <li key={voice.id} className={styles.libraryRow} data-state={voice.state}>
            <div className={styles.libraryText}>
              <span className={styles.libraryName}>
                {voice.name}
                {inUse && (
                  <span className={styles.libraryInUse}>
                    <Check aria-hidden /> In use
                  </span>
                )}
              </span>
              <span className={styles.libraryMeta}>
                {voice.language}
                {voice.state === 'missing' && ` · ${mb(voice.bytes)}`}
              </span>
              {voice.state === 'downloading' && (
                <Progress
                  className={styles.libraryProgress}
                  value={Math.round(
                    ((voice.done ?? 0) / Math.max(1, voice.total ?? voice.bytes)) * 100,
                  )}
                  label={`Downloading ${voice.name} · ${mb(voice.done ?? 0)} of ${mb(voice.total ?? voice.bytes)}`}
                />
              )}
              {voice.problem && voice.state === 'missing' && (
                <span className={styles.libraryProblem}>{voice.problem}</span>
              )}
            </div>
            <div className={styles.libraryActions}>
              {voice.state === 'missing' && (
                <Button
                  size="sm"
                  variant="surface"
                  leadingIcon={<Download />}
                  onClick={() => onDownload(voice.id)}
                  aria-label={`Get ${voice.name}, ${mb(voice.bytes)}`}
                >
                  {voice.problem ? 'Carry on' : 'Get it'}
                </Button>
              )}
              {voice.state === 'downloading' && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Pause ${voice.name}`}
                  onClick={() => onPause(voice.id)}
                >
                  <Pause />
                </IconButton>
              )}
              {voice.state === 'ready' && (
                <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Try ${voice.name}`}
                    loading={trying === voice.id}
                    onClick={() => onTry(voice.id)}
                  >
                    <Play />
                  </IconButton>
                  {!inUse && (
                    <Button
                      size="sm"
                      variant="surface"
                      onClick={() => onChoose(voice.id)}
                      aria-label={`Use ${voice.name}`}
                    >
                      Use
                    </Button>
                  )}
                  {onRemove && !inUse && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Remove ${voice.name}`}
                      onClick={() => onRemove(voice.id)}
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
