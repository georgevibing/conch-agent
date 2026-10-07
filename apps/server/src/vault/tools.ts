import {
  siteOf,
  VaultFieldKind,
  VaultFieldRole,
  VaultItemType,
  type VaultRequest,
} from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { VaultError, type VaultService } from './service';

/**
 * What the agent may do with Passwords (ADR 0025 § The agent):
 *
 * - `passwords_find`: what's saved, by name and site. Never a value.
 * - `passwords_request`: ask the person for a credential. They type it into a
 *   card in the chat and it goes straight into the vault; the agent only
 *   learns it was saved. There's no tool that saves a value the agent writes.
 * - `passwords_read`: read one field (a PIN, a note, a key for a command),
 *   after the person says yes in the chat. Logins are better filled by
 *   `browser_type`, which never shows the model the password.
 *
 * Anything needing Passwords open shows an Unlock card while it's locked,
 * and carries on once the person unlocks it.
 */
export function vaultTools(vault: VaultService, ctx: ToolContext): HostTool[] {
  const show = (request: VaultRequest) => ctx.append({ type: 'vault.request', request });
  const open = async () => {
    if (await vault.ensureOpen(show, ctx.signal)) return undefined;
    return 'The user’s Passwords is locked and wasn’t unlocked. Tell them what you need it for; they can unlock it from the chat.';
  };

  const find: HostTool<{ query: z.ZodOptional<z.ZodString> }> = {
    name: 'passwords_find',
    effect: 'read',
    description:
      'List the user’s saved passwords, cards, notes and keys by name and website (never their values). Use it to pick the item to fill with browser_type, or to read with passwords_read.',
    searchHint: 'password login sign in credentials saved account card note key secret',
    input: {
      query: z
        .string()
        .max(200)
        .optional()
        .describe('A name or website to look for, e.g. “github”.'),
    },
    run: async ({ query }) => {
      const locked = await open();
      if (locked) return locked;
      const items = await vault.forAgent(query);
      if (!items.length)
        return query
          ? `Nothing saved matches “${query}”. If you need it, ask the user with passwords_request.`
          : 'The user has no saved passwords yet.';
      return items
        .map(
          (i) =>
            `- ${i.title} (${i.type}${i.sites.length ? `, ${i.sites.join(', ')}` : ''}${i.source === 'conch' ? '' : `, from ${i.source}`}) id=${i.id}`,
        )
        .join('\n');
    },
  };

  const request: HostTool<{
    title: z.ZodString;
    type: z.ZodDefault<typeof VaultItemType>;
    site: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
    fields: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<{
          label: z.ZodString;
          kind: typeof VaultFieldKind;
          role: z.ZodOptional<typeof VaultFieldRole>;
        }>
      >
    >;
  }> = {
    name: 'passwords_request',
    description:
      'Ask the user for a credential you need (a login, an API key, a card): they type it into a secure card in the chat, and it’s saved to their Passwords. You never see it; you get the saved item’s id to use with browser_type or passwords_read. Never ask for a password or key in the chat itself.',
    searchHint: 'ask user credential password api key token login save store',
    input: {
      title: z
        .string()
        .min(1)
        .max(200)
        .describe('What to call it, e.g. “GitHub” or “OpenWeather API key”.'),
      type: VaultItemType.default('login').describe('login, apiKey, card, note…'),
      site: z.string().max(300).optional().describe('The website it’s for, e.g. “github.com”.'),
      reason: z
        .string()
        .min(1)
        .max(300)
        .describe('One line on why you need it, shown to the user.'),
      fields: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            kind: VaultFieldKind,
            role: VaultFieldRole.optional(),
          }),
        )
        .max(12)
        .optional()
        .describe('The fields to ask for. Leave out for the usual ones of the type.'),
    },
    run: async ({ title, type, site, reason, fields }) => {
      const locked = await open();
      if (locked) return locked;
      const host = site ? siteOf(site) : undefined;
      const outcome = await vault.request(
        {
          kind: 'save',
          title,
          itemType: type,
          reason,
          ...(host && { site: host }),
          ...(fields?.length && { fields }),
        },
        show,
        ctx.signal,
      );
      if (outcome.itemId)
        return `The user saved it to Passwords as “${title}” (id=${outcome.itemId}). You don’t see its value. To sign in, use browser_type on the field (pass item=${outcome.itemId}); to use another field, passwords_read. Don’t ask again this turn.`;
      if (outcome.declined)
        return 'The user chose not to give it. Don’t ask for it again in the chat; carry on without it or ask how they’d like to continue.';
      return 'Nobody filled in the card. Don’t ask for the value in the chat; tell the user what you were waiting for.';
    },
  };

  const read: HostTool<{
    item: z.ZodString;
    field: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
  }> = {
    name: 'passwords_read',
    description:
      'Read one field of a saved item (a note, a PIN, an account number, a key you must use in a command), after the user agrees in the chat. The value enters your context, so only ask when you must use it yourself; to sign in on a website use browser_type instead, which fills it without you seeing it. Never repeat a value back in your reply.',
    searchHint: 'read secure note pin account number api key token secret value use',
    input: {
      item: z.string().min(1).max(300).describe('The item id from passwords_find.'),
      field: z
        .string()
        .max(80)
        .optional()
        .describe('Which field, by its name (e.g. “PIN”, “Note”, “Key”).'),
      reason: z
        .string()
        .min(1)
        .max(300)
        .describe('One line on what you’ll do with it, shown to the user.'),
    },
    run: async ({ item, field, reason }) => {
      const locked = await open();
      if (locked) return locked;
      let policy: Awaited<ReturnType<VaultService['readPolicy']>>;
      try {
        policy = await vault.readPolicy(item, field);
      } catch (error) {
        return error instanceof VaultError ? error.message : 'That item couldn’t be read.';
      }
      if (policy.ask) {
        const decision = await ctx.ask({
          toolName: 'passwords_read',
          input: { item: policy.title, field: policy.field.label },
          summary: `read the ${policy.field.label.toLowerCase()} of “${policy.title}”`,
          vault: {
            action: 'read',
            itemTitle: policy.title,
            itemType: policy.type,
            fieldLabel: policy.field.label,
            reason,
            sensitive: policy.sensitive,
          },
        });
        if (decision === 'deny')
          return 'The user said no. Don’t ask for it in the chat; carry on without it or ask how they’d like to continue.';
        if (decision === 'allow-always') await vault.allowRead(item).catch(() => undefined);
      }
      try {
        const value = await vault.readValue(item, policy.field.id);
        return `${policy.field.label} of “${policy.title}”: ${value}\n(Use it for what you said; don’t repeat it in your reply.)`;
      } catch (error) {
        return error instanceof VaultError ? error.message : 'That item couldn’t be read.';
      }
    },
  };

  return [find, request, read] as unknown as HostTool[];
}
