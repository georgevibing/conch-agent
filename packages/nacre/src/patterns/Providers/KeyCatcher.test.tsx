import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { KeyCatcher, looksLikeKey, maskKey, type KeyCandidate, type KeyMatch } from './KeyCatcher';

const GROQ: KeyCandidate = { id: 'groq', name: 'Groq', color: '#F55036' };
const DEEPSEEK: KeyCandidate = { id: 'deepseek', name: 'DeepSeek', brand: 'deepseek' };
const KIMI: KeyCandidate = { id: 'moonshot', name: 'Kimi', brand: 'moonshot' };
const OPENAI: KeyCandidate = { id: 'openai', name: 'OpenAI' };
const MISTRAL: KeyCandidate = { id: 'mistral', name: 'Mistral', brand: 'mistral' };

const recognise = (value: string): KeyMatch =>
  value.startsWith('gsk_')
    ? { candidates: [GROQ], sure: true }
    : value.startsWith('sk-')
      ? { candidates: [DEEPSEEK, KIMI], sure: false }
      : /^[A-Za-z0-9]{32}$/.test(value)
        ? { candidates: [MISTRAL], sure: false }
        : { candidates: [], sure: false };

const GROQ_KEY = 'gsk_abcdefghijklmnopqrstuvwx4f2c';

function paste(target: Element | Document, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: () => string };
  };
  event.clipboardData = { getData: () => text };
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('KeyCatcher', () => {
  it('waits as one quiet line, and opens to a field that takes the focus', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <KeyCatcher recognise={recognise} onConnect={async () => {}} />,
    );
    const open = screen.getByRole('button', { name: 'Use an API key instead' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Paste a key')).toBeNull();
    await expectAccessible(container);

    await user.click(open);
    expect(screen.getByLabelText('Paste a key')).toHaveFocus();
    expect(screen.getByText(/anywhere on this page/)).toBeInTheDocument();
  });

  it('opens by itself when a key is pasted on the page', async () => {
    const onConnect = vi.fn(async () => {});
    renderNacre(<KeyCatcher recognise={recognise} onConnect={onConnect} />);
    paste(document.body, GROQ_KEY);
    expect(onConnect).toHaveBeenCalledWith('groq', GROQ_KEY);
    expect(screen.getByRole('button', { name: 'Use an API key instead' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await screen.findByText(/Groq is connected/)).toBeInTheDocument();
  });

  it('knows a key by its shape and checks it with that provider straight away', async () => {
    let finish!: () => void;
    const onConnect = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { container } = renderNacre(
      <KeyCatcher recognise={recognise} onConnect={onConnect} defaultOpen />,
    );

    paste(screen.getByLabelText('Paste a key'), GROQ_KEY);

    expect(onConnect).toHaveBeenCalledWith('groq', GROQ_KEY);
    // Never the key itself: its start and its last four.
    expect(screen.getByText(/Checking gsk_••••4f2c with Groq/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(GROQ_KEY);
    await act(async () => finish());
    expect(await screen.findByText(/Groq is connected/)).toBeInTheDocument();
    expect(screen.getByLabelText('Paste a key')).toHaveValue('');
    await expectAccessible(container);
  });

  it('asks whose it is when keys like it come from more than one place', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn(async () => {});
    renderNacre(<KeyCatcher recognise={recognise} onConnect={onConnect} defaultOpen />);

    paste(screen.getByLabelText('Paste a key'), 'sk-0123456789abcdefghijklmnop');

    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByText(/more than one place. Whose is it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kimi' }));
    expect(onConnect).toHaveBeenCalledWith('moonshot', 'sk-0123456789abcdefghijklmnop');
  });

  it('asks before sending a key whose shape only one provider fits, but whose prefix isn’t theirs', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn(async () => {});
    renderNacre(
      <KeyCatcher
        recognise={recognise}
        all={[OPENAI, GROQ, MISTRAL]}
        onConnect={onConnect}
        defaultOpen
      />,
    );
    const key = 'abcdefghijklmnopqrstuvwxyz012345';

    paste(screen.getByLabelText('Paste a key'), key);

    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByText('This looks like a Mistral key. Is it?')).toBeInTheDocument();
    // Not theirs after all: everyone else, to choose from.
    await user.click(screen.getByRole('button', { name: 'Someone else’s' }));
    expect(screen.getByText('Whose is it?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OpenAI' }));
    expect(onConnect).toHaveBeenCalledWith('openai', key);
  });

  it('offers everyone when it doesn’t know the key at all', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn(async () => {});
    renderNacre(
      <KeyCatcher recognise={recognise} all={[OPENAI, GROQ]} onConnect={onConnect} defaultOpen />,
    );

    await user.type(screen.getByLabelText('Paste a key'), 'abcdefghijklmnopqrstuvwxyz0123');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.getByText(/doesn’t recognise this key. Whose is it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OpenAI' }));
    expect(onConnect).toHaveBeenCalledWith('openai', 'abcdefghijklmnopqrstuvwxyz0123');
  });

  it('says what the provider said when it refuses', async () => {
    const onConnect = vi.fn(async () => {
      throw new Error('Groq refused your key. Check that you copied all of it.');
    });
    renderNacre(<KeyCatcher recognise={recognise} onConnect={onConnect} defaultOpen />);

    paste(screen.getByLabelText('Paste a key'), GROQ_KEY);

    expect(
      await screen.findByText('Groq refused your key. Check that you copied all of it.'),
    ).toBeInTheDocument();
  });

  it('says who didn’t take it when the provider gave no reason', async () => {
    renderNacre(
      <KeyCatcher
        recognise={recognise}
        onConnect={async () => {
          throw new Error('');
        }}
        defaultOpen
      />,
    );
    paste(screen.getByLabelText('Paste a key'), GROQ_KEY);
    expect(await screen.findByText('Groq didn’t take that key.')).toBeInTheDocument();
  });

  it('takes a key pasted anywhere on the page, but not one pasted into another field', async () => {
    const onConnect = vi.fn(async () => {});
    renderNacre(
      <>
        <KeyCatcher recognise={recognise} onConnect={onConnect} />
        <input aria-label="Something else" />
      </>,
    );

    // Into another field: that field's business.
    paste(screen.getByLabelText('Something else'), GROQ_KEY);
    expect(onConnect).not.toHaveBeenCalled();

    // Something that isn't a key Conch knows: left alone.
    expect(paste(document.body, 'hello there').defaultPrevented).toBe(false);
    expect(paste(document.body, 'zzzzzzzzzzzzzzzzzzzzzzzz').defaultPrevented).toBe(false);
    expect(onConnect).not.toHaveBeenCalled();

    // Anywhere else on the page: caught.
    expect(paste(document.body, GROQ_KEY).defaultPrevented).toBe(true);
    expect(onConnect).toHaveBeenCalledWith('groq', GROQ_KEY);
  });

  it('says a key is one word when something else was typed', async () => {
    const user = userEvent.setup();
    renderNacre(<KeyCatcher recognise={recognise} onConnect={async () => {}} defaultOpen />);
    await user.type(screen.getByLabelText('Paste a key'), 'my key is');
    expect(screen.getByText('A key is one long word, with no spaces in it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('only listens to the page when asked to', () => {
    const onConnect = vi.fn(async () => {});
    renderNacre(<KeyCatcher recognise={recognise} onConnect={onConnect} catchPaste={false} />);
    fireEvent(document.body, new Event('paste'));
    paste(document.body, GROQ_KEY);
    expect(onConnect).not.toHaveBeenCalled();
  });
});

describe('key shapes', () => {
  it('tells a key from prose, an address or a short word', () => {
    expect(looksLikeKey(GROQ_KEY)).toBe(true);
    expect(looksLikeKey('AIzaSyD-abcdefghijklmnopqrstuvwxyz012')).toBe(true);
    expect(looksLikeKey('abc.def_ghijklmnop.qrstuvwx')).toBe(true);
    expect(looksLikeKey('short')).toBe(false);
    expect(looksLikeKey('two words here are not a key')).toBe(false);
    expect(looksLikeKey('https://example.com/abcdefghijk')).toBe(false);
  });

  it('shows only the start and the last four', () => {
    expect(maskKey(GROQ_KEY)).toBe('gsk_••••4f2c');
    expect(maskKey('sk-ant-api03-abcdefghijklmnop1234')).toBe('sk-••••1234');
    expect(maskKey('abcdefghijklmnopqrstuvwxyz')).toBe('••••wxyz');
  });
});
