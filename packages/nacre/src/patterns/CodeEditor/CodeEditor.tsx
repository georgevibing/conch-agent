import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';

import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import type { Editor, EditorLanguage, EditorOptions } from './codemirror';
import styles from './CodeEditor.module.css';

export type { EditorLanguage } from './codemirror';

export interface CodeEditorHandle {
  undo(): void;
  redo(): void;
  focus(): void;
}

export interface CodeEditorProps extends Omit<
  ComponentProps<'div'>,
  'onChange' | 'ref' | 'children'
> {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  /** What it edits, for screen readers: "Code of Tip calculator". */
  label: string;
  /** An element that says what's wrong, read with the editor. */
  describedBy?: string;
  placeholder?: string;
  /** ⌘S (Ctrl+S elsewhere). */
  onSave?: () => void;
  /** Esc. */
  onCancel?: () => void;
  /** Whether there's something to undo or redo, as it changes. */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  ref?: Ref<CodeEditorHandle>;
}

type Loaded = Editor & { update: (next: Partial<EditorOptions>) => void };

/**
 * A code editor (ADR 0046): CodeMirror 6, loaded the first time one opens,
 * with Nacre's colours, line numbers, undo and redo, ⌘S and Esc. Tab moves
 * on, as it does everywhere, so the keyboard is never trapped. If it can't
 * load, a plain text box takes its place: editing never dead-ends.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  describedBy,
  placeholder,
  onSave,
  onCancel,
  onHistoryChange,
  ref,
  className,
  ...props
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Loaded | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'plain'>('loading');
  // The first text and callbacks, for the editor made once below; later ones arrive by `update`.
  const initial = useRef({ value, label, describedBy, placeholder });
  const calls = useRef({ onChange, onSave, onCancel, onHistoryChange });
  useEffect(() => {
    calls.current = { onChange, onSave, onCancel, onHistoryChange };
  });

  useEffect(() => {
    let live = true;
    void import('./codemirror')
      .then(({ createEditor }) => {
        if (!live || !host.current) return;
        const first = initial.current;
        editor.current = createEditor(host.current, {
          doc: first.value,
          language,
          label: first.label,
          describedBy: first.describedBy,
          placeholder: first.placeholder,
          onChange: (doc) => calls.current.onChange(doc),
          onHistory: (h) => calls.current.onHistoryChange?.(h),
          onSave: () => calls.current.onSave?.(),
          onCancel: () => calls.current.onCancel?.(),
        }) as Loaded;
        setState('ready');
      })
      .catch(() => live && setState('plain'));
    return () => {
      live = false;
      editor.current?.destroy();
      editor.current = undefined;
    };
  }, [language]);

  // Text from outside (an edit coming back) replaces what's there; typing doesn't loop back.
  useEffect(() => {
    editor.current?.set(value);
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => editor.current?.undo(),
      redo: () => editor.current?.redo(),
      focus: () => editor.current?.focus(),
    }),
    [],
  );

  return (
    <div className={cx(styles.root, className)} data-state={state} {...props}>
      {state === 'loading' && (
        <div className={styles.loading}>
          <Spinner size="sm" label="Opening the editor…" />
        </div>
      )}
      {state === 'plain' ? (
        <textarea
          className={styles.plain}
          value={value}
          aria-label={label}
          aria-describedby={describedBy}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSave?.();
            } else if (event.key === 'Escape' && onCancel) {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      ) : (
        <div ref={host} className={styles.host} />
      )}
    </div>
  );
}
