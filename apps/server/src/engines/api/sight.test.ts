/**
 * How big a picture goes to each model (ADR 0070): never past what it reads,
 * so the provider never scales it (or refuses it) behind Conch's back.
 */
import { describe, expect, it } from 'vitest';

import { fitPicture, PICTURE_MAX, toScreen } from '../../computer-use/policy';
import {
  claudeVersion,
  fitPictureTo,
  HIGH_SIGHT,
  OTHER_SIGHT,
  pictureLimit,
  pictureTokens,
  STANDARD_SIGHT,
} from './sight';

describe('which models read how much', () => {
  it.each([
    ['claude-opus-4-7', [4, 7]],
    ['claude-sonnet-4-5-20250929', [4, 5]],
    ['claude-sonnet-4-20250514', [4, 0]],
    ['claude-opus-4-6[1m]', [4, 6]],
    ['anthropic/claude-opus-4.7', [4, 7]],
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0', [4, 5]],
    ['claude-haiku-4-5@20251001', [4, 5]],
    ['claude-fable-5-1', [5, 1]],
    ['claude-opus-5', [5, 0]],
    ['claude-3-5-sonnet-20241022', [3, 5]],
    ['claude-3-opus-20240229', [3, 0]],
  ])('reads %s as Claude %j', (id, version) => {
    expect(claudeVersion(id)).toEqual(version);
  });

  it('gives older Claude the standard size, newer Claude and the unknown the larger one', () => {
    expect(pictureLimit('claude-sonnet-4-6')).toBe(STANDARD_SIGHT);
    expect(pictureLimit('claude-3-5-sonnet-20241022')).toBe(STANDARD_SIGHT);
    expect(pictureLimit('claude-opus-4-7')).toBe(HIGH_SIGHT);
    expect(pictureLimit('claude-opus-5-5')).toBe(HIGH_SIGHT);
    expect(pictureLimit('opus')).toBe(HIGH_SIGHT);
    expect(pictureLimit(undefined)).toBe(HIGH_SIGHT);
    expect(pictureLimit('gpt-5')).toBe(OTHER_SIGHT);
    expect(pictureLimit('gemini-3-pro')).toBe(OTHER_SIGHT);
  });

  it('counts Claude’s visual tokens as the docs do', () => {
    expect(pictureTokens(1920, 1080)).toBe(69 * 39);
    expect(pictureTokens(1280, 800)).toBe(46 * 29);
  });
});

describe('a picture sized to fit', () => {
  it('leaves one that fits exactly as it is', () => {
    expect(fitPictureTo(1280, 800, STANDARD_SIGHT)).toEqual({ width: 1280, height: 800 });
    expect(fitPictureTo(1440, 2000, HIGH_SIGHT)).toEqual({ width: 1440, height: 2000 });
  });

  it.each([
    ['standard', STANDARD_SIGHT, 1440, 900],
    ['standard', STANDARD_SIGHT, 1440, 2400],
    ['standard', STANDARD_SIGHT, 2560, 1440],
    ['high', HIGH_SIGHT, 960, 2077],
    ['high', HIGH_SIGHT, 2000, 2000],
    ['high', HIGH_SIGHT, 3440, 1440],
    ['other', OTHER_SIGHT, 3440, 1440],
  ])('scales a %s picture of %i×%i down until it fits, its shape kept', (_, limit, w, h) => {
    const fit = fitPictureTo(w, h, limit);
    expect(Math.max(fit.width, fit.height)).toBeLessThanOrEqual(limit.edge);
    if (limit.tokens)
      expect(pictureTokens(fit.width, fit.height)).toBeLessThanOrEqual(limit.tokens);
    expect(fit.width / fit.height).toBeCloseTo(w / h, 1);
    // No smaller than it has to be: a few pixels more would no longer fit.
    const bigger = { width: Math.round(fit.width * 1.03), height: Math.round(fit.height * 1.03) };
    expect(fitPictureTo(bigger.width, bigger.height, limit)).not.toEqual(bigger);
  });

  it('never sends more than 2000 px, past which a request with many pictures is refused', () => {
    for (const limit of [STANDARD_SIGHT, HIGH_SIGHT, OTHER_SIGHT])
      expect(limit.edge).toBeLessThanOrEqual(2000);
  });

  it('a point read off a scaled picture lands where it was on the page', () => {
    const page = { width: 1440, height: 2160 };
    const fit = fitPictureTo(page.width, page.height, STANDARD_SIGHT);
    // browser_click_at maps the picture's pixels onto the page, axis by axis.
    const onPage = (x: number, y: number) => ({
      x: (x * page.width) / fit.width,
      y: (y * page.height) / fit.height,
    });
    const target = { x: 700, y: 1500 };
    const read = {
      x: Math.round((target.x * fit.width) / page.width),
      y: Math.round((target.y * fit.height) / page.height),
    };
    const landed = onPage(read.x, read.y);
    expect(Math.abs(landed.x - target.x)).toBeLessThanOrEqual(page.width / fit.width);
    expect(Math.abs(landed.y - target.y)).toBeLessThanOrEqual(page.height / fit.height);
  });

  it('the computer tool’s pictures already fit every model, in points, not Retina pixels', () => {
    for (const screen of [
      { width: 1512, height: 982 },
      { width: 1728, height: 1117 },
      { width: 2560, height: 1440 },
    ]) {
      const picture = fitPicture(screen.width, screen.height);
      expect(picture.width).toBeLessThanOrEqual(PICTURE_MAX.width);
      expect(fitPictureTo(picture.width, picture.height, STANDARD_SIGHT)).toEqual({
        width: picture.width,
        height: picture.height,
      });
      // The picture's corner is the screen's corner, in points (to the nearest one).
      const corner = toScreen(picture.width, picture.height, picture);
      expect(Math.abs((corner?.x ?? 0) - screen.width)).toBeLessThanOrEqual(1);
      expect(Math.abs((corner?.y ?? 0) - screen.height)).toBeLessThanOrEqual(1);
    }
  });
});
