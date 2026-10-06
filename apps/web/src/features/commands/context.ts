import { toast } from '@conch/nacre';

import { api } from '../../api/client';

const failed = (error: unknown) =>
  toast.error((error as Error).message || 'That didn’t work. Try again.');

/**
 * `/clear` (and ⌘K's “Start afresh in this chat”): the model forgets the
 * conversation so far, with every provider. Nothing is deleted, and the
 * toast and the line in the chat both offer Undo until something is sent.
 */
export async function clearChat(conversationId: string, name: string): Promise<void> {
  try {
    const result = await api.clearConversation(conversationId);
    if (!result.changed) return void toast(result.message);
    toast.success('Context cleared', {
      id: `clear-${conversationId}`,
      description: `${name} starts fresh from here. Your messages stay, and so does the goal.`,
      action: { label: 'Undo', onClick: () => void restoreChat(conversationId) },
    });
  } catch (error) {
    failed(error);
  }
}

/** Undo on `/clear`: the model remembers the conversation again. */
export async function restoreChat(conversationId: string): Promise<void> {
  try {
    const result = await api.restoreConversation(conversationId);
    toast.dismiss(`clear-${conversationId}`);
    if (result.changed) toast.success('Back as it was', { description: result.message });
    else toast(result.message);
  } catch (error) {
    failed(error);
  }
}

/** `/goal …`, and the goal line's Clear: set it, or take it away (with Undo). */
export async function setChatGoal(
  conversationId: string,
  goal: string | null,
  before?: string,
): Promise<boolean> {
  try {
    await api.setGoal(conversationId, goal);
    if (goal) toast.success('Goal set', { description: goal });
    else
      toast('Goal cleared', {
        ...(before && {
          action: { label: 'Undo', onClick: () => void setChatGoal(conversationId, before) },
        }),
      });
    return true;
  } catch (error) {
    failed(error);
    return false;
  }
}
