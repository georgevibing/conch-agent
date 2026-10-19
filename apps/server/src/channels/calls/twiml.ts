/**
 * TwiML, the few words of it Conch speaks (ADR 0138): what Twilio does next
 * on a call. Every value is escaped, so nothing the assistant or a caller
 * said can become an instruction to Twilio.
 */

/** Text as XML text or an attribute's value: nothing in it is markup. */
export function xml(text: string): string {
  return (
    text
      // Control characters aren't allowed in XML 1.0 at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

export type Verb =
  | { say: string }
  | { pause: number }
  | { hangup: true }
  | { reject: 'busy' | 'rejected' }
  | { redirect: string }
  | {
      gather: {
        action: string;
        /** Keys, words, or both. */
        input: 'speech' | 'dtmf' | 'dtmf speech';
        /** Seconds of silence before it gives up (speech: `auto` ends at a pause). */
        timeout?: number;
        numDigits?: number;
        /** Words it should expect ("yes, no"). */
        hints?: string;
        /** What's said while it listens; a word or a key stops it (barge-in). */
        say?: string[];
      };
    }
  | {
      /** The call's audio, both ways, over a WebSocket (Media Streams). */
      stream: { url: string; parameters: Record<string, string> };
    };

const attrs = (pairs: Record<string, string | number | undefined>) =>
  Object.entries(pairs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${xml(String(v))}"`)
    .join('');

/** Spoken by Twilio's own voice: one sentence or a few, never markup. */
const say = (text: string) => `<Say>${xml(text)}</Say>`;

function verb(v: Verb): string {
  if ('say' in v) return say(v.say);
  if ('pause' in v) return `<Pause${attrs({ length: Math.max(1, Math.round(v.pause)) })}/>`;
  if ('hangup' in v) return '<Hangup/>';
  if ('reject' in v) return `<Reject${attrs({ reason: v.reject })}/>`;
  if ('redirect' in v) return `<Redirect method="POST">${xml(v.redirect)}</Redirect>`;
  if ('gather' in v) {
    const g = v.gather;
    const speech = g.input !== 'dtmf';
    return `<Gather${attrs({
      input: g.input,
      action: g.action,
      method: 'POST',
      actionOnEmptyResult: 'true',
      timeout: g.timeout ?? 5,
      numDigits: g.numDigits,
      hints: g.hints,
      ...(speech && { speechTimeout: 'auto', bargeIn: 'true' }),
    })}>${(g.say ?? []).map(say).join('')}</Gather>`;
  }
  const params = Object.entries(v.stream.parameters)
    .map(([name, value]) => `<Parameter${attrs({ name, value })}/>`)
    .join('');
  return `<Connect><Stream${attrs({ url: v.stream.url })}>${params}</Stream></Connect>`;
}

/** A whole TwiML document. */
export function twiml(...verbs: Verb[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.map(verb).join('')}</Response>`;
}
