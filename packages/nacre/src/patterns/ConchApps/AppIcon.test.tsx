import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AppIcon } from './AppIcon';
import { samplePictures } from './fixtures';

const tile = () => screen.getByRole('img', { name: 'Yoga' });
const picture = (container: HTMLElement) => container.querySelector('img');

describe('AppIcon', () => {
  it('is its glyph on its colour, named for screen readers', async () => {
    const { container } = renderNacre(<AppIcon glyph="heart" color="pink" label="Yoga" />);
    expect(tile()).toHaveAttribute('data-app-color', 'pink');
    expect(tile().querySelector('svg')).not.toBeNull();
    expect(picture(container)).toBeNull();
    await expectAccessible(container);
  });

  it('shows its picture once it has loaded, over the glyph that was there first', async () => {
    const { container } = renderNacre(
      <AppIcon glyph="heart" color="pink" label="Yoga" src={samplePictures.sunrise} />,
    );
    const img = picture(container);
    expect(img).not.toBeNull();
    // Decorative: the tile carries the name.
    expect(img).toHaveAttribute('alt', '');
    // Until it loads, the glyph is what shows.
    expect(tile().querySelector('svg')).not.toBeNull();
    expect(tile()).not.toHaveAttribute('data-picture');
    fireEvent.load(img as HTMLImageElement);
    expect(tile()).toHaveAttribute('data-picture');
    await expectAccessible(container);
  });

  it('keeps its glyph when the picture can’t be drawn, and tries a new picture again', () => {
    const { container, rerender } = renderNacre(
      <AppIcon glyph="heart" color="pink" label="Yoga" src={samplePictures.broken} />,
    );
    fireEvent.error(picture(container) as HTMLImageElement);
    expect(picture(container)).toBeNull();
    expect(tile()).not.toHaveAttribute('data-picture');
    expect(tile().querySelector('svg')).not.toBeNull();
    rerender(<AppIcon glyph="heart" color="pink" label="Yoga" src={samplePictures.blossom} />);
    expect(picture(container)).toHaveAttribute('src', samplePictures.blossom);
  });
});
