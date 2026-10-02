import { Code2, Eye, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { IconButton } from '../../components/IconButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import { CodeEditor, type CodeEditorHandle } from '../CodeEditor';
import styles from './Artifacts.module.css';
import { ARTIFACT_KINDS, type ArtifactKindName } from './kinds';

export interface ArtifactEditorProps extends Omit<ComponentProps<'div'>, 'onChange' | 'title'> {
  kind: ArtifactKindName;
  /** The thing's name, for the editor's label: "Code of Tip calculator". */
  title: string;
  value: string;
  onChange: (value: string) => void;
  /** The thing as it is now, drawn by the app from what's typed (debounced). */
  preview: ReactNode;
  /** What's wrong, in plain words: it won't save until it's fixed. */
  problem?: string;
  /** Something changed since it opened. */
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  /** Esc, or Cancel: the app asks first when there's something to lose. */
  onCancel: () => void;
  /** Said above the editor: a newer version arrived, or your unsaved edit came back. */
  notice?: ReactNode;
  /**
   * `split` puts the code beside the preview; `switch` shows one at a time
   * (a phone, a narrow panel). `auto` picks by the room it has.
   */
  layout?: 'auto' | 'split' | 'switch';
}

/** Wide enough for code and preview side by side. */
const SPLIT_AT = 760;

/**
 * Editing something by hand (ADR 0039): its code in a proper editor, and
 * beside it (or a press away, when there's no room) the thing itself,
 * redrawn as you type. Undo and redo, ⌘S saves, Esc cancels; a problem is
 * said in plain words, and Save waits until it's fixed.
 */
export function ArtifactEditor({
  kind,
  title,
  value,
  onChange,
  preview,
  problem,
  dirty,
  saving,
  onSave,
  onCancel,
  notice,
  layout = 'auto',
  className,
  ...props
}: ArtifactEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const problemId = useId();
  const [wide, setWide] = useState(false);
  const [show, setShow] = useState<'code' | 'preview'>('code');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const split = layout === 'split' || (layout === 'auto' && wide);

  useEffect(() => {
    const el = root.current;
    if (!el || layout !== 'auto' || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= SPLIT_AT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);

  const save = () => {
    if (!problem && dirty && !saving) onSave();
  };
  // ⌘S and Esc from anywhere in it, not only the code. Caught before anything
  // else hears them, so Esc cancels the edit rather than closing a sheet it's in,
  // and ⌘S never saves twice (or the page, as the browser would).
  const keys = useRef({ save, onCancel });
  useEffect(() => {
    keys.current = { save, onCancel };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) return;
      const saving = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
      if (!saving && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (saving) keys.current.save();
      else keys.current.onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      ref={root}
      className={cx(styles.editor, className)}
      data-layout={split ? 'split' : 'switch'}
      data-editing
      {...props}
    >
      <div className={styles.editorBar} role="toolbar" aria-label="Editing">
        {!split && (
          <SegmentedControl
            size="sm"
            aria-label="Show"
            value={show}
            onValueChange={(v) => v && setShow(v as 'code' | 'preview')}
          >
            <SegmentedControl.Item value="code" icon={<Code2 />}>
              Edit
            </SegmentedControl.Item>
            <SegmentedControl.Item value="preview" icon={<Eye />}>
              Preview
            </SegmentedControl.Item>
          </SegmentedControl>
        )}
        <IconButton
          size="sm"
          label="Undo"
          shortcut="mod+z"
          disabled={!history.canUndo}
          onClick={() => editor.current?.undo()}
        >
          <Undo2 />
        </IconButton>
        <IconButton
          size="sm"
          label="Redo"
          shortcut="mod+shift+z"
          disabled={!history.canRedo}
          onClick={() => editor.current?.redo()}
        >
          <Redo2 />
        </IconButton>
        <span className={styles.editorState} aria-live="polite">
          {problem ? 'Can’t save yet' : dirty ? 'Unsaved changes' : 'No changes yet'}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="solid"
          loading={saving}
          disabled={!dirty || Boolean(problem)}
          onClick={save}
        >
          Save
        </Button>
      </div>
      {notice}
      {problem && (
        <Callout id={problemId} tone="warning" className={styles.editorProblem}>
          {problem}
        </Callout>
      )}
      <div className={styles.editorPanes}>
        <CodeEditor
          ref={editor}
          className={styles.editorCode}
          hidden={!split && show !== 'code'}
          value={value}
          onChange={onChange}
          language={ARTIFACT_KINDS[kind].editor}
          label={`Code of ${title}`}
          describedBy={problem ? problemId : undefined}
          onSave={save}
          onCancel={onCancel}
          onHistoryChange={setHistory}
        />
        <section
          className={styles.editorPreview}
          aria-label={`Preview of ${title}`}
          hidden={!split && show !== 'preview'}
        >
          {preview}
        </section>
      </div>
    </div>
  );
}
