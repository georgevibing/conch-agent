import { describe, expect, it } from 'vitest';

import { signingKey, signRequest } from './sigv4';

// AWS's published examples. The secret is AWS's documentation example, not a real one.
const SECRET = 'wJalrXUtnFEMI/K7MDENG+' + 'bPxRfiCYEXAMPLEKEY';
const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET };
const at = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));

describe('SigV4', () => {
  it('derives the signing key AWS documents', () => {
    expect(signingKey(SECRET, '20120215', 'us-east-1', 'iam').toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });

  it('signs the test suite’s get-vanilla request', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      credentials,
      now: at,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
  });

  it('signs the IAM ListUsers example', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      region: 'us-east-1',
      service: 'iam',
      credentials,
      now: at,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('signs a session token and the body it will send', () => {
    const one = signRequest({
      method: 'POST',
      url: 'https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages',
      body: '{"a":1}',
      region: 'us-east-1',
      service: 'bedrock-mantle',
      credentials: { ...credentials, sessionToken: 'session' },
      now: at,
    });
    expect(one['x-amz-security-token']).toBe('session');
    expect(one.authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token');
    const other = signRequest({
      method: 'POST',
      url: 'https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages',
      body: '{"a":2}',
      region: 'us-east-1',
      service: 'bedrock-mantle',
      credentials: { ...credentials, sessionToken: 'session' },
      now: at,
    });
    // A different body is a different signature: it can't be replayed onto other words.
    expect(other.authorization).not.toBe(one.authorization);
  });
});
