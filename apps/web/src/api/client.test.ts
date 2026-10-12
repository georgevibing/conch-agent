import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, request, SIGNED_OUT_EVENT } from './client';

function answer(body: string, status: number, statusText = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, statusText })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
  it('turns an error page that isn’t JSON into an ApiError, and a 401 still signs out', async () => {
    const signedOut = vi.fn();
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    answer('<html><body>Unauthorized</body></html>', 401, 'Unauthorized');
    const error = await request(z.unknown(), '/api/conversations').catch((e: unknown) => e);
    window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('says a proxy’s 502 page plainly rather than as a parse error', async () => {
    answer('<html>Bad gateway</html>', 502, 'Bad Gateway');
    const error = await request(z.unknown(), '/api/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Bad Gateway');
  });
});
