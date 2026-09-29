import { toast } from '@conch/nacre';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useUi } from '../../app/ui';

const results: Record<string, { tone: 'success' | 'error' | 'info'; text: string }> = {
  connected: { tone: 'success', text: 'Connected. The key is saved on this computer.' },
  denied: { tone: 'info', text: 'You didn’t allow it, so nothing was connected.' },
  expired: { tone: 'error', text: 'That sign-in took too long. Try again.' },
  failed: { tone: 'error', text: 'Signing in didn’t work. Try again.' },
};

/**
 * A provider sign-in that came back to this tab (popups blocked, or a phone):
 * say how it went, open Settings where the provider lives, then tidy the URL.
 */
export function useProviderSignInResult() {
  const [params, setParams] = useSearchParams();
  const openSettings = useUi((s) => s.openSettings);
  const result = params.get('result');
  const provider = params.get('provider');

  useEffect(() => {
    if (!result || !provider) return;
    const outcome = results[result] ?? results.failed;
    if (outcome?.tone === 'success') toast.success(outcome.text);
    else if (outcome?.tone === 'error') toast.error(outcome.text);
    else if (outcome) toast(outcome.text);
    openSettings('providers');
    setParams({}, { replace: true });
  }, [result, provider, openSettings, setParams]);
}
