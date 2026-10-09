/**
 * The module a script runs as (ADR 0119). The sealed runtime (ADR 0061 §2)
 * loads `tools.mjs` from a folder and calls its tools; for a script, that
 * folder holds one generated module: the script inside an async function,
 * with `tools`, `progress`, `note` and a `console` that keeps what it logs.
 *
 * Nothing here is a wall. The script can see and change its own helpers (or
 * break out of the function); it is in the sealed process either way, and
 * everything it can reach goes through `app.fetch` to the gateway, which
 * checks each call (`proxy.ts`). The helpers are for the script's sake.
 */
import { stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';

import { SCRIPT_LIMITS } from '@conch/protocol';

/** Where the script's calls go: never a real address, only the gateway's answer. */
export const SCRIPT_SITE = 'https://script.conch.invalid';

/** The script starts on this line of the module, so an error's line is the script's own. */
const FIRST_LINE = 3;

/** The script's helpers, in the order the function takes them. */
const PARAMS = ['tools', 'progress', 'note', 'console', 'app'] as const;

export interface Prepared {
  /** The script as JavaScript (types stripped from TypeScript). */
  code: string;
  /** It was written in TypeScript, and its types were taken out. */
  typescript: boolean;
}

/** A script that won't parse, in words a model can act on: the line, and what's wrong there. */
export class ScriptSyntaxError extends Error {}

/** The line in `script.js` an error points at, from its stack. */
function lineOf(error: unknown): number | undefined {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const line = /script\.js:(\d+)/.exec(stack)?.[1];
  return line === undefined ? undefined : Number(line);
}

/**
 * Checks the script parses as the body of an async function, without running
 * any of it (compiling is all `vm.Script` does until it's run, and it never
 * is). TypeScript is accepted: its types are stripped first, leaving every
 * line where it was.
 */
export function prepare(source: string): Prepared {
  const parses = (code: string) =>
    new Script(`(async function (${PARAMS.join(', ')}) {\n${code}\n})`, {
      filename: 'script.js',
      lineOffset: -1,
    });
  try {
    parses(source);
    return { code: source, typescript: false };
  } catch (error) {
    // Stripped inside a function, since a body's `return` is no statement on its own; strip
    // mode leaves every character where it was, so the body comes back out by position.
    let stripped: string | undefined;
    const open = '(async function () {';
    try {
      stripped = stripTypeScriptTypes(`${open}${source}\n})`, { mode: 'strip' }).slice(
        open.length,
        -'\n})'.length,
      );
    } catch {
      stripped = undefined;
    }
    if (stripped !== undefined && stripped !== source) {
      try {
        parses(stripped);
        return { code: stripped, typescript: true };
      } catch {
        // Not TypeScript either: the JavaScript error is the one to say.
      }
    }
    const line = lineOf(error);
    const said = error instanceof Error ? error.message : String(error);
    throw new ScriptSyntaxError(
      `The script doesn’t parse${line ? ` (line ${line})` : ''}: ${said}. It runs as the body of an async function, so use await and return directly; there are no imports.`,
    );
  }
}

/** A JavaScript string literal for `value`. */
const literal = (value: unknown) => JSON.stringify(value);

/**
 * The module: the script first (so its line numbers are its own), then the
 * one tool the runtime calls, which gives it its helpers and hands back what
 * it returned, what it logged and how it ended.
 */
export function moduleFor(code: string): string {
  return `// Made by Conch for one run of a script (ADR 0119).
async function __script(${PARAMS.join(', ')}) {
${code}
}

const SITE = ${literal(SCRIPT_SITE)};
const LINES = ${SCRIPT_LIMITS.resultLines};
const CHARS = ${SCRIPT_LIMITS.resultChars};
const FIRST = ${FIRST_LINE};
const LAST = ${FIRST_LINE + code.split('\n').length - 1};
const { freeze, defineProperty } = Object;
const { stringify } = JSON;

/** Anything as text: strings as they are, the rest as JSON where it can be. */
function text(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.name + ': ' + value.message;
  try {
    const json = stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/** The script's own line an error happened on, from its stack. */
function lineOf(error) {
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  // The first place in the script itself: a tool's error starts in the helpers that threw it.
  for (const at of stack.matchAll(/tools\\.mjs:(\\d+):\\d+/g)) {
    const line = Number(at[1]);
    if (line >= FIRST && line <= LAST) return line - FIRST + 1;
  }
  return undefined;
}

export const tools = {
  run: {
    description: 'One run of a script.',
    input: { type: 'object' },
    changes: true,
    async run(_input, app) {
      const said = [];
      let saidChars = 0;
      let unsaid = 0;
      const say = (...args) => {
        for (const line of args.map(text).join(' ').split('\\n')) {
          if (said.length < LINES && saidChars + line.length <= CHARS) {
            said.push(line);
            saidChars += line.length + 1;
          } else unsaid++;
        }
      };
      const quiet = () => {};
      const console = freeze({
        log: say, info: say, warn: say, error: say, debug: say, trace: say, dir: say, table: say,
        assert: (ok, ...args) => { if (!ok) say('Assertion failed', ...args); },
        count: quiet, countReset: quiet, group: quiet, groupCollapsed: quiet, groupEnd: quiet,
        time: quiet, timeEnd: quiet, timeLog: quiet, clear: quiet,
      });

      const post = async (path, body) => {
        const answer = await app.fetch(SITE + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        return answer.json();
      };

      class ToolError extends Error {
        constructor(message, tool, declined) {
          super(message);
          defineProperty(this, 'name', { value: declined ? 'Declined' : 'ToolError' });
          this.tool = tool;
          this.declined = declined;
        }
      }

      const call = async (name, args) => {
        let body;
        try {
          body = stringify(args === undefined ? {} : args);
        } catch (error) {
          throw new TypeError('tools.' + name + ' takes plain data (JSON): ' + error.message);
        }
        if (body === undefined) throw new TypeError('tools.' + name + ' takes an object.');
        const answer = await post('/call/' + encodeURIComponent(name), body);
        if (answer.ok) return answer.value;
        throw new ToolError(String(answer.message), name, answer.declined === true);
      };

      const proxy = new Proxy(freeze({}), {
        get(_, name) {
          // Not a thenable, and not a symbol's: only tools by name.
          if (typeof name !== 'string' || name === 'then' || name === 'toJSON') return undefined;
          return (args) => call(name, args);
        },
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
      });

      let lastProgress = 0;
      const progress = (done, total, label) => {
        const now = Date.now();
        const end = typeof total === 'number' && done >= total;
        if (!end && now - lastProgress < 100) return;
        lastProgress = now;
        void post('/progress', stringify({ done, total, label })).catch(quiet);
      };
      let lastNote;
      let noteAt = 0;
      const note = (words) => {
        lastNote = String(words).slice(0, 200);
        const now = Date.now();
        if (now - noteAt < 100) return;
        noteAt = now;
        void post('/note', stringify({ text: lastNote })).catch(quiet);
      };

      try {
        const value = await __script(proxy, progress, note, console, undefined);
        const whole = value === undefined ? undefined : text(value);
        const kept = whole === undefined ? undefined : whole.slice(0, CHARS);
        return {
          said,
          unsaid,
          ...(lastNote !== undefined && { note: lastNote }),
          ...(kept !== undefined && { value: kept, valueCut: whole.length - kept.length }),
        };
      } catch (error) {
        const line = lineOf(error);
        return {
          said,
          unsaid,
          ...(lastNote !== undefined && { note: lastNote }),
          error: {
            name: typeof error?.name === 'string' ? error.name : 'Error',
            message: (typeof error?.message === 'string' ? error.message : text(error)).slice(0, 1500),
            ...(line !== undefined && { line }),
            ...(typeof error?.tool === 'string' && { tool: error.tool }),
            ...(error?.declined === true && { declined: true }),
          },
        };
      }
    },
  },
};
`;
}
