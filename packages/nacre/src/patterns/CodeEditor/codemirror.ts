/**
 * CodeMirror 6, set up the Nacre way (ADR 0046). Loaded only when someone
 * edits something: this module and its languages are a chunk of their own.
 *
 * - Colours are Nacre's: every highlight is a `var(--ce-*)` that
 *   CodeEditor.module.css maps onto the same palette CodeBlock uses, so
 *   light, dark and the accent follow without rebuilding the editor.
 * - Undo and redo are CodeMirror's history; ⌘S saves and Esc cancels.
 * - Tab moves focus on, as everywhere else: the editor never traps it.
 */
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

export type EditorLanguage = 'html' | 'markdown' | 'json' | 'csv' | 'xml' | 'mermaid' | 'text';

/** A table: the header row stands out, quotes are text, numbers are numbers. */
const csv: StreamParser<{ line: number }> = {
  name: 'csv',
  startState: () => ({ line: 0 }),
  blankLine: (state) => {
    state.line++;
  },
  token(stream, state) {
    const header = state.line === 0;
    let style: string | null;
    if (stream.match(/^"(?:[^"]|"")*"?/)) style = header ? 'heading' : 'string';
    else if (stream.match(/^[,;\t]/)) style = 'punctuation';
    else if (stream.match(/^\s*-?\d[\d.]*\s*(?=[,;\t]|$)/)) style = header ? 'heading' : 'number';
    else {
      if (!stream.match(/^[^,;\t"]+/)) stream.next();
      style = header ? 'heading' : null;
    }
    if (stream.eol()) state.line++;
    return style;
  },
};

const MERMAID_WORDS =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|timeline|mindmap|gitGraph|quadrantChart|participant|actor|loop|alt|else|opt|par|and|end|note|over|section|title|subgraph|direction|class|state|TB|TD|BT|RL|LR)\b/;

/** Mermaid: its words, its arrows, its labels and its comments. */
const mermaid: StreamParser<null> = {
  name: 'mermaid',
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(MERMAID_WORDS)) return 'keyword';
    if (stream.match(/^(?:<?[-=.]+>{1,2}|--[ox]|-[-.]+|==+|::)/)) return 'operator';
    if (stream.match(/^\[[^\]]*\]?|^\([^)]*\)?|^\{[^}]*\}?|^"[^"]*"?/)) return 'string';
    if (stream.match(/^\|[^|]*\|?/)) return 'string';
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';
    stream.next();
    return null;
  },
};

function language(name: EditorLanguage): Extension {
  switch (name) {
    case 'html':
      return html();
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'csv':
      return StreamLanguage.define(csv);
    case 'mermaid':
      return StreamLanguage.define(mermaid);
    case 'text':
      return [];
  }
}

const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--ce-keyword)' },
  { tag: [tags.tagName, tags.heading], color: 'var(--ce-keyword)', fontWeight: '600' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--ce-function)' },
  { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: 'var(--ce-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--ce-constant)' },
  { tag: [tags.comment, tags.meta], color: 'var(--ce-comment)', fontStyle: 'italic' },
  {
    tag: [tags.punctuation, tags.bracket, tags.angleBracket, tags.separator],
    color: 'var(--ce-punctuation)',
  },
  { tag: [tags.operator, tags.variableName], color: 'var(--ce-parameter)' },
  { tag: [tags.link, tags.url], color: 'var(--ce-link)', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.invalid, color: 'var(--ce-invalid)' },
]);

/** The editor in Nacre's clothes: everything from tokens, set in CodeEditor.module.css. */
const look = EditorView.theme({
  '&': { color: 'var(--nc-text)', backgroundColor: 'transparent', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--nc-font-mono)',
    fontSize: 'var(--ce-font)',
    lineHeight: 'var(--ce-leading)',
  },
  '.cm-content': { caretColor: 'var(--nc-accent-11)', padding: 'var(--ce-pad-y) 0' },
  '.cm-line': { padding: '0 var(--ce-pad-x)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--nc-accent-11)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--nc-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--ce-active)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--nc-text-subtle)',
    border: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--nc-text-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--nc-space-2) 0 var(--nc-space-3)' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--ce-active)',
    outline: '1px solid var(--nc-border)',
  },
  '.cm-placeholder': { color: 'var(--nc-text-subtle)' },
});

export interface EditorOptions {
  doc: string;
  language: EditorLanguage;
  label: string;
  describedBy?: string;
  placeholder?: string;
  onChange: (doc: string) => void;
  onHistory: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onSave?: () => void;
  onCancel?: () => void;
}

export interface Editor {
  view: EditorView;
  /** Replace the whole text (a draft coming back), as one step you can undo. */
  set(doc: string): void;
  undo(): void;
  redo(): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  // The latest callbacks, without rebuilding the editor when they change.
  const calls = { ...options };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        language(options.language),
        syntaxHighlighting(colours),
        look,
        ...(options.placeholder ? [placeholderText(options.placeholder)] : []),
        EditorView.contentAttributes.of({
          'aria-label': options.label,
          ...(options.describedBy && { 'aria-describedby': options.describedBy }),
        }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              calls.onSave?.();
              return true;
            },
          },
          {
            key: 'Escape',
            run: () => {
              if (!calls.onCancel) return false;
              calls.onCancel();
              return true;
            },
          },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) calls.onChange(update.state.doc.toString());
          if (update.docChanged || update.transactions.length)
            calls.onHistory({
              canUndo: undoDepth(update.state) > 0,
              canRedo: redoDepth(update.state) > 0,
            });
        }),
      ],
    }),
  });
  return Object.assign(
    {
      view,
      set(doc: string) {
        if (doc === view.state.doc.toString()) return;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
      },
      undo: () => void undo(view),
      redo: () => void redo(view),
      focus: () => view.focus(),
      destroy: () => view.destroy(),
    },
    {
      /** Keep the callbacks current (the component calls this as it renders). */
      update: (next: Partial<EditorOptions>) => Object.assign(calls, next),
    },
  );
}
