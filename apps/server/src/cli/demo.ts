/**
 * Every piece of the terminal kit, one after another, to look at:
 *
 *   pnpm --filter @conch/server exec tsx src/cli/demo.ts
 *
 * Try it with `NO_COLOR=1`, `FORCE_COLOR=1` (16 colours), `FORCE_COLOR=2`
 * (256) and piped into `cat` (no terminal) to see how each one degrades.
 */
import { banner, working } from './pearl';
import { createPrompts } from './prompts';
import { createUi } from './ui';
import { DONE_LINES, greeting, pick, plural, until } from './words';

const ui = createUi();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

await banner(ui, { line: greeting(), sub: 'v0.9.0 · conch.example.com', shimmer: 1600 });

ui.rule('Steps');
const node = ui.step('Getting Node.js 24');
await wait(700);
node.done('Node.js 24.9.0');
const git = ui.step('Looking for Git');
await wait(500);
git.warn('Git is old (2.30), so releases aren’t signature-checked');
ui.blank();

ui.rule('A long wait');
await working(
  ui,
  'Waiting for conch.example.com to point here',
  async ({ update }) => {
    for (let i = 1; i <= 6; i++) {
      await wait(900);
      update(`Waiting for conch.example.com to point here ${ui.dim(`(look ${i})`)}`);
    }
  },
  { done: 'conch.example.com points here', chatterAfter: 1500, chatterEvery: 1600 },
);
ui.blank();

ui.rule('The one thing');
ui.say('Open this on your computer to make Conch yours:');
ui.blank();
const link = 'https://conch.example.com/#hello=7KQ2mZx9Lr4vN8pW';
ui.box([ui.link(link), ui.dim(`Works once, ${until(Date.now() + 60 * 60 * 1000)}.`)], {
  title: 'Make it yours',
  tone: 'accent',
});
ui.blank();
ui.qr(link);
ui.blank();

ui.rule('Bits and pieces');
ui.kv([
  ['Address', ui.link('https://conch.example.com')],
  ['Certificate', `${ui.success(ui.sym.dot)} good ${until(Date.now() + 52 * 24 * 3600 * 1000)}`],
  ['Devices', `${plural(3, 'device')} ${ui.dim(`· ${plural(1, 'waiting', 'waiting')}`)}`],
]);
ui.blank();
ui.ok(`Approved “Chrome on Windows”. ${pick(DONE_LINES, 1)}`);
ui.note('Approve new devices is off. Anyone with your password gets in.');
ui.error('Let’s Encrypt couldn’t reach this server on port 80.');
ui.hint(
  'If your provider has a firewall (Hetzner, AWS, DigitalOcean…), open ports 80 and 443 there.',
);
ui.command('conch devices approve K7M-Q2X');
ui.blank();

const prompts = createPrompts({ ui });
if (prompts.interactive && process.stdin.isTTY) {
  ui.rule('A question');
  const reach = await prompts.choose('How will you reach Conch?', [
    {
      value: 'own',
      label: 'From anywhere, at an address of my own',
      hint: 'like conch.yourname.com',
    },
    {
      value: 'proxy',
      label: 'Through a tunnel or web server I already run',
      hint: 'Cloudflare Tunnel, nginx, Caddy',
    },
    { value: 'tailscale', label: 'Only from my own devices, privately', hint: 'Tailscale' },
    { value: 'local', label: 'Just from this computer for now' },
  ]);
  if (reach === 'own') {
    const name = await prompts.ask('Your address:', { default: 'conch.example.com' });
    ui.ok(`Great, ${ui.accent(name ?? '')} it is.`);
  }
  prompts.close();
  ui.blank();
}
