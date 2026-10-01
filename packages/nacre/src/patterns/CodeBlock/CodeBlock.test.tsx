import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CodeBlock, InlineCode, parseLineRanges } from './CodeBlock';
import { normalizeLanguage } from './highlight';

const code = 'const a = 1;\nconst b = 2;\nexport { a, b };';

describe('CodeBlock', () => {
  it('renders plain code immediately and is accessible', async () => {
    const { container } = renderNacre(<CodeBlock code={code} language="ts" filename="a.ts" />);
    expect(screen.getByRole('group', { name: 'Code: a.ts' })).toHaveTextContent('const b = 2;');
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('highlights lazily with CSS-variable colours', async () => {
    const { container } = renderNacre(<CodeBlock code={code} language="ts" />);
    await waitFor(
      () => expect(container.querySelector('[style*="--shiki-token-keyword"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(screen.getByRole('group')).toHaveTextContent('export { a, b };');
  }, 15_000);

  it('copies the code and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderNacre(<CodeBlock code={code} language="ts" />);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith(code);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('toggles line wrapping', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<CodeBlock code={code} />);
    const toggle = screen.getByRole('button', { name: 'Wrap lines' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(container.querySelector('figure')).toHaveAttribute('data-wrap');
    expect(screen.getByRole('button', { name: 'Disable line wrap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('collapses long code behind an expander', async () => {
    const user = userEvent.setup();
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const { container } = renderNacre(<CodeBlock code={long} maxLines={10} />);
    const expander = screen.getByRole('button', { name: 'Show 20 more lines' });
    expect(expander).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('figure')).toHaveAttribute('data-collapsed');
    await user.click(expander);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(container.querySelector('figure')).not.toHaveAttribute('data-collapsed');
  });

  it('marks highlighted lines', () => {
    const { container } = renderNacre(<CodeBlock code={code} highlight="2-3" header={false} />);
    expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders inline code', () => {
    renderNacre(<InlineCode>pnpm dev</InlineCode>);
    expect(screen.getByText('pnpm dev').tagName).toBe('CODE');
  });
});

describe('helpers', () => {
  it('parses line ranges', () => {
    expect([...parseLineRanges('1,3-5, 9')]).toEqual([1, 3, 4, 5, 9]);
    expect([...parseLineRanges([2, 4])]).toEqual([2, 4]);
    expect(parseLineRanges(undefined).size).toBe(0);
  });

  it('normalises language aliases', () => {
    expect(normalizeLanguage('TS')).toBe('typescript');
    expect(normalizeLanguage('sh')).toBe('bash');
    expect(normalizeLanguage(undefined)).toBe('text');
  });
});
