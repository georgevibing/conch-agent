import { NacreProvider } from '@conch/nacre';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

const FILE = 'apps/docs/content/start/install.md';

function draw(source: string, file = FILE) {
  return render(
    <NacreProvider scope="local">
      <MemoryRouter>
        <Markdown source={source} file={file} />
      </MemoryRouter>
    </NacreProvider>,
  );
}

describe('Markdown', () => {
  it('gives every heading the anchor GitHub would, and a link to itself', () => {
    draw('## Update or remove\n\nWords.\n\n## Update or remove\n');
    const [first, second] = screen.getAllByRole('heading', { level: 2 });
    expect(first).toHaveAttribute('id', 'update-or-remove');
    expect(second).toHaveAttribute('id', 'update-or-remove-1');
    expect(within(first as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '#update-or-remove',
    );
  });

  it('never draws a second top heading: the title is the page’s', () => {
    draw('# The browser\n\nWords.');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /The browser/ })).toBeInTheDocument();
  });

  it('draws a numbered list as steps, and keeps a sentence with bold words on one line', () => {
    draw('1. Adds **Conch** to your apps.\n2. Opens it.\n');
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('Adds Conch to your apps.');
  });

  it('makes a one-line terminal command ready to copy, and leaves longer code as code', () => {
    draw('```bash\npnpm start\n```\n\n```bash\npnpm install\npnpm start\n```\n');
    expect(screen.getByRole('group', { name: 'Command' })).toHaveTextContent('pnpm start');
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  it('opens a link to another page’s file as that page, and any other file on GitHub', () => {
    draw('[first chat](./first-chat.md) and [the code](../../../server/src/cli.ts)');
    expect(screen.getByRole('link', { name: 'first chat' })).toHaveAttribute(
      'href',
      '/start/first-chat',
    );
    const code = screen.getByRole('link', { name: 'the code' });
    expect(code).toHaveAttribute(
      'href',
      expect.stringContaining('/blob/main/apps/server/src/cli.ts'),
    );
    expect(code).toHaveAttribute('target', '_blank');
  });

  it('resolves links the way the file they came from reads them', () => {
    draw(
      '[decision](./adr/0018-channels.md) and [design](../ARCHITECTURE.md#security-model)',
      'docs/SECURITY.md',
    );
    expect(screen.getByRole('link', { name: 'decision' })).toHaveAttribute(
      'href',
      '/decisions/0018-channels',
    );
    expect(screen.getByRole('link', { name: 'design' })).toHaveAttribute(
      'href',
      '/project/architecture#security-model',
    );
  });

  it('draws keys as keycaps, and a note as a callout', () => {
    const { container } = draw('Press <kbd>mod+k</kbd>.\n\n> [!NOTE]\n> Only once.\n');
    const caps = [...container.querySelectorAll('kbd')].map((key) => key.textContent);
    expect(caps).toHaveLength(2);
    expect(caps[1]).toBe('K');
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Only once.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('[!NOTE]');
  });

  it('puts a generated part where the page asks for it, between the words', () => {
    const { container } = draw('Before.\n\n<!-- conch:cli -->\n\nAfter.\n');
    expect(screen.getAllByRole('term').some((term) => term.textContent === 'status')).toBe(true);
    const text = container.textContent ?? '';
    expect(text.indexOf('Before.')).toBeLessThan(text.indexOf('status'));
    expect(text.indexOf('status')).toBeLessThan(text.indexOf('After.'));
    expect(text).not.toContain('conch:cli');
  });

  it('says so, in the page, when a part doesn’t exist', () => {
    draw('<!-- conch:nonsense -->');
    expect(screen.getByText('There’s no “conch:nonsense”')).toBeInTheDocument();
  });

  it('leaves out raw HTML rather than showing it as text', () => {
    const { container } = draw('Words. <!-- a note to self -->\n\n<div>raw</div>\n');
    expect(container.textContent).not.toContain('note to self');
    expect(container.textContent).not.toContain('<div>');
  });
});
