// The door to Conch's tools, for an agent program that only starts MCP servers
// as programs of its own (stdio), not at an address (ADR 0053 § Conch's tools,
// through a door). It's started by the program for one turn and only relays:
// each JSON-RPC message it reads on stdin is posted to the turn's door on this
// computer's loopback address, with the turn's key, and the answer is written
// back on stdout. Everything is still decided by the door, behind its checks.
//
// No dependencies, nothing kept: it reads two variables, CONCH_DOOR_URL (only
// ever http://127.0.0.1:<port>/mcp) and CONCH_DOOR_KEY, and ends with its input.
import { createInterface } from 'node:readline';

const url = process.env.CONCH_DOOR_URL ?? '';
const key = process.env.CONCH_DOOR_KEY ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/.test(url) || !key) {
  process.stderr.write('conch door: not started by Conch\n');
  process.exit(2);
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const failed = (id, text) =>
  id === undefined || id === null
    ? undefined
    : write({ jsonrpc: '2.0', id, error: { code: -32603, message: text } });

/** Each answer goes out whole and in turn, whatever order the door answers in. */
let tail = Promise.resolve();

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const id = message && typeof message === 'object' ? message.id : undefined;
  const answer = fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  })
    .then(async (res) => {
      // A notification is accepted with nothing to say.
      if (res.status === 202) return undefined;
      const text = await res.text();
      if (!res.ok) return failed(id, 'Conch’s tools aren’t available right now.');
      return text ? JSON.parse(text) : undefined;
    })
    .catch(() => failed(id, 'Conch’s tools aren’t available right now.'));
  tail = tail.then(async () => {
    const result = await answer;
    if (Array.isArray(result)) result.forEach(write);
    else if (result && typeof result === 'object') write(result);
  });
});
