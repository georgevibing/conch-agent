import {
  ArrowUpRight,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  ImageIcon,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

import { cx } from '../../utils/cx';
import { useNow } from '../Usage/useNow';
import {
  count,
  outside,
  ShowAll,
  useShowAll,
  ViewFrame,
  webLink,
  type ViewFrameProps,
} from './shared';
import { fullWhen, shortWhen, type WhenOptions } from './time';
import styles from './ToolViews.module.css';

/** One file, as a file tool found it. Mirrors `FileItem` in `@conch/protocol`. */
export interface FoundFile {
  name: string;
  /** Its type as the service names it (`application/pdf`, Google's own types). */
  mime?: string;
  /** ISO date-time it last changed. */
  modified?: string;
  owner?: string;
  url?: string;
}

export type FoundFileKind = 'doc' | 'sheet' | 'slides' | 'pdf' | 'image' | 'folder' | 'other';

const SHEET = /spreadsheet|ms-excel|\/csv|numbers/;
const SLIDES = /presentation|powerpoint|keynote/;
const DOC = /document|msword|text\/plain|rtf|opendocument\.text|pages/;

/** What kind of file it is, from its type, or its name when the type says nothing. */
export function fileKindOf(file: Pick<FoundFile, 'name' | 'mime'>): FoundFileKind {
  const mime = (file.mime ?? '').toLowerCase();
  if (mime.endsWith('.folder') || mime === 'inode/directory') return 'folder';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/') || mime.endsWith('.drawing')) return 'image';
  if (SHEET.test(mime)) return 'sheet';
  if (SLIDES.test(mime)) return 'slides';
  if (DOC.test(mime)) return 'doc';
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['pptx', 'ppt', 'odp', 'key'].includes(ext)) return 'slides';
  if (['docx', 'doc', 'txt', 'md', 'rtf', 'odt', 'pages'].includes(ext)) return 'doc';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image';
  return 'other';
}

const GLYPHS: Record<FoundFileKind, LucideIcon> = {
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  pdf: FileText,
  image: ImageIcon,
  folder: Folder,
  other: File,
};

const KIND_WORDS: Record<FoundFileKind, string> = {
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Slides',
  pdf: 'PDF',
  image: 'Picture',
  folder: 'Folder',
  other: 'File',
};

export interface FileListProps extends Omit<ViewFrameProps, 'label' | 'heading'>, WhenOptions {
  files: FoundFile[];
  /** "Files": what it's called for screen readers. */
  label?: string;
}

/**
 * Files a search found (ADR 0060): what kind each is, its name, whose it is
 * and when it changed. A row opens the file in a new tab.
 */
export function FileList({
  files,
  label = 'Files',
  now: nowProp,
  locale,
  timeZone,
  className,
  ...props
}: FileListProps) {
  const now = useNow(60_000, nowProp);
  const options: WhenOptions = { now, locale, timeZone };
  const { folded, showAll, limit } = useShowAll(files.length);
  const shown = folded ? files.slice(0, limit) : files;
  return (
    <ViewFrame
      label={`${label}, ${count(files.length, 'file')}`}
      className={cx(styles.files, className)}
      {...props}
    >
      {files.length === 0 ? (
        <p className={styles.empty}>No files found.</p>
      ) : (
        <ul className={styles.rows}>
          {shown.map((f, i) => {
            const kind = fileKindOf(f);
            const Glyph = GLYPHS[kind];
            const url = webLink(f.url);
            const inner = (
              <>
                <span className={styles.fileIcon} data-kind={kind}>
                  <Glyph role="img" aria-label={KIND_WORDS[kind]} />
                </span>
                <span className={styles.fileText}>
                  <span className={styles.fileName}>{f.name}</span>
                  {(f.owner || f.modified) && (
                    <span className={styles.meta}>
                      <span className={styles.metaText}>
                        {f.owner}
                        {f.owner && f.modified && ' · '}
                        {f.modified && (
                          <time dateTime={f.modified} title={fullWhen(f.modified, options)}>
                            {shortWhen(f.modified, options)}
                          </time>
                        )}
                      </span>
                    </span>
                  )}
                </span>
                {url && <ArrowUpRight aria-hidden className={styles.open} />}
              </>
            );
            return (
              <li key={`${f.name}${i}`}>
                {url ? (
                  <a className={styles.fileRow} href={url} {...outside} data-lustre="">
                    {inner}
                  </a>
                ) : (
                  <span className={styles.fileRow}>{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {folded && <ShowAll onClick={showAll}>Show all {count(files.length, 'file')}</ShowAll>}
    </ViewFrame>
  );
}
