import { toast } from '@conch/nacre';

import { api } from '../../api/client';

/**
 * `/compact` and ⌘K's “Summarise this chat”: fold the start of a long chat
 * into a summary now (ADR 0055). The chat shows the line where the model's
 * memory starts; this only says how it went.
 */
export async function compactChat(conversationId: string, focus?: string): Promise<void> {
  const working = toast.loading('Summarising the start of this chat…');
  try {
    const result = await api.compactConversation(conversationId, focus?.trim() || undefined);
    toast.dismiss(working);
    if (result.compacted) toast.success('Summarised', { description: result.message });
    else toast(result.message);
  } catch (error) {
    toast.dismiss(working);
    toast.error((error as Error).message || 'That didn’t work.');
  }
}
