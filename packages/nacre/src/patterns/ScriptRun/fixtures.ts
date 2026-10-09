import type { ScriptRunAsk, ScriptRunCall, ScriptRunTally } from './ScriptRun';

/** The script a run tells: tag the invoices among the last 300 emails. */
export const invoiceScript = `const found = await tools.google_mail_search({ query: 'newer_than:30d', max: 300 });
let tagged = 0;
for (const [i, mail] of found.entries()) {
  const message = await tools.google_mail_read({ id: mail.id });
  progress(i + 1, found.length, 'emails');
  if (!/invoice|receipt|rechnung/i.test(message.subject + message.text)) continue;
  await tools.google_mail_modify({ id: mail.id, add: ['Invoices'] });
  tagged++;
  note(\`Tagged \${tagged} invoices so far\`);
}
note(\`Tagged \${tagged} invoices among \${found.length} emails\`);
return { tagged, read: found.length };`;

const senders = [
  'billing@studio.example',
  'anna@example.com',
  'noreply@shop.example',
  'team@kelp.example',
];

/** Calls a run made, `reads` emails read and `tags` of them tagged. */
export function callsFor(reads: number, tags: number, running = false): ScriptRunCall[] {
  const calls: ScriptRunCall[] = [
    {
      id: 'c0',
      step: 1,
      tool: 'google_mail_search',
      summary: 'newer_than:30d',
      status: 'success',
      input: '{"query":"newer_than:30d","max":300}',
      output: '[{"id":"18f2a…"}, … 300 emails]',
      durationMs: 840,
    },
  ];
  let step = 2;
  let tagged = 0;
  for (let i = 0; i < reads; i++) {
    const last = running && i === reads - 1;
    calls.push({
      id: `r${i}`,
      step: step++,
      tool: 'google_mail_read',
      summary: senders[i % senders.length],
      status: last ? 'running' : 'success',
      input: `{"id":"18f2a${i.toString(16).padStart(4, '0')}"}`,
      ...(!last && {
        output: `{"from":"${senders[i % senders.length]}","subject":"${i % 6 === 0 ? 'Invoice' : 'Re: plans'} #${i}"}`,
        durationMs: 120 + ((i * 37) % 160),
      }),
    });
    if (i % 6 === 0 && tagged < tags && !last) {
      tagged++;
      calls.push({
        id: `t${i}`,
        step: step++,
        tool: 'google_mail_modify',
        summary: `Invoice #${i}`,
        status: 'success',
        input: `{"id":"18f2a${i.toString(16).padStart(4, '0')}","add":["Invoices"]}`,
        output: 'Labelled it Invoices.',
        durationMs: 210,
      });
    }
  }
  return calls;
}

export function tallyFor(reads: number, tags: number, running = false): ScriptRunTally[] {
  return [
    {
      tool: 'google_mail_read',
      label: 'Read an email',
      family: 'explore',
      calls: reads,
      ...(running && { running: 1 }),
    },
    { tool: 'google_mail_modify', label: 'Labelled an email', family: 'edit', calls: tags },
    { tool: 'google_mail_search', label: 'Searched your email', family: 'explore', calls: 1 },
  ];
}

export const sendScript = `const late = await tools.google_mail_search({ query: 'label:unpaid older_than:14d' });
for (const mail of late) {
  try {
    await tools.google_mail_send({ to: mail.from, subject: 'A friendly reminder', body: reminder(mail) });
  } catch (error) {
    if (error.name !== 'Declined') throw error;
  }
}
return late.length;`;

export const asked: ScriptRunAsk[] = [
  { id: 'p1', step: 2, text: 'Send an email to billing@studio.example', answer: 'allowed' },
  { id: 'p2', step: 3, text: 'Send an email to anna@example.com', answer: 'declined' },
  { id: 'p3', step: 48, text: 'Send an email to noreply@shop.example', answer: 'waiting' },
];

export const invoiceResult = `It returned:
{
  "tagged": 47,
  "read": 300
}

348 tool calls: google_mail_read ×300, google_mail_modify ×47, google_mail_search ×1 · 12.4 s of work.`;
