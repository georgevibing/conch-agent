#!/usr/bin/env node
// conch-mcp-launcher v1
//
// Conch's launcher for other apps (ADR 0073). An app that speaks MCP over
// stdio (Claude Desktop, Cursor, VS Code) starts this; it carries each
// message to Conch's door on this computer and brings the answer back.
//
// It proves it holds the app's key without sending it: Conch gives it a
// nonce, it answers with an HMAC of it, and Conch gives it a session. So
// whatever might hold Conch's port while Conch is stopped learns nothing
// it could use. Conch writes this file to ~/.conch/mcp/ when it starts;
// edits to it don't last.
//
// Plain Node, no packages: it starts in a moment, whichever Conch is installed.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = 1;
const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.CONCH_HOME || dirname(here);

const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const client = argument('--client');

/** One line on stderr: apps keep it in their logs. Never a key or a token. */
const say = (message) => process.stderr.write(`conch: ${message}\n`);
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

class Plain extends Error {}

/** Where Conch is listening, from the file the running Conch keeps. */
function gateway() {
  let record;
  try {
    record = JSON.parse(readFileSync(join(home, 'gateway.json'), 'utf8'));
  } catch {
    throw new Plain('Conch isn’t running on this computer. Open Conch, then try again.');
  }
  const host =
    !record.host || record.host === '0.0.0.0' || record.host === '::'
      ? '127.0.0.1'
      : record.host.includes(':')
        ? `[${record.host}]`
        : record.host;
  return `http://${host}:${record.port}`;
}

function key() {
  if (!client || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(client))
    throw new Plain(
      'This app’s settings don’t name which app it is. Connect it again from Conch: Settings → Other apps.',
    );
  try {
    return readFileSync(join(home, 'mcp', 'keys', `${client}.key`), 'utf8').trim();
  } catch {
    throw new Plain(
      'This app isn’t paired with Conch any more. Connect it again from Conch: Settings → Other apps.',
    );
  }
}

async function post(path, body, headers = {}, signal) {
  let response;
  try {
    response = await fetch(`${gateway()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (error instanceof Plain || signal?.aborted) throw error;
    throw new Plain('Conch isn’t answering on this computer. Open Conch, then try again.');
  }
  return response;
}

let session;
let opening;

/** A session from Conch, for proving this app holds its key. */
function open() {
  opening ??= (async () => {
    const secret = key();
    const hello = await post('/mcp/hello', { client });
    if (!hello.ok) throw new Plain(await reason(hello));
    const { nonce } = await hello.json();
    const proof = createHmac('sha256', secret)
      .update(`conch-mcp/1 ${client} ${nonce}`)
      .digest('base64url');
    const answer = await post('/mcp/session', { client, nonce, proof });
    if (!answer.ok) throw new Plain(await reason(answer));
    session = (await answer.json()).token;
  })().finally(() => {
    opening = undefined;
  });
  return opening;
}

async function reason(response) {
  try {
    const body = await response.json();
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON: Conch didn't say.
  }
  return `Conch said no (${response.status}).`;
}

let protocol;
const inFlight = new Map();

/** Carry one message to Conch, and its answer back. */
async function carry(message) {
  const id = message && typeof message === 'object' ? message.id : undefined;
  const controller = new AbortController();
  if (id !== undefined) inFlight.set(id, controller);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!session) await open();
      const response = await post(
        '/mcp',
        message,
        {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${session}`,
          ...(protocol && { 'mcp-protocol-version': protocol }),
        },
        controller.signal,
      );
      // A session ends when Conch restarts: prove it again, once.
      if (response.status === 401 && attempt === 0) {
        session = undefined;
        continue;
      }
      if (response.status === 202 || response.status === 204) return;
      if (!response.ok) throw new Plain(await reason(response));
      const answer = await response.json();
      for (const one of Array.isArray(answer) ? answer : [answer]) {
        if (one?.result?.protocolVersion && message?.method === 'initialize')
          protocol = one.result.protocolVersion;
        write(one);
      }
      return;
    }
    throw new Plain(
      'Conch didn’t accept this app. Connect it again from Conch: Settings → Other apps.',
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    const words = error instanceof Plain ? error.message : 'Something went wrong talking to Conch.';
    say(words);
    if (id !== undefined) write({ jsonrpc: '2.0', id, error: { code: -32000, message: words } });
  } finally {
    if (id !== undefined) inFlight.delete(id);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That isn’t JSON.' } });
    return;
  }
  // The app gave up on a call: stop it in Conch too.
  if (message?.method === 'notifications/cancelled') {
    inFlight.get(message.params?.requestId)?.abort();
    return;
  }
  void carry(message);
});
lines.on('close', () => {
  for (const controller of inFlight.values()) controller.abort();
  process.exit(0);
});

say(`launcher v${VERSION} for ${client ?? 'an unnamed app'}`);
