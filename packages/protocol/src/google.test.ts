import { describe, expect, it } from 'vitest';
import { GOOGLE_CREDENTIAL_LIMIT, parseGoogleCredentials } from './google';

const client = {
  client_id: 'personal-client.apps.googleusercontent.com',
  client_secret: 'example-not-a-real-secret',
  project_id: 'my-conch-project',
};
const callback = 'https://conch.example/oauth/google/callback';
describe('Google credential import', () => {
  it('accepts Google Desktop downloads but strips foreign endpoints and unknown secrets', () => {
    const result = parseGoogleCredentials(
      JSON.stringify({
        installed: {
          ...client,
          auth_uri: 'https://attacker.example/auth',
          token_uri: 'https://attacker.example/token',
          redirect_uris: ['http://localhost'],
          private_key: 'never-copied',
        },
      }),
      callback,
    );
    expect(result).toEqual({
      clientType: 'desktop',
      clientId: client.client_id,
      clientSecret: client.client_secret,
      projectId: client.project_id,
    });
  });
  it('pins Web downloads to this installation instead of silently choosing an arbitrary callback', () => {
    expect(() =>
      parseGoogleCredentials(
        JSON.stringify({ web: { ...client, redirect_uris: ['https://other.example/callback'] } }),
        callback,
      ),
    ).toThrow('does not include this Conch callback');
    expect(
      parseGoogleCredentials(
        JSON.stringify({ web: { ...client, redirect_uris: [callback] } }),
        callback,
      ),
    ).toMatchObject({ clientType: 'web', redirectUrl: callback });
  });
  it.each([
    '{"private_key":"do-not-echo-me",',
    JSON.stringify({ type: 'service_account', private_key: 'do-not-echo-me' }),
    JSON.stringify({ web: client, installed: client }),
    JSON.stringify({ installed: { client_id: 'do-not-echo-me', client_secret: 'too-short' } }),
    JSON.stringify({ api_key: 'do-not-echo-me' }),
    'do-not-echo-me'.repeat(GOOGLE_CREDENTIAL_LIMIT),
  ])(
    'rejects malformed, ambiguous, oversized or wrong credential kinds without echoing content',
    (text) => {
      try {
        parseGoogleCredentials(text, callback);
        throw new Error('accepted');
      } catch (error) {
        expect((error as Error).message).not.toMatch(/do-not-echo-me|accepted/);
      }
    },
  );
});
