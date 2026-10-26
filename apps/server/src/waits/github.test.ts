import { describe, expect, it } from 'vitest';

import { firstThatSees, type GitHubAnswer, type GitHubClient } from './github';

function client(via: GitHubClient['via'], answers: GitHubAnswer[]) {
  const asked: { path: string; etag?: string }[] = [];
  const c: GitHubClient & { asked: typeof asked } = {
    via,
    asked,
    get: (path, etag) => {
      asked.push({ path, ...(etag && { etag }) });
      return Promise.resolve(answers.shift() ?? { status: 200 });
    },
  };
  return c;
}

describe('firstThatSees', () => {
  it("moves on from gh as another account to the app's token, and stays there", async () => {
    const gh = client('gh', [{ status: 404 }]);
    const token = client('token', [{ status: 200, json: { ok: 1 } }, { status: 304 }]);
    const anyone = client('public', []);
    const ways = firstThatSees([gh, token, anyone]);
    expect(ways.via).toBe('gh');
    expect((await ways.get('/repos/giotiskl/indiestand-api')).status).toBe(200);
    expect(ways.via).toBe('token');
    expect((await ways.get('/repos/giotiskl/indiestand-api', 'W/"1"')).status).toBe(304);
    expect(gh.asked).toHaveLength(1);
    expect(token.asked[1]).toEqual({ path: '/repos/giotiskl/indiestand-api', etag: 'W/"1"' });
    expect(anyone.asked).toHaveLength(0);
  });

  it("doesn't hand another way an etag it didn't give", async () => {
    const gh = client('gh', [{ status: 404 }]);
    const token = client('token', [{ status: 200 }]);
    await firstThatSees([gh, token]).get('/x', 'W/"gh"');
    expect(token.asked[0]).toEqual({ path: '/x' });
  });

  it('takes a limit as an answer, not a refusal', async () => {
    const gh = client('gh', [{ status: 403, waitMs: 60_000 }]);
    const token = client('token', []);
    expect((await firstThatSees([gh, token]).get('/x')).status).toBe(403);
    expect(token.asked).toHaveLength(0);
  });

  it('gives the last refusal when no way can see it', async () => {
    const ways = firstThatSees([
      client('gh', [{ status: 404 }]),
      client('public', [{ status: 404 }]),
    ]);
    expect((await ways.get('/x')).status).toBe(404);
  });
});
