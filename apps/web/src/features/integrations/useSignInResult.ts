import { toast } from '@conch/nacre';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

const results: Record<string, { tone: 'success' | 'error' | 'info'; text: string }> = {
  connected: { tone: 'success', text: 'Connected' },
  denied: { tone: 'info', text: 'You didn’t allow access, so nothing was connected.' },
  failed: { tone: 'error', text: 'Signing in didn’t work. Try again.' },
  expired: { tone: 'error', text: 'That sign-in link expired. Start again from here.' },
};

/** A sign-in that came back to this tab (popups blocked): say how it went, then tidy the URL. */
export function useSignInResult() {
  const [params, setParams] = useSearchParams();
  const result = params.get('result');
  useEffect(() => {
    if (!result) return;
    const r = results[result];
    if (r?.tone === 'success') toast.success(r.text);
    else if (r?.tone === 'error') toast.error(r.text);
    else if (r) toast(r.text);
    setParams({}, { replace: true });
  }, [result, setParams]);
}
