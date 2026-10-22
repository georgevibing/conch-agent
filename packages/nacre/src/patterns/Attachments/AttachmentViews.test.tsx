import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { fileTypeOf } from '../FileMaking/fileKind';
import { AttachmentCard, AttachmentList } from './AttachmentCard';
import { AttachmentPreview } from './AttachmentPreview';
import { badgeOf, familyOf, previewModeOf, typeWordOf, wantsView } from './fileType';
import { notebookView, treeOf, type AttachmentViewData } from './view';

describe('every kind of file has a family', () => {
  it('by its name, and by its type when the name says nothing', () => {
    const cases: [string, string | undefined, string][] = [
      ['Re: launch.eml', undefined, 'email'],
      ['mail', 'message/rfc822', 'email'],
      ['Middlemarch.epub', undefined, 'ebook'],
      ['orders.sqlite', undefined, 'database'],
      ['store', 'application/vnd.sqlite3', 'database'],
      ['Inter.woff2', undefined, 'font'],
      ['glyphs', 'font/otf', 'font'],
      ['Bracket.stl', undefined, 'model'],
      ['Setup.exe', undefined, 'binary'],
      ['tool', 'application/x-mach-binary', 'binary'],
      ['analysis.ipynb', undefined, 'notebook'],
      ['Board pack.odt', undefined, 'doc'],
      ['Letter.rtf', undefined, 'doc'],
      ['old', 'application/msword', 'doc'],
      ['Old budget.xls', undefined, 'sheet'],
      ['Pitch.odp', undefined, 'slides'],
      ['sources.tar.zst', undefined, 'archive'],
      ['take.aiff', undefined, 'audio'],
      ['clip.wmv', undefined, 'video'],
      ['blob', 'application/octet-stream', 'file'],
    ];
    for (const [name, mimeType, family] of cases)
      expect([name, familyOf({ name, mimeType, kind: 'file' })]).toEqual([name, family]);
  });

  it('names each in words, and the sent tile agrees', () => {
    expect(typeWordOf({ name: 'a.dylib', kind: 'file' })).toBe('Library');
    expect(typeWordOf({ name: 'a.dmg', kind: 'file' })).toBe('Disk image');
    expect(typeWordOf({ name: 'a.stl', kind: 'file' })).toBe('3D model');
    expect(badgeOf({ name: 'orders.sqlite', kind: 'file' })).toBe('SQLITE');
    expect(badgeOf({ name: 'mail', kind: 'file', mimeType: 'message/rfc822' })).toBe('Email');
    for (const [name, type] of [
      ['a.eml', 'email'],
      ['a.epub', 'ebook'],
      ['a.db', 'database'],
      ['a.ttf', 'font'],
      ['a.glb', 'model'],
      ['a.exe', 'binary'],
      ['a.ipynb', 'notebook'],
      ['a.ods', 'sheet'],
      ['a.pptm', 'slides'],
      ['a.zst', 'archive'],
    ])
      expect(fileTypeOf({ name: name ?? '', kind: 'file' })).toBe(type);
  });

  it('asks the gateway for what the browser can’t show itself', () => {
    expect(previewModeOf({ name: 'a.docx', kind: 'file' })).toBe('view');
    expect(previewModeOf({ name: 'a.eml', kind: 'text' })).toBe('view');
    expect(previewModeOf({ name: 'a.rtf', kind: 'text' })).toBe('view');
    expect(previewModeOf({ name: 'a.ipynb', kind: 'text' })).toBe('notebook');
    expect(previewModeOf({ name: 'a.md', kind: 'text' })).toBe('code');
    expect(previewModeOf({ name: 'a.pdf', kind: 'file' })).toBe('pdf');
    expect(wantsView({ name: 'a.m4a', kind: 'file', mimeType: 'audio/mp4' })).toBe(true);
    expect(wantsView({ name: 'a.zip', kind: 'file' })).toBe(true);
    expect(wantsView({ name: 'a.csv', kind: 'text' })).toBe(false);
    expect(wantsView({ name: 'a.png', kind: 'image' })).toBe(false);
  });

  it('draws a notebook, an email or an RTF by its glyph, not its source', () => {
    const { container } = renderNacre(
      <AttachmentList>
        <AttachmentCard name="a.ipynb" kind="text" excerpt={'{"cells": []}'} onOpen={() => {}} />
        <AttachmentCard name="a.ts" kind="text" excerpt="const a = 1;" onOpen={() => {}} />
      </AttachmentList>,
    );
    expect(container.textContent).not.toContain('"cells"');
    expect(container.textContent).toContain('const a = 1;');
  });
});

describe('notebooks and trees', () => {
  it('reads a notebook’s notes, code and what it printed, never its HTML', () => {
    const view = notebookView(
      JSON.stringify({
        metadata: { language_info: { name: 'python' } },
        cells: [
          { cell_type: 'markdown', source: ['# Title\n', 'Some **bold** words'] },
          {
            cell_type: 'code',
            source: 'print(1)',
            outputs: [
              { text: ['1\n'] },
              { data: { 'text/html': '<script>x</script>', 'image/png': 'AA' } },
            ],
          },
        ],
      }),
    );
    expect(view?.summary).toBe('A notebook of 2 cells, 1 with code.');
    expect(view?.parts[0]).toEqual({
      kind: 'text',
      blocks: [
        { kind: 'heading', text: 'Title' },
        { kind: 'paragraph', text: 'Some bold words' },
        { kind: 'pre', text: 'print(1)', language: 'python' },
        { kind: 'pre', text: '1\n' },
        { kind: 'quote', text: 'A picture this cell made' },
      ],
    });
    expect(notebookView('{"not": "a notebook"}')).toBeUndefined();
    expect(notebookView('not json')).toBeUndefined();
  });

  it('builds folders from paths, folders first', () => {
    const tree = treeOf([{ path: 'b.txt', size: 3 }, { path: 'docs/a.md' }, { path: 'docs/' }]);
    expect(tree.map((n) => [n.name, n.folder])).toEqual([
      ['docs', true],
      ['b.txt', false],
    ]);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['a.md']);
  });
});

const preview = (
  attachment: Parameters<typeof AttachmentPreview>[0]['attachment'],
  view: AttachmentViewData | null,
  extra = {},
) =>
  renderNacre(
    <AttachmentPreview
      open
      onOpenChange={() => {}}
      attachment={attachment}
      view={view}
      downloadHref="#"
      {...extra}
    />,
  );

describe('AttachmentPreview, from a view', () => {
  it('shows a document’s lines as words, never as markup', async () => {
    const { baseElement } = preview(
      { name: 'Board.docx', kind: 'file', size: 88_000 },
      {
        summary: 'The text of this document, taken out by Conch.',
        parts: [
          {
            kind: 'text',
            title: 'Paragraphs 1–3',
            blocks: [
              { kind: 'heading', text: 'Plan' },
              { kind: 'item', text: 'Ship' },
              { kind: 'paragraph', text: '<img src=x onerror=alert(1)>' },
            ],
          },
        ],
      },
    );
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeVisible();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(baseElement.querySelector('img')).toBeNull();
    expect(screen.getByRole('region', { name: 'Board.docx' })).toHaveAttribute('tabindex', '0');
    await expectAccessible(baseElement);
  });

  it('gives each sheet a tab', async () => {
    const user = userEvent.setup();
    const { baseElement } = preview(
      { name: 'Forecast.xlsx', kind: 'file' },
      {
        parts: [
          { kind: 'table', title: 'Summary', columns: ['A', 'B'], rows: [['Region', 'Q1']] },
          { kind: 'table', title: 'Hiring', columns: ['A'], rows: [['Platform']], total: 900 },
        ],
      },
    );
    expect(screen.getByRole('cell', { name: 'Region' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Hiring' }));
    expect(screen.getByRole('cell', { name: 'Platform' })).toBeVisible();
    expect(screen.getByText('First 1 of 900 rows')).toBeVisible();
    await expectAccessible(baseElement);
  });

  it('opens an archive’s folders, and reads an email apart', async () => {
    const user = userEvent.setup();
    const archive = preview(
      { name: 'a.zip', kind: 'file' },
      {
        summary: 'A ZIP archive of 3 files.',
        parts: [
          {
            kind: 'tree',
            entries: [
              { path: 'docs/deep/a.md', size: 2048 },
              { path: 'docs/c.txt' },
              { path: 'b.txt' },
            ],
          },
        ],
      },
    );
    expect(screen.getByText('A ZIP archive of 3 files.')).toBeVisible();
    const deep = screen.getByText('deep').closest('summary');
    expect(deep?.parentElement).not.toHaveAttribute('open');
    await user.click(deep as HTMLElement);
    expect(deep?.parentElement).toHaveAttribute('open');
    expect(screen.getByText('2 KB')).toBeVisible();
    await expectAccessible(archive.baseElement);
    archive.unmount();

    const email = preview(
      { name: 'a.eml', kind: 'text' },
      {
        parts: [
          {
            kind: 'email',
            headers: [
              { name: 'Subject', value: 'Launch' },
              { name: 'From', value: 'Ada' },
            ],
            body: 'Hi Grace',
            attachments: [{ name: 'deck.pptx', size: 1024 }],
          },
        ],
      },
    );
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Attached to the email' })).getByText('deck.pptx'),
    ).toBeVisible();
    await expectAccessible(email.baseElement);
  });

  it('plays a recording from the time a line was said', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { baseElement } = preview(
      { name: 'talk.m4a', kind: 'file', mimeType: 'audio/mp4' },
      {
        parts: [
          {
            kind: 'transcript',
            segments: [
              { start: 0, text: 'Hi.' },
              { start: 600, text: 'Later.' },
            ],
          },
        ],
      },
      { src: 'data:audio/mp4;base64,AA' },
    );
    await user.click(screen.getByRole('button', { name: 'Play from 10:00' }));
    expect(baseElement.querySelector('audio')?.currentTime).toBe(600);
    expect(play).toHaveBeenCalled();
    await expectAccessible(baseElement);
    play.mockRestore();
  });

  it('says it’s listening while a recording is heard', () => {
    preview({ name: 'talk.m4a', kind: 'file', mimeType: 'audio/mp4' }, null, {
      src: 'data:audio/mp4;base64,AA',
      view: undefined,
      viewLoading: true,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Listening');
  });

  it('says what a file is when there’s nothing more to show', async () => {
    const { baseElement, rerender } = preview(
      { name: 'Setup.exe', kind: 'file', size: 8_400_000 },
      { summary: 'A Windows program for 64-bit processors.', parts: [] },
    );
    expect(screen.getByText('A Windows program for 64-bit processors.')).toBeVisible();
    expect(screen.getByText('Program')).toBeVisible();
    await expectAccessible(baseElement);
    rerender(
      <AttachmentPreview
        open
        onOpenChange={() => {}}
        attachment={{ name: 'x.stl', kind: 'file' }}
        view={null}
      />,
    );
    expect(screen.getByText(/no preview for this kind of file/)).toBeVisible();
    expect(screen.getByText('3D model')).toBeVisible();
  });

  it('shows a text email as text when nothing could read it', () => {
    preview({ name: 'a.eml', kind: 'text' }, null, { text: 'From: Ada\n\nHi' });
    expect(screen.getByRole('region', { name: 'a.eml' })).toHaveTextContent('From: Ada');
  });
});
