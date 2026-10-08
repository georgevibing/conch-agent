import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ImageMaking } from './ImageMaking';
import { leftWords, parseAspect, secondsLeft } from './time';

const src = 'data:image/png;base64,iVBORw0KGgo=';

describe('ImageMaking', () => {
  it('holds the picture’s shape while it is made, and says how far it got', async () => {
    const { container } = renderNacre(
      <ImageMaking
        state="making"
        title="Dunes at dusk"
        aspect="3:2"
        progress={0.42}
        stage="generating"
        secondsLeft={14}
        by="OpenAI"
      />,
    );
    const figure = container.querySelector('figure');
    expect(figure).toHaveAttribute('aria-busy', 'true');
    expect(figure?.style.getPropertyValue('--im-ratio')).toBe('1.5');
    const bar = screen.getByRole('progressbar', { name: 'Making the picture' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42%, about 14s left');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('with OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Dunes at dusk')).toBeInTheDocument();
    // No actions or raw details while it's being made.
    expect(screen.queryByRole('button', { name: /download|copy|details/i })).toBeNull();
    await expectAccessible(container);
  });

  it('has no number when the provider can’t say, and never claims 100%', () => {
    const { rerender } = renderNacre(<ImageMaking state="making" title="Dunes" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Making it…')).toBeInTheDocument();
    rerender(<ImageMaking state="making" title="Dunes" editing stage="queued" progress={0} />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    rerender(<ImageMaking state="making" title="Dunes" progress={1} stage="finishing" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
  });

  it('shows a partial picture softly, as decoration', () => {
    const { container } = renderNacre(
      <ImageMaking state="making" title="Dunes" progress={0.6} preview={src} />,
    );
    const preview = container.querySelector('img');
    expect(preview).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('develops when it becomes ready while watched, and says so', () => {
    const { container, rerender } = renderNacre(
      <ImageMaking state="making" title="Dunes" progress={0.9} />,
    );
    rerender(<ImageMaking state="ready" title="Dunes" src={src} />);
    const img = screen.getByRole('img', { name: 'Dunes' });
    fireEvent.load(img);
    const figure = container.querySelector('figure');
    expect(figure).toHaveAttribute('data-develop');
    expect(screen.getByRole('status')).toHaveTextContent('Picture ready');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a picture already there just shows: no develop', () => {
    const { container } = renderNacre(<ImageMaking state="ready" title="Dunes" src={src} />);
    fireEvent.load(screen.getByRole('img', { name: 'Dunes' }));
    expect(container.querySelector('figure')).toHaveAttribute('data-shown');
    expect(container.querySelector('figure')).not.toHaveAttribute('data-develop');
  });

  it('is a quiet card once ready: look closer, download, copy, change, details', async () => {
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    const onEdit = vi.fn();
    const { container } = renderNacre(
      <ImageMaking
        state="ready"
        title="Dunes at dusk"
        alt="Sand dunes at dusk"
        src={src}
        downloadHref="/api/attachments/a1?download=1"
        downloadName="Dunes at dusk.png"
        prompt="Dunes at dusk, cinematic"
        details={[{ label: 'Model', value: 'Gemini 2.5 Flash Image' }]}
        onOpen={onOpen}
        onCopy={onCopy}
        onEdit={onEdit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Look closer at Dunes at dusk' }));
    await userEvent.click(screen.getByRole('button', { name: 'Look closer' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    const download = screen.getByRole('link', { name: 'Download Dunes at dusk' });
    expect(download).toHaveAttribute('href', '/api/attachments/a1?download=1');
    expect(download).toHaveAttribute('download', 'Dunes at dusk.png');
    await userEvent.click(screen.getByRole('button', { name: 'Copy picture' }));
    expect(onCopy).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change it' }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByText('Dunes at dusk, cinematic')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Dunes at dusk, cinematic')).toBeVisible();
    expect(screen.getByText('Gemini 2.5 Flash Image')).toBeVisible();
    await expectAccessible(container);
  });

  it('says plainly when the picture is gone', () => {
    renderNacre(<ImageMaking state="ready" title="Dunes" src={src} onOpen={() => {}} />);
    fireEvent.error(screen.getByRole('img', { name: 'Dunes' }));
    expect(screen.getByText(/Couldn’t load the picture/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Look closer/ })).toBeNull();
  });

  it.each([
    ['declined', undefined, 'Not made — you said no'],
    ['failed', 'OpenRouter is out of credit.', 'Couldn’t make it: OpenRouter is out of credit.'],
    ['stopped', undefined, 'Stopped before it was made'],
  ] as const)('not made (%s) is a calm line, never a frame', async (state, reason, words) => {
    const { container } = renderNacre(
      <ImageMaking state={state} title="Dunes" reason={reason} prompt="Dunes at dusk" />,
    );
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('time', () => {
  it('reads aspects, square when unknown', () => {
    expect(parseAspect('3:2')).toBe(1.5);
    expect(parseAspect('9:16')).toBeCloseTo(0.5625);
    expect(parseAspect(undefined)).toBe(1);
    expect(parseAspect('wide')).toBe(1);
    expect(parseAspect(10)).toBe(2.4);
  });

  it('estimates time left only once there is enough behind it', () => {
    expect(secondsLeft(0.05, 10_000)).toBeUndefined();
    expect(secondsLeft(0.5, 1000)).toBeUndefined();
    expect(secondsLeft(0.5, 10_000)).toBe(10);
    expect(secondsLeft(1, 10_000)).toBeUndefined();
    expect(leftWords(1)).toBe('almost done');
    expect(leftWords(14)).toBe('about 14s left');
    expect(leftWords(130)).toBe('about 2 min left');
  });
});
