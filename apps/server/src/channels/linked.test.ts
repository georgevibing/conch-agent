import { describe, expect, it } from 'vitest';

import { TextChoices } from './linked';
import { toSignal, toWhatsApp } from './linked-format';
import { personId } from './whatsapp';

const BUTTONS = [
  { label: 'Allow', data: 'p:k:a', style: 'primary' as const },
  { label: 'Always in this chat', data: 'p:k:A' },
  { label: 'Don’t allow', data: 'p:k:d', style: 'danger' as const },
];

describe('toWhatsApp', () => {
  it('writes WhatsApp’s own styles', () => {
    expect(toWhatsApp('**Done** and _quick_, ~~old~~ `npm test`')).toBe(
      '*Done* and _quick_, ~old~ `npm test`',
    );
    expect(toWhatsApp('# Plan\n- one\n- two')).toBe('*Plan*\n• one\n• two');
    expect(toWhatsApp('[the docs](https://example.com)')).toBe('the docs (https://example.com)');
  });

  it('keeps code blocks and tables monospace', () => {
    expect(toWhatsApp('```js\nlet a = 1;\n```')).toBe('```\nlet a = 1;\n```');
    expect(toWhatsApp('| a | b |\n|---|---|\n| 1 | 22 |')).toBe('```\na  b\n1  22\n```');
  });
});

describe('toSignal', () => {
  it('sends plain words with style ranges', () => {
    const { text, styles } = toSignal('**Done** and `npm test`');
    expect(text).toBe('Done and npm test');
    expect(styles).toEqual(['0:4:BOLD', '9:8:MONOSPACE']);
  });

  it('counts in UTF-16, as Signal does', () => {
    const { text, styles } = toSignal('🎉 **yes**');
    expect(text).toBe('🎉 yes');
    expect(styles).toEqual(['3:3:BOLD']);
  });

  it('never lets the text itself forge a style', () => {
    const { text, styles } = toSignal('a\uE000b\uE001c');
    expect(text).toBe('abc');
    expect(styles).toEqual([]);
  });
});

describe('TextChoices', () => {
  const ref = { chatId: 'me', messageId: 'q1' };

  it('writes the answers under the question', () => {
    expect(TextChoices.render('May I?', BUTTONS)).toBe(
      'May I?\n\nReply with a number: **1** Allow · **2** Always in this chat · **3** Don’t allow',
    );
  });

  it('turns a number, the words, or a plain yes or no into a press', () => {
    const choices = new TextChoices();
    choices.remember(ref, BUTTONS);
    expect(choices.match('me', '2')?.data).toBe('p:k:A');
    expect(choices.match('me', ' Allow! ')?.data).toBe('p:k:a');
    expect(choices.match('me', 'yes')?.data).toBe('p:k:a');
    expect(choices.match('me', 'no')?.data).toBe('p:k:d');
    expect(choices.match('me', 'don’t allow')?.data).toBe('p:k:d');
  });

  it('leaves everything else as a message: other chats, commands, sentences, answered questions', () => {
    const choices = new TextChoices();
    choices.remember(ref, BUTTONS);
    expect(choices.match('someone-else', '1')).toBeUndefined();
    expect(choices.match('me', '/stop')).toBeUndefined();
    expect(choices.match('me', 'yes, and also tell me about the weather tomorrow')).toBeUndefined();
    expect(choices.match('me', '7')).toBeUndefined();
    choices.forget(ref);
    expect(choices.match('me', '1')).toBeUndefined();
  });

  it('answers the question a reply quotes, else the newest', () => {
    const choices = new TextChoices();
    choices.remember(ref, BUTTONS);
    choices.remember({ chatId: 'me', messageId: 'q2' }, BUTTONS);
    expect(choices.match('me', '1')?.ref.messageId).toBe('q2');
    expect(choices.match('me', '1', 'q1')?.ref.messageId).toBe('q1');
  });
});

describe('personId', () => {
  it('prefers the number, and falls back to the private id', () => {
    expect(personId('4915123456789@s.whatsapp.net')).toBe('4915123456789');
    expect(personId('123456789012@lid', '4915123456789@s.whatsapp.net')).toBe('4915123456789');
    expect(personId('123456789012@lid')).toBe('l123456789012');
    expect(personId('status@broadcast')).toBeUndefined();
  });
});
