import type { VaultRequest } from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { VaultService } from './service';

/**
 * A saved key in a command, unseen (ADR 0151): Conch reads it from Passwords
 * after the person agrees and sets it on the command's environment, so the
 * model writes `$GH_TOKEN` and never the token. What the command prints comes
 * back redacted.
 */

/** One key a command needs: the variable it goes into, and the item (and field) it comes from. */
export interface SecretRef {
  name: string;
  item: string;
  field?: string;
  reason?: string;
}

/** The `secrets` argument of Conch's command tools. */
export const secretsInput = z
  .array(
    z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .describe('The environment variable the command reads it from, e.g. “GH_TOKEN”.'),
      item: z.string().min(1).max(300).describe('The item id from passwords_find.'),
      field: z
        .string()
        .max(80)
        .optional()
        .describe('Which field, by its name (e.g. “Key”, “Password”). Leave out for the first.'),
      reason: z
        .string()
        .max(300)
        .optional()
        .describe('One line on what the command does with it, shown to the user.'),
    }),
  )
  .max(4)
  .optional()
  .describe(
    'Saved keys from Passwords to put into this command’s environment, e.g. [{"name":"GH_TOKEN","item":"<id>"}]. The user agrees first; you never see the value and it’s redacted from the output. Refer to it as $GH_TOKEN in the command.',
  );

/** Names that change how a program runs rather than what it reads, compared without case. */
const DENIED = new Set(
  [
    'PATH',
    'PATHEXT',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'IFS',
    'ENV',
    'BASH_ENV',
    'PROMPT_COMMAND',
    'PS4',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LANGUAGE',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'PYTHONHOME',
    'PERL5LIB',
    'PERL5OPT',
    'PERLLIB',
    'RUBYOPT',
    'RUBYLIB',
    'JAVA_TOOL_OPTIONS',
    '_JAVA_OPTIONS',
    'GIT_EXEC_PATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
  ].map((n) => n.toUpperCase()),
);
const DENIED_PREFIXES = ['LD_', 'DYLD_', 'LC_', 'GIT_SSH', 'GIT_CONFIG', 'BASH_FUNC_'];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why this variable can't carry a key, or undefined when it can. */
export function refusedName(name: string): string | undefined {
  if (!NAME.test(name))
    return `“${name}” isn’t a plain variable name: use letters, digits and _, like GH_TOKEN.`;
  const upper = name.toUpperCase();
  if (DENIED.has(upper) || DENIED_PREFIXES.some((p) => upper.startsWith(p)))
    return `${name} changes how programs run, so it can’t carry a saved key. Use the variable the program reads its key from (GH_TOKEN, CLOUDFLARE_API_TOKEN, PGPASSWORD…).`;
  return undefined;
}

export type SecretContext = Pick<
  ToolContext,
  'conversationId' | 'ask' | 'append' | 'signal' | 'unattended' | 'untrusted'
>;

export interface SecretEnvironment {
  env: Record<string, string>;
  /** Blanks every key Conch knows in the command's output, before the model sees it. */
  redact: (text: string) => string;
  /** The longest value set: how much of a stream's tail to hold back (`redactingStream`). */
  longest: number;
}

/** Most chats remembered at once; the oldest is forgotten first. */
const MAX_CHATS = 500;

/**
 * Reads the keys a command asked for, asking the person as Passwords does. "Allow in
 * this chat" is remembered here, in memory, per chat, item, field and variable.
 */
export class CommandSecrets {
  readonly #allowed = new Map<string, Set<string>>();

  constructor(private readonly vault: VaultService) {}

  /** Throws a sentence the model can act on when a key can't be used. */
  async environment(
    ctx: SecretContext,
    wanted: readonly SecretRef[],
    { command, tool }: { command: string; tool: string },
  ): Promise<SecretEnvironment> {
    if (ctx.unattended)
      throw new Error(
        'Nobody is here to agree to using a saved key, so this run can’t use one. Do it without the key, or leave it for the user.',
      );
    const names = new Set<string>();
    for (const ref of wanted) {
      const refused = refusedName(ref.name);
      if (refused) throw new Error(refused);
      const upper = ref.name.toUpperCase();
      if (names.has(upper)) throw new Error(`${ref.name} is given twice. Give each variable once.`);
      names.add(upper);
    }
    const show = (request: VaultRequest) => ctx.append({ type: 'vault.request', request });
    if (!(await this.vault.ensureOpen(show, ctx.signal)))
      throw new Error(
        'The user’s Passwords is locked and wasn’t unlocked. Tell them what the command needs it for; they can unlock it from the chat.',
      );
    const env: Record<string, string> = {};
    let longest = 0;
    for (const ref of wanted) {
      let policy: Awaited<ReturnType<VaultService['readPolicy']>>;
      try {
        policy = await this.vault.readPolicy(ref.item, ref.field);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'That item couldn’t be read.');
      }
      const key = `${ref.item}\u0000${policy.field.id}\u0000${ref.name.toUpperCase()}`;
      // After reading something untrusted, a page may be asking for the key: always the person.
      const tainted = ctx.untrusted?.();
      if (tainted || (policy.ask && !this.#isAllowed(ctx.conversationId, key))) {
        const decision = await ctx.ask({
          toolName: tool,
          input: { item: policy.title, field: policy.field.label, name: ref.name },
          summary: `use the ${policy.field.label.toLowerCase()} of “${policy.title}” in a command`,
          vault: {
            action: 'use',
            itemTitle: policy.title,
            itemType: policy.type,
            fieldLabel: policy.field.label,
            ...(ref.reason && { reason: ref.reason }),
            sensitive: policy.sensitive,
            envName: ref.name,
            command: command.length > 400 ? `${command.slice(0, 399)}…` : command,
          },
          ...(tainted && { taint: tainted }),
        });
        if (decision === 'deny')
          throw new Error(
            `The user said no to using “${policy.title}” in this command. Don’t ask for it in the chat; carry on without it or ask how they’d like to continue.`,
          );
        if (decision === 'allow-always')
          await this.vault.allowRead(ref.item).catch(() => undefined);
        this.#allow(ctx.conversationId, key);
      }
      ctx.signal.throwIfAborted();
      let value: string;
      try {
        // Recorded as a use, and remembered by the redactor.
        value = await this.vault.readValue(ref.item, policy.field.id);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'That item couldn’t be read.');
      }
      env[ref.name] = value;
      longest = Math.max(longest, value.length);
    }
    return { env, redact: this.vault.redactor(), longest };
  }

  #isAllowed(chat: string, key: string): boolean {
    return this.#allowed.get(chat)?.has(key) ?? false;
  }

  #allow(chat: string, key: string) {
    const keys = this.#allowed.get(chat) ?? new Set<string>();
    keys.add(key);
    this.#allowed.delete(chat);
    this.#allowed.set(chat, keys);
    if (this.#allowed.size > MAX_CHATS) {
      const oldest = this.#allowed.keys().next().value;
      if (oldest !== undefined) this.#allowed.delete(oldest);
    }
  }
}

/**
 * Output that arrives in pieces, redacted: a key split across two pieces is
 * caught by holding back as much of the tail as a key (in any of the forms the
 * redactor knows) could take, until the next piece or the end.
 */
export function redactingStream(
  redact: (text: string) => string,
  longest: number,
): { push: (text: string) => string; end: () => string } {
  // URL-encoding is the longest form a value travels in: up to three characters each.
  const hold = Math.max(0, longest * 3 - 1);
  let held = '';
  return {
    push: (text) => {
      const all = redact(held + text);
      const cut = Math.max(0, all.length - hold);
      held = all.slice(cut);
      return all.slice(0, cut);
    },
    end: () => {
      const rest = redact(held);
      held = '';
      return rest;
    },
  };
}
