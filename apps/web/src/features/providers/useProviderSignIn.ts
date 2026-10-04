import type { Provider } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useCallback } from 'react';
import { create } from 'zustand';

import { providersApi } from './api';
import { errorText } from './queries';

const POPUP = 'conch-provider-sign-in';
/** The sign-in window says how it went here, the moment it knows (`ProviderDone`). */
export const SIGN_IN_CHANNEL = 'conch-provider-sign-in';

/**
 * The provider whose sign-in window is open right now, so its page can wait
 * with you; `finishing` once the window said it worked, until Conch sees it.
 */
export const useSignInWindow = create<{ open?: string; finishing?: boolean }>(() => ({}));

/** A centred window, opened synchronously in the click so popup blockers allow it. */
function openPopup(): Window | null {
  const width = 520;
  const height = 720;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 3);
  try {
    return window.open(
      '/providers/done?opening=1',
      POPUP,
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
  } catch {
    return null;
  }
}

/** Only ever send the browser to a web page — never `javascript:` or anything else. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Until the window closes: then whatever happened in it has happened. */
function watchClosed(popup: Window, id: string) {
  useSignInWindow.setState({ open: id, finishing: false });
  const timer = setInterval(() => {
    if (!popup.closed) return;
    clearInterval(timer);
    const now = useSignInWindow.getState();
    if (now.open === id && !now.finishing) useSignInWindow.setState({ open: undefined });
  }, 500);
}

/**
 * Let a provider make a key for you. A small window opens straight away on
 * Conch's own "opening…" page, then moves to the provider once the gateway has
 * the address. When popups are blocked — or on phones, where they're awkward —
 * this tab goes instead and comes back afterwards.
 */
export function useProviderSignIn() {
  return useCallback(async (provider: Provider) => {
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const popup = touch ? null : openPopup();
    try {
      const { authorizeUrl } = await providersApi.signIn(provider.id, popup ? 'popup' : 'tab');
      if (!isWebUrl(authorizeUrl)) {
        popup?.close();
        toast.error('That sign-in address didn’t look right, so Conch didn’t open it.');
        return;
      }
      if (popup && !popup.closed) {
        popup.location.href = authorizeUrl;
        popup.focus();
        watchClosed(popup, provider.id);
      } else {
        window.location.assign(authorizeUrl);
      }
    } catch (error) {
      popup?.close();
      toast.error(errorText(error, 'Couldn’t start signing in.'));
    }
  }, []);
}
