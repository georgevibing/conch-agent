import { join } from 'node:path';

import { IntegrationHealth, IntegrationPolicy, SlackToolName, ToolPolicy } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { type Heal, readStore } from '../lib/recover';

const Connection = z.object({
  token: z.string(),
  /** Changes on every new token: an approval given under one never acts under another. */
  generation: z.string(),
  team: z.string().optional(),
  teamId: z.string().optional(),
  url: z.string().optional(),
  user: z.string().optional(),
  userId: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  connectedAt: z.number(),
});
export type SlackConnection = z.infer<typeof Connection>;

const Data = z.object({
  connection: Connection.optional(),
  enabled: z.boolean().default(true),
  /**
   * When the assistant may read without asking, like every other app's
   * (ADR 0052). Older files have none: reads go by themselves, as before.
   * Sending asks whatever this says.
   */
  policy: IntegrationPolicy.default('ask-writes'),
  /** The person's choices, per tool. Unset: the policy decides, and sending asks. */
  tools: z.partialRecord(SlackToolName, ToolPolicy).default({}),
  health: IntegrationHealth.default({ state: 'checking' }),
  lastUsedAt: z.number().optional(),
});
export type SlackData = z.infer<typeof Data>;

/**
 * `~/.conch/slack.secrets.json`: the token and everything about it, in one
 * sealed file (ADR 0025 § Keys Conch uses), so who it belongs to can never
 * come apart from it. Never sent to the browser, never logged.
 */
export class SlackStore {
  #mutex = new Mutex();
  #cache?: Promise<SlackData>;
  #last?: SlackData;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'slack.secrets.json');
  }

  read(): Promise<SlackData> {
    this.#cache ??= readStore(this.#path, Data, {
      onRepair: () =>
        this.heal?.(
          'integrations',
          'Your Slack sign-in couldn’t be read, so Conch kept a copy. Connect Slack again to carry on.',
        ),
    }).then(
      (read) => (this.#last = read.value),
      (error: unknown) => {
        this.#cache = undefined;
        throw error;
      },
    );
    return this.#cache;
  }

  /** What was last read or written, without waiting (a turn's tool list is made at once). */
  peek(): SlackData | undefined {
    return this.#last;
  }

  update(fn: (data: SlackData) => SlackData): Promise<SlackData> {
    return this.#mutex.run(async () => {
      const next = Data.parse(fn(structuredClone(await this.read())));
      await writeJson(this.#path, next);
      this.#cache = Promise.resolve(next);
      this.#last = next;
      return next;
    });
  }
}
