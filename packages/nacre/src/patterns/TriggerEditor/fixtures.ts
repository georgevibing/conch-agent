import type { TriggerPreviewValue, TriggerValue } from '../Routines/types';
import type { TriggerPerson } from './TriggerEditor';

/** People someone writes to, as the gateway lists them. Made up. */
export const PEOPLE: TriggerPerson[] = [
  { address: 'anna.smith@example.com', name: 'Anna Smith' },
  { address: 'bo@example.org', name: 'Bo Lindqvist' },
  { address: 'accounts@example.net', name: 'Example Accounts' },
  { address: 'kai@example.com' },
];

export const ROUTINES = [
  { id: 'r_brief', title: 'Morning briefing' },
  { id: 'r_review', title: 'Weekly review' },
];

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

/** What the gateway would say, roughly, so stories and tests read true. */
export function fakeTriggerPreview(value: TriggerValue, onlyIf = ''): TriggerPreviewValue {
  const only = onlyIf.trim() ? `, only if ${onlyIf.trim()}` : '';
  switch (value.kind) {
    case 'mail': {
      const who = value.from.map((p) => p.name ?? p.address ?? '');
      const about = value.words.length ? ` about ${list(value.words.map((w) => `“${w}”`))}` : '';
      return {
        valid: true,
        text: who.length
          ? `When ${list(who)} email${who.length === 1 ? 's' : ''} you${about}${only}`
          : `When an email${about} arrives${only}`,
        note: 'Conch looks for new email every 2 minutes while it’s running.',
      };
    }
    case 'calendar':
      return {
        valid: true,
        text: `${value.minutesBefore} minutes before each ${value.withOthers ? 'meeting with other people' : 'calendar event'}${only}`,
        note: 'Conch reads your calendar every few minutes.',
      };
    case 'page':
      if (!/^https:\/\/[^/]+\.[^/]+/.test(value.url))
        return {
          valid: false,
          text: 'When a page changes',
          error: 'That isn’t a web address. It looks like https://example.com/page.',
        };
      return {
        valid: true,
        text: `When ${value.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')} changes${only}`,
        note: 'Conch reads the page every hour and compares its words, not its layout, times or ads.',
      };
    case 'folder':
      if (!value.path)
        return {
          valid: false,
          text: 'When a folder changes',
          error: 'Choose the folder to watch.',
        };
      return {
        valid: true,
        text: `When something changes in ${value.path.split(/[\\/]/).filter(Boolean).at(-1) ?? value.path}${only}`,
      };
    case 'task':
      return { valid: true, text: `When a task finishes${only}` };
    case 'routine': {
      const title = ROUTINES.find((r) => r.id === value.routineId)?.title;
      return title
        ? { valid: true, text: `After “${title}” runs${only}` }
        : {
            valid: false,
            text: 'After another routine runs',
            error: 'Choose the routine it follows.',
          };
    }
    case 'hook':
      return { valid: true, text: `When another app sends a message${only}` };
  }
}
