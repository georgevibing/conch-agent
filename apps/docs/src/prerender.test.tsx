import { describe, expect, it } from 'vitest';

import { headFor, MISSING, PATHS, render } from './prerender';

describe('pages drawn ahead of time', () => {
  it('a guide is all there, with nothing left to stream in', async () => {
    const html = await render('/start/install');
    expect(html).toMatch(/<h1[^>]*>Install<\/h1>/);
    expect(html).toContain('conchagent.com/install.sh');
    // React's streaming leftovers: a fallback with the page hidden beside it.
    expect(html).not.toMatch(/<template|hidden id="S:|Opening the page/);
  });

  it('the front page and the documentation home are pages too', async () => {
    expect(PATHS.slice(0, 2)).toEqual(['/', '/docs']);
    expect(await render('/')).toContain('The AI agent that just works.');
    expect(headFor('/docs').title).toBe('Conch documentation');
  });

  it('an address with nothing behind it is the missing page, kept out of search', async () => {
    expect(await render(MISSING)).toContain('There’s no page here');
    expect(headFor(MISSING).noindex).toBe(true);
    expect(PATHS).not.toContain(MISSING);
  });
});
