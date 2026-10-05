/** Fake settings and exact fetch responses for scratch tests; no real network (ADR 0092). */
import { z } from 'zod';
import type { AppFetcher, AppFiles } from './types';

const Reply = z
  .object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
    body: z.string().optional(),
    status: z.number().int().min(100).max(599).default(200),
    json: z.unknown().optional(),
    text: z.string().optional(),
  })
  .strict();
const Fixture = z
  .object({
    settings: z.record(z.string(), z.string().max(8192)).default({}),
    responses: z.array(Reply).max(100).default([]),
  })
  .strict();
const File = z
  .object({ fixtures: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), Fixture) })
  .strict();

export function scratchFixture(
  files: AppFiles,
  name: string,
): { settings: Record<string, string>; fetcher: AppFetcher } {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
    throw new Error('Use a fixture name of 1–64 letters, numbers, underscores or dashes.');
  const bytes = files.get('fixtures.json');
  if (!bytes)
    throw new Error('Write fixtures.json with a fixtures object before trying a fixture.');
  const parsed = File.parse(JSON.parse(bytes.toString('utf8')));
  const fixture = Object.hasOwn(parsed.fixtures, name) ? parsed.fixtures[name] : undefined;
  if (!fixture) throw new Error(`No scratch fixture named ${name}. Add it to fixtures.json.`);
  return {
    settings: fixture.settings,
    fetcher: async (app, request) => {
      const url = new URL(request.url);
      if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        !app.reaches.includes(url.hostname)
      )
        return {
          ok: false,
          status: 0,
          headers: {},
          body: '',
          refused: 'The fixture request is outside this app’s declared reaches.',
        };
      const response = fixture.responses.find(
        (r) =>
          r.url === request.url &&
          r.method === request.method &&
          (r.body === undefined || r.body === request.body),
      );
      if (!response)
        return {
          ok: false,
          status: 0,
          headers: {},
          body: '',
          refused:
            'No fixture response matches this request. Add its exact URL, method and optional body to fixtures.json. No network request was made.',
        };
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: {},
        body: response.text ?? JSON.stringify(response.json ?? null),
      };
    },
  };
}
