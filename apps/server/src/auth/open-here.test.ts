import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hereAsksDir, ThisComputer } from './here';
import { askHere, isOpenFile, openHere } from './open-here';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** A running Conch's side: this computer's key, answering asks. */
async function running() {
  const home = await mkdtemp(join(tmpdir(), 'conch-open-here-'));
  const here = new ThisComputer(home);
  await here.start();
  stops.push(here.watch(() => 4317));
  return { home, here };
}

const opener = () => {
  const opened: string[] = [];
  return {
    opened,
    open: async (target: string) => {
      opened.push(target);
      return true;
    },
  };
};

describe('asking the running Conch for a link, through the folder (ADR 0063)', () => {
  it('opens the private file it wrote, which carries a code that works once', async () => {
    const { home, here } = await running();
    const { opened, open } = opener();
    const how = await openHere({
      home,
      url: 'http://localhost:4317',
      page: '/?open=devices',
      open,
    });
    expect(how).toBe('opened');
    expect(opened).toHaveLength(1);
    const file = opened[0] ?? '';
    expect(file.startsWith(join(home, 'here', 'open'))).toBe(true);
    // The code is in the file, never in what's handed to the opener.
    expect(file).not.toMatch(/here=/);
    const code = /#here=([A-Za-z0-9_-]{43})/.exec(await readFile(file, 'utf8'))?.[1] ?? '';
    expect(await readFile(file, 'utf8')).toContain('http://localhost:4317/?open=devices#here=');
    expect(here.redeem(code)).toBe(true);
    // Used: the file and the answers go.
    expect(existsSync(file)).toBe(false);
    expect(await readdir(hereAsksDir(home))).toEqual([]);
  });

  it('gives `pnpm conch open --link` the address with the code', async () => {
    const { home, here } = await running();
    const link = await askHere({ home, page: '/' });
    expect(link?.url).toMatch(/^http:\/\/localhost:4317\/#here=[A-Za-z0-9_-]{43}$/);
    expect(here.redeem(link?.url.split('#here=')[1] ?? '')).toBe(true);
  });

  it('never sends a secret over the network: an impostor on the port learns nothing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-open-here-'));
    // Conch has run here before (its key and folder exist), but isn't running now…
    await new ThisComputer(home).start();
    const key = await readFile(join(home, 'here', 'key'), 'utf8');
    // …and another account listens on its port, answering like Conch.
    const seen: { url?: string; headers: IncomingHttpHeaders; body: string }[] = [];
    const impostor = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ url: req.url, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/plain' }).end('/tmp/evil.command');
      });
    });
    await new Promise<void>((done) => impostor.listen(0, '127.0.0.1', done));
    stops.push(() => impostor.close());
    const address = impostor.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const { opened, open } = opener();
    const how = await openHere({ home, url: `http://localhost:${port}`, timeoutMs: 400, open });
    // Nobody answered the ask, so it opened the plain address, never a file the impostor named.
    expect(how).toBe('plain');
    expect(opened).toEqual([`http://localhost:${port}/`]);
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain(key.trim());
    expect(await readdir(hereAsksDir(home))).toEqual([]);
  });

  it('opens nothing but a private page Conch wrote, whatever the answer names', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-open-here-'));
    await new ThisComputer(home).start();
    const asks = hereAsksDir(home);
    // Something answers every ask with a file of its own choosing.
    const evil = join(home, 'evil.command');
    writeFileSync(evil, '#!/bin/sh\necho gotcha\n');
    const timer = setInterval(() => {
      for (const name of readdirSync(asks)) {
        const id = /^([0-9a-f]+)\.ask$/.exec(name)?.[1];
        if (!id) continue;
        writeFileSync(join(asks, `${id}.link`), 'http://localhost:4317/#here=x');
        writeFileSync(join(asks, `${id}.open`), evil);
      }
    }, 20);
    stops.push(() => clearInterval(timer));
    const { opened, open } = opener();
    expect(await openHere({ home, url: 'http://localhost:4317', open })).toBe('plain');
    expect(opened).toEqual(['http://localhost:4317/']);
  });

  it('knows a private page Conch wrote from anything else', async () => {
    const { home } = await running();
    const made = await new ThisComputer(home).link({ port: 4317, file: true });
    expect(await isOpenFile(made.file ?? '')).toBe(true);
    const renamed = join(home, 'here', 'open', 'page.html');
    await writeFile(renamed, '');
    expect(await isOpenFile(renamed)).toBe(false);
    expect(await isOpenFile(join(home, 'here', 'open', 'conch-open-0.html'))).toBe(false);
    if (process.platform !== 'win32') {
      const link = join(home, 'here', 'open', `conch-open-${'a'.repeat(24)}.html`);
      await symlink(made.file ?? '', link);
      expect(await isOpenFile(link)).toBe(false);
    }
  });

  it('opens the plain address when no Conch has made the folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-open-here-'));
    const { opened, open } = opener();
    expect(await openHere({ home, url: 'http://localhost:4317', open })).toBe('plain');
    expect(opened).toEqual(['http://localhost:4317/']);
  });

  it('never asks for a page that leaves this Conch', async () => {
    const { home } = await running();
    const link = await askHere({ home, page: '//evil.example' });
    expect(link?.url).toMatch(/^http:\/\/localhost:4317\/#here=/);
  });

  it('says when there is no browser to open (a server)', async () => {
    const { home } = await running();
    const how = await openHere({ home, url: 'http://localhost:4317', open: async () => false });
    expect(how).toBe('no-browser');
  });
});
