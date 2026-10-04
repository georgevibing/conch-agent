import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The window opens Conch as this computer (ADR 0063). Like every launcher,
 * the app asks the gateway for a one-time link through a folder only this
 * account can write (`<home>/here/asks`): it leaves `<id>.ask`, and the
 * gateway writes back `<id>.link`. Nothing secret goes over the network.
 * The window then loads the page with `#here=<code>`; the page hands the code
 * in and gets the cookie that makes it this computer.
 *
 * Anything that goes wrong leaves `target` as it was: the page then says what
 * to do.
 */
export async function asThisComputer(
  target: string,
  home: string,
  timeoutMs = 3_000,
): Promise<string> {
  const asks = join(home, 'here', 'asks');
  if (!existsSync(asks)) return target;
  const ask = join(asks, randomBytes(12).toString('hex'));
  try {
    await writeFile(`${ask}.tmp`, '/\n', { mode: 0o600 });
    await rename(`${ask}.tmp`, `${ask}.ask`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(`${ask}.open`)) {
        const code = /#here=([A-Za-z0-9_-]{43})$/.exec(
          (await readFile(`${ask}.link`, 'utf8')).trim(),
        )?.[1];
        if (!code) return target;
        const url = new URL(target);
        url.hash = `here=${code}`;
        return url.href;
      }
      await wait(100);
    }
    return target;
  } catch {
    return target;
  } finally {
    await rm(`${ask}.tmp`, { force: true }).catch(() => undefined);
    await rm(`${ask}.ask`, { force: true }).catch(() => undefined);
  }
}
