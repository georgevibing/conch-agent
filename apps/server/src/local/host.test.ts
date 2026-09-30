import { describe, expect, it } from 'vitest';

import { bindFor, isLoopbackUrl, ollamaHost } from './host';

describe('where Ollama is', () => {
  it('uses the default when nothing is set', () => {
    expect(ollamaHost(undefined)).toEqual({ url: 'http://127.0.0.1:11434' });
    expect(ollamaHost('  ')).toEqual({ url: 'http://127.0.0.1:11434' });
  });

  it.each([
    ['127.0.0.1', 'http://127.0.0.1:11434'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['localhost', 'http://127.0.0.1:11434'],
    ['http://localhost:11434', 'http://127.0.0.1:11434'],
    ['http://127.0.0.1:11434/', 'http://127.0.0.1:11434'],
    ['[::1]:11434', 'http://[::1]:11434'],
    ['::1', 'http://[::1]:11434'],
    ['127.1.2.3', 'http://127.1.2.3:11434'],
  ])('follows %s to this computer', (value, url) => {
    expect(ollamaHost(value)).toEqual({ url });
    expect(bindFor(ollamaHost(value))).toBe(new URL(url).host);
  });

  it.each([
    ['0.0.0.0', 'http://127.0.0.1:11434'],
    ['0.0.0.0:9000', 'http://127.0.0.1:9000'],
    ['http://0.0.0.0:11434', 'http://127.0.0.1:11434'],
    ['[::]:7000', 'http://127.0.0.1:7000'],
    ['::', 'http://127.0.0.1:11434'],
    // No host at all is every address to Ollama too.
    [':11500', 'http://127.0.0.1:11500'],
  ])('dials %s on this computer, remembers it answers the network', (value, url) => {
    const host = ollamaHost(value);
    expect(host).toEqual({ url, wildcard: value });
    // What Conch starts Ollama with: this computer only, never every address.
    expect(bindFor(host)).toBe(new URL(url).host);
    expect(bindFor(host)).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  it.each([
    '192.168.1.20',
    'http://192.168.1.20:11434',
    'ollama.example.com',
    'https://ollama.example.com',
    'host.docker.internal:11434',
    '10.0.0.5:11434',
    'http://user:pass@127.0.0.1:11434',
    'file:///etc/passwd',
    'ftp://127.0.0.1',
    '127.0.0.1:99999',
    '127.0.0.1:abc',
    '127.300.0.1',
    'localhost.evil.com',
    '[2001:db8::1]:11434',
  ])('refuses %s, and says what it was', (value) => {
    const host = ollamaHost(value);
    expect(host.url).toBe('http://127.0.0.1:11434');
    expect(host.refused).toBe(value);
  });

  it('knows a loopback address when it sees one', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434/api/chat')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434/api/tags')).toBe(true);
    expect(isLoopbackUrl('https://127.0.0.1:11434')).toBe(false);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(false);
    expect(isLoopbackUrl('http://192.168.1.2:11434')).toBe(false);
    expect(isLoopbackUrl('http://a:b@127.0.0.1:11434')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});
