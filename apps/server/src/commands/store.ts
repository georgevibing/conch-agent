import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { CustomCommand } from '@conch/protocol';

import { Mutex, writeFileAtomic } from '../lib/fs';

const STARTERS: Omit<CustomCommand, 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'tldr',
    description: 'Summarise the last reply in three bullet points',
    prompt: 'Summarise your last reply in three short bullet points.',
  },
  {
    name: 'explain',
    description: 'Explain something simply',
    prompt: 'Explain {{input}} simply, as if I were new to it. Use an everyday analogy.',
  },
];

/**
 * Your own slash commands: reusable prompts stored as `~/.conch/commands/<name>.md`
 * (description in frontmatter, prompt as the body). `{{input}}` is replaced by
 * whatever you type after the command; without it, the input is appended.
 */
export class CommandStore {
  #mutex = new Mutex();

  constructor(private readonly dir: string) {}

  async list(): Promise<CustomCommand[]> {
    await this.#seed();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.md'));
    const commands = await Promise.all(
      files.map(async (f) => parse(f.slice(0, -3), await readFile(join(this.dir, f), 'utf8'))),
    );
    return commands
      .filter((c): c is CustomCommand => Boolean(c))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  save(input: { name: string; description: string; prompt: string }): Promise<CustomCommand> {
    return this.#mutex.run(async () => {
      const existing = (await this.list()).find((c) => c.name === input.name);
      const now = Date.now();
      const command = CustomCommand.parse({
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await writeFileAtomic(join(this.dir, `${command.name}.md`), serialise(command));
      return command;
    });
  }

  remove(name: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const path = join(this.dir, `${name}.md`);
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      await rm(path, { force: true });
      return exists;
    });
  }

  async #seed() {
    try {
      await stat(this.dir);
    } catch {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const now = Date.now();
      for (const starter of STARTERS) {
        await writeFileAtomic(
          join(this.dir, `${starter.name}.md`),
          serialise({ ...starter, createdAt: now, updatedAt: now }),
        );
      }
    }
  }
}

function serialise(c: CustomCommand): string {
  return `---\ndescription: ${c.description.replace(/\n/g, ' ')}\ncreatedAt: ${c.createdAt}\nupdatedAt: ${c.updatedAt}\n---\n${c.prompt}\n`;
}

function parse(name: string, text: string): CustomCommand | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const meta: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const now = Date.now();
  const result = CustomCommand.safeParse({
    name,
    description: meta.description ?? '',
    prompt: (match ? match[2] : text)?.trim(),
    createdAt: Number(meta.createdAt ?? now),
    updatedAt: Number(meta.updatedAt ?? now),
  });
  return result.success ? result.data : undefined;
}
