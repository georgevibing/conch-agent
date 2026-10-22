import { ChevronRight, File, Folder, Paperclip } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';

import { Tabs } from '../../components/Tabs';
import { CodeBlock } from '../CodeBlock';
import styles from './Attachments.module.css';
import { formatBytes } from './fileType';
import {
  clockOf,
  treeOf,
  type AttachmentViewBlock,
  type AttachmentViewData,
  type AttachmentViewPart,
  type TreeNode,
} from './view';

const count = new Intl.NumberFormat();
/** Past this many rows a table shows the first ones and counts the rest. */
const SHOWN_ROWS = 500;
/** Past this many files a tree shows the first ones. */
const SHOWN_ENTRIES = 3000;

/** A table: a header, numbered rows, every cell's whole value on hover. */
export function GridTable({
  head,
  rows,
  label,
  inline,
}: {
  head: string[];
  rows: string[][];
  label: string;
  /** Inside a scrolling view: it scrolls sideways only. */
  inline?: boolean;
}) {
  return (
    <div
      className={inline ? styles.tableInline : styles.tableWrap}
      // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.rowNumber}>
              <span className="nc-visually-hidden">Row</span>
            </th>
            {head.map((cell, i) => (
              <th key={i} scope="col" title={cell}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOWN_ROWS).map((row, r) => (
            <tr key={r}>
              <td className={styles.rowNumber}>{r + 1}</td>
              {head.map((_, i) => (
                <td key={i} title={row[i]}>
                  {row[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Consecutive items are one list; everything else is its own line. */
function Blocks({ blocks }: { blocks: AttachmentViewBlock[] }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind === 'item') {
      const items: AttachmentViewBlock[] = [];
      while (blocks[i]?.kind === 'item') items.push(blocks[i++] as AttachmentViewBlock);
      i--;
      out.push(
        <ul key={i} className={styles.docList}>
          {items.map((item, j) => (
            <li key={j}>{item.text}</li>
          ))}
        </ul>,
      );
    } else if (block.kind === 'heading')
      out.push(
        <h4 key={i} className={styles.docHeading}>
          {block.text}
        </h4>,
      );
    else if (block.kind === 'quote')
      out.push(
        <blockquote key={i} className={styles.docQuote}>
          {block.text}
        </blockquote>,
      );
    else if (block.kind === 'pre')
      out.push(
        block.language ? (
          <div key={i} className={styles.docCode}>
            <CodeBlock code={block.text.replace(/\n$/, '')} language={block.language} />
          </div>
        ) : (
          <pre key={i} className={styles.docPre}>
            {block.text}
          </pre>
        ),
      );
    else
      out.push(
        <p key={i} className={styles.docParagraph}>
          {block.text}
        </p>,
      );
  }
  return <>{out}</>;
}

function TreeItems({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <ul className={styles.tree} data-depth={depth}>
      {nodes.map((node) => {
        return node.folder ? (
          <li key={node.path}>
            <details open={depth < 1 || nodes.length === 1}>
              <summary className={styles.treeRow}>
                <ChevronRight className={styles.treeChevron} aria-hidden />
                <Folder className={styles.treeGlyph} aria-hidden />
                <span className={styles.treeName}>{node.name}</span>
                <span className={styles.treeSize}>
                  {count.format(node.children.length)}{' '}
                  {node.children.length === 1 ? 'item' : 'items'}
                </span>
              </summary>
              <TreeItems nodes={node.children} depth={depth + 1} />
            </details>
          </li>
        ) : (
          <li key={node.path} className={styles.treeRow} data-file="">
            <File className={styles.treeGlyph} aria-hidden />
            <span className={styles.treeName}>{node.name}</span>
            {node.size !== undefined && (
              <span className={styles.treeSize}>{formatBytes(node.size)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Email({ part }: { part: Extract<AttachmentViewPart, { kind: 'email' }> }) {
  const subject = part.headers.find((h) => /^subject$/i.test(h.name))?.value;
  const rest = part.headers.filter((h) => !/^subject$/i.test(h.name));
  return (
    <article className={styles.email} aria-label={subject ? `Email: ${subject}` : 'Email'}>
      {subject && <h3 className={styles.emailSubject}>{subject}</h3>}
      {rest.length > 0 && (
        <dl className={styles.facts}>
          {rest.map((h, i) => (
            <Fragment key={i}>
              <dt>{h.name}</dt>
              <dd>{h.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {part.body && <div className={styles.emailBody}>{part.body}</div>}
      {part.attachments.length > 0 && (
        <ul className={styles.emailFiles} aria-label="Attached to the email">
          {part.attachments.map((a, i) => (
            <li key={i} className={styles.emailFile}>
              <Paperclip aria-hidden />
              <span className={styles.treeName}>{a.name}</span>
              {a.size !== undefined && (
                <span className={styles.treeSize}>{formatBytes(a.size)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Transcript({
  part,
  onSeek,
}: {
  part: Extract<AttachmentViewPart, { kind: 'transcript' }>;
  onSeek?: (seconds: number) => void;
}) {
  return (
    <ol className={styles.transcript} aria-label={part.title ?? 'What’s said'}>
      {part.segments.map((s, i) => (
        <li key={i}>
          {s.start !== undefined &&
            (onSeek ? (
              <button
                type="button"
                className={styles.stamp}
                aria-label={`Play from ${clockOf(s.start)}`}
                onClick={() => onSeek(s.start ?? 0)}
              >
                {clockOf(s.start)}
              </button>
            ) : (
              <span className={styles.stamp}>{clockOf(s.start)}</span>
            ))}
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Part({
  part,
  onSeek,
  name,
}: {
  part: AttachmentViewPart;
  onSeek?: (seconds: number) => void;
  name: string;
}) {
  const title = part.title && part.kind !== 'table' && (
    <h3 className={styles.partTitle}>{part.title}</h3>
  );
  let body: ReactNode;
  switch (part.kind) {
    case 'text':
      body = <Blocks blocks={part.blocks} />;
      break;
    case 'table':
      body = (
        <>
          {part.title && <h3 className={styles.partTitle}>{part.title}</h3>}
          <GridTable head={part.columns} rows={part.rows} label={part.title ?? name} inline />
          <RowsNote part={part} />
        </>
      );
      break;
    case 'tree': {
      const total = part.total ?? part.entries.length;
      body = (
        <>
          <TreeItems nodes={treeOf(part.entries.slice(0, SHOWN_ENTRIES))} depth={0} />
          {total > Math.min(part.entries.length, SHOWN_ENTRIES) && (
            <p className={styles.quiet}>
              {count.format(total - Math.min(part.entries.length, SHOWN_ENTRIES))} more not shown
            </p>
          )}
        </>
      );
      break;
    }
    case 'email':
      body = <Email part={part} />;
      break;
    case 'transcript':
      body = <Transcript part={part} onSeek={onSeek} />;
      break;
    case 'facts':
      body = (
        <dl className={styles.facts}>
          {part.facts.map((f, i) => (
            <Fragment key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </Fragment>
          ))}
        </dl>
      );
      break;
  }
  return (
    <section className={styles.part} data-kind={part.kind}>
      {title}
      {body}
    </section>
  );
}

function RowsNote({ part }: { part: Extract<AttachmentViewPart, { kind: 'table' }> }) {
  const shown = Math.min(part.rows.length, SHOWN_ROWS);
  const total = part.total ?? part.rows.length;
  if (total <= shown) return null;
  return (
    <p className={styles.quiet}>
      First {count.format(shown)} of {count.format(total)} rows
    </p>
  );
}

export interface AttachmentViewBodyProps {
  view: AttachmentViewData;
  /** The attachment's name, for the regions' labels. */
  name: string;
  /** Under a player: a recording's words, shorter. */
  under?: boolean;
  /** Play from a time (a transcript's stamps). */
  onSeek?: (seconds: number) => void;
}

/**
 * What the readers made of a file, drawn by Conch: a document's lines, a
 * workbook's sheets as tabs, an archive's folders, an email, a recording's
 * words with their times, a few facts. Only text: nothing in a file can run.
 */
export function AttachmentViewBody({ view, name, under, onSeek }: AttachmentViewBodyProps) {
  const tables = view.parts.filter(
    (p): p is Extract<AttachmentViewPart, { kind: 'table' }> => p.kind === 'table',
  );
  const [sheet, setSheet] = useState('0');
  const head = (view.summary || view.more) && (
    <p className={styles.viewSummary}>
      {view.summary}
      {view.more && (
        <span className={styles.quiet}>
          {view.summary ? ' ' : ''}This shows the start; download it for all of it.
        </span>
      )}
    </p>
  );

  // A workbook (or a database) is its tables: one at a time, a tab each.
  if (tables.length > 1 && tables.length === view.parts.length) {
    const shown = tables[Number(sheet)] ?? tables[0];
    return (
      <div className={styles.view}>
        {head}
        <Tabs value={sheet} onValueChange={setSheet} size="sm" className={styles.sheetTabs}>
          <Tabs.List aria-label="Sheets">
            {tables.map((t, i) => (
              <Tabs.Trigger key={i} value={String(i)}>
                {t.title ?? `Sheet ${i + 1}`}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {shown && (
            <Tabs.Content value={sheet} className={styles.sheetPanel}>
              <GridTable
                head={shown.columns}
                rows={shown.rows}
                label={shown.title ?? `Sheet ${Number(sheet) + 1}`}
              />
              <RowsNote part={shown} />
            </Tabs.Content>
          )}
        </Tabs>
      </div>
    );
  }
  if (tables.length === 1 && view.parts.length === 1 && tables[0]) {
    const only = tables[0];
    return (
      <div className={styles.view}>
        {head}
        <GridTable head={only.columns} rows={only.rows} label={only.title ?? name} />
        <RowsNote part={only} />
      </div>
    );
  }
  return (
    <div className={styles.view}>
      {head}
      {view.parts.length > 0 && (
        <div
          className={styles.viewScroll}
          data-under={under ? '' : undefined}
          // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label={under ? `What’s said in ${name}` : name}
        >
          {view.parts.map((part, i) => (
            <Part key={i} part={part} onSeek={onSeek} name={name} />
          ))}
        </div>
      )}
    </div>
  );
}
