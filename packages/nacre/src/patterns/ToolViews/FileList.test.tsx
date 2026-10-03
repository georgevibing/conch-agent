import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FileList, fileKindOf, type FoundFile } from './FileList';

const now = Date.UTC(2026, 9, 3, 12, 0);
const base = { now, timeZone: 'UTC', locale: 'en-GB' };
const files: FoundFile[] = [
  {
    name: 'Q4 launch deck',
    mime: 'application/vnd.google-apps.presentation',
    modified: '2026-10-03T09:00:00Z',
    owner: 'Ada Lovelace',
    url: 'https://drive.example.org/f/1',
  },
  { name: 'Budget.xlsx', owner: 'Sam' },
];

describe('FileList', () => {
  it('shows each file’s kind, name, owner and date, accessibly', async () => {
    const { container } = renderNacre(<FileList {...base} files={files} />);
    expect(screen.getByRole('region', { name: 'Files, 2 files' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Q4 launch deck/ });
    expect(link).toHaveTextContent('Ada Lovelace · 09:00');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('img', { name: 'Slides' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Spreadsheet' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('knows a file’s kind from its type, or its name', () => {
    expect(fileKindOf({ name: 'x', mime: 'application/vnd.google-apps.document' })).toBe('doc');
    expect(fileKindOf({ name: 'x', mime: 'application/vnd.google-apps.spreadsheet' })).toBe(
      'sheet',
    );
    expect(
      fileKindOf({
        name: 'x',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe('slides');
    expect(
      fileKindOf({
        name: 'x',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('doc');
    expect(fileKindOf({ name: 'x', mime: 'application/vnd.google-apps.folder' })).toBe('folder');
    expect(fileKindOf({ name: 'x', mime: 'application/pdf' })).toBe('pdf');
    expect(fileKindOf({ name: 'x', mime: 'image/png' })).toBe('image');
    expect(fileKindOf({ name: 'notes.MD' })).toBe('doc');
    expect(fileKindOf({ name: 'scan.pdf', mime: 'application/octet-stream' })).toBe('pdf');
    expect(fileKindOf({ name: 'thing' })).toBe('other');
  });

  it('folds after six, from the keyboard too, and says when nothing matched', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `File ${i + 1}` }));
    const { unmount } = renderNacre(<FileList {...base} files={many} />);
    expect(screen.queryByText('File 8')).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Show all 8 files' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByText('File 8')).toBeInTheDocument();
    unmount();
    renderNacre(<FileList {...base} files={[]} />);
    expect(screen.getByText('No files found.')).toBeInTheDocument();
  });

  it('never links somewhere that isn’t the web', () => {
    renderNacre(<FileList {...base} files={[{ name: 'x', url: 'file:///etc/passwd' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
