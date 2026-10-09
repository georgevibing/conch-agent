/**
 * Every `conch` command (`pnpm conch` in a checkout), in words: what `conch help` prints and what
 * the documentation's CLI reference is generated from (`apps/docs/reference`).
 *
 * A command exists once it has a row here: `cli.ts` types its handlers by
 * these names, so a new command without its words doesn't compile.
 */

export type CliGroup =
  'Getting started' | 'Signing in' | 'Devices' | 'Running Conch' | 'Your things';

export interface CliSubcommand {
  /** What follows the command, as help shows it: `approve [code] [--yes]`. */
  usage: string;
  summary: string;
}

export interface CliCommand {
  /** The word after `conch` that picks the handler. */
  name: string;
  /** The command with its arguments, as help shows it. */
  usage: string;
  /** One line, as `conch help` says it. */
  summary: string;
  group: CliGroup;
  /** For the documentation: what it does and what to expect, in a sentence or two. */
  detail: string;
  subcommands?: readonly CliSubcommand[];
}

export const DEVICES_SUBCOMMANDS = [
  { usage: '(nothing), list [--json]', summary: 'What has signed in, and who is waiting' },
  {
    usage: 'approve [code] [--yes]',
    summary: 'Let a waiting device in (asks which, or waits for one)',
  },
  { usage: 'reject [code] [--all]', summary: 'Turn a waiting device down' },
  { usage: 'remove [id] [--yes]', summary: 'Forget a device and sign it out' },
  { usage: 'rename <id> <name>', summary: 'Give a device a name you’ll recognise' },
  { usage: 'on', summary: 'New devices need your approval after signing in' },
  { usage: 'off', summary: 'Anyone with the password or key gets in again' },
] as const satisfies readonly CliSubcommand[];

export const SKILLS_SUBCOMMANDS = [
  { usage: 'sign <folder> [--as name]', summary: 'Sign a skill you share' },
  { usage: 'key', summary: 'Your public key, for people who trust you' },
  { usage: 'key --new', summary: 'A new key, when yours can’t be opened' },
  { usage: 'trust <key> --as name', summary: 'Trust a publisher’s key' },
  { usage: 'trusted', summary: 'Whose skills you trust' },
  { usage: 'forget <fingerprint>', summary: 'Stop trusting a publisher' },
] as const satisfies readonly CliSubcommand[];

export const PASSKEYS_SUBCOMMANDS = [
  { usage: '(nothing)', summary: 'Your passkeys, and where each one works' },
  { usage: 'remove <id>', summary: 'Forget one (never the last way in)' },
] as const satisfies readonly CliSubcommand[];

export const ADDRESS_SUBCOMMANDS = [
  { usage: '(nothing), status', summary: 'Where Conch answers, and its certificate' },
  { usage: 'set <name>', summary: 'Answer at this address (the same steps as setup)' },
  {
    usage: 'set <name> --proxy',
    summary: 'Answer at this address through a tunnel or web server you run',
  },
  {
    usage: 'renew',
    summary: 'Renew the certificate now (behind a proxy: look through it again)',
  },
  { usage: 'here', summary: 'Turn on here an address a backup brought from another computer' },
  { usage: 'off', summary: 'Stop answering at it' },
] as const satisfies readonly CliSubcommand[];

export const DASHBOARDS_SUBCOMMANDS = [
  { usage: '(nothing), status', summary: 'Where Conch’s numbers go, and how sending is going' },
  {
    usage: 'prometheus [--this-computer]',
    summary: 'Turn on /metrics, with a new scrape token and the config that uses it',
  },
  {
    usage: 'send <destination> [--endpoint <url>] [--region <id>]',
    summary: 'Send to Grafana Cloud, Honeycomb, Datadog, New Relic, Langfuse, Phoenix…',
  },
  { usage: 'test', summary: 'Send a real span and the numbers now, and say if they arrived' },
  { usage: 'token', summary: 'A new scrape token (the old one stops working)' },
  { usage: 'off', summary: 'Stop sending, and close /metrics' },
] as const satisfies readonly CliSubcommand[];

export const CLI_COMMANDS = [
  {
    name: 'setup',
    usage: 'setup [--domain <name> | --proxy <name> | --tailscale | --local]',
    summary: 'Choose how you’ll reach Conch, and make it yours',
    group: 'Getting started',
    detail:
      'Asks how you’ll reach Conch: at an address of your own (conch.yourname.com), through a tunnel or web server you already run (Cloudflare Tunnel, nginx, Caddy), privately with Tailscale, or only from this computer. For an address, it shows the DNS record to add and waits for it, gets Conch permission to answer on ports 80 and 443 (asking once for your password on Linux), opens this server’s firewall when you say so, and gets a certificate from Let’s Encrypt. Through your own tunnel, it says where to point it, and checks the way in through it. Either way it ends with the link that makes Conch yours. The installer runs it on a server; run it again any time to change your mind. --yes asks nothing.',
  },
  {
    name: 'address',
    usage: 'address [set <name>|renew|here|off]',
    summary: 'Your own address: where Conch answers over HTTPS',
    group: 'Getting started',
    detail:
      'With nothing after it, says where Conch answers, how long its certificate is good for (or which tunnel or web server answers for it) and anything in the way, with the one thing to do about it. Conch renews the certificate by itself. off stops answering there; set changes it, through the same steps as setup, and set <name> --proxy for a name your own tunnel or web server answers at.',
    subcommands: ADDRESS_SUBCOMMANDS,
  },
  {
    name: 'hello',
    usage: 'hello',
    summary: 'A link that makes this Conch yours',
    group: 'Getting started',
    detail:
      'For a Conch nobody has signed in to yet, often one on a server: prints a one-time link and a QR code. Open it on your own computer to choose Touch ID, Windows Hello or a password. Whoever opens it first owns this Conch, and it works once, for an hour. After conch reset, it’s the way back in.',
  },
  {
    name: 'open',
    usage: 'open [page] [--link]',
    summary: 'Open Conch in your browser, as this computer',
    group: 'Getting started',
    detail:
      'Opens Conch in your default browser as the computer it runs on, as its app does: that browser can then use Conch with sign-in off, and approve devices. --link prints a one-time link instead, for another browser on this computer or one at the end of an SSH tunnel. It works once, for two minutes, and only on this computer.',
  },
  {
    name: 'status',
    usage: 'status',
    summary: 'Security checkup',
    group: 'Signing in',
    detail:
      'The same checkup as Settings → Security: each warning in plain words with its fix, then how many devices are signed in, how many access keys exist and whether a device is waiting.',
  },
  {
    name: 'password',
    usage: 'password [--generate]',
    summary: 'Choose a password (or have a strong one made)',
    group: 'Signing in',
    detail:
      'Turns password sign-in on. Asks for a username and a password of at least 15 characters, typed twice; an empty line, or --generate, makes a strong one and shows it once. Every other signed-in device is signed out.',
  },
  {
    name: 'key',
    usage: 'key [name]',
    summary: 'Create an access key',
    group: 'Signing in',
    detail:
      'Makes a key for a script or another device and shows it once. Paste it on the sign-in screen, or send it as an Authorization: Bearer header.',
  },
  {
    name: 'keys',
    usage: 'keys',
    summary: 'List access keys',
    group: 'Signing in',
    detail: 'Each key’s name, its last characters, its id and when it was last used.',
  },
  {
    name: 'revoke',
    usage: 'revoke <id>',
    summary: 'Revoke an access key',
    group: 'Signing in',
    detail: 'The key stops working at once, and every device signed in with it is signed out.',
  },
  {
    name: 'pair',
    usage: 'pair',
    summary: 'Sign in your phone with a QR code',
    group: 'Signing in',
    detail:
      'Prints a QR code and a link that sign one device in. It works once, for ten minutes. Sign-in has to be set up first, and the phone has to be able to reach Conch: conch phone gives it a private address, conch setup an address of your own.',
  },
  {
    name: 'passkeys',
    usage: 'passkeys [remove <id>]',
    summary: 'Your passkeys: Touch ID, Windows Hello, Face ID',
    group: 'Signing in',
    detail:
      'Lists the passkeys that sign in to Conch, the address each works at, and when each was last used. remove forgets one and signs out what it signed in, but never your last way in. Passkeys are added from Conch itself, on the device that keeps them.',
    subcommands: PASSKEYS_SUBCOMMANDS,
  },
  {
    name: 'devices',
    usage: 'devices',
    summary: 'What has signed in; approve new devices (devices help)',
    group: 'Devices',
    detail:
      'Lists every device that has signed in and any that are waiting. With approval on, a new device waits, even with the right password, until you let it in: here, or from a device that’s already signed in.',
    subcommands: DEVICES_SUBCOMMANDS,
  },
  {
    name: 'sign-out-everywhere',
    usage: 'sign-out-everywhere',
    summary: 'Sign every device out',
    group: 'Devices',
    detail: 'Ends every session at once. Your password and access keys keep working.',
  },
  {
    name: 'reset',
    usage: 'reset',
    summary: 'Forgot your password or lost a passkey? Start again',
    group: 'Signing in',
    detail:
      'The way back in: having this terminal is the proof that it’s you. Forgets the password, every access key and every passkey, signs every device out and leaves Conch open to this computer only (on a server, conch hello then makes it yours again). Every browser on this computer opens Conch from your apps once more. Asks you to type “reset” first.',
  },
  {
    name: 'command',
    usage: 'command [on|off]',
    summary: 'Put the conch command on your PATH (or take it off)',
    group: 'Running Conch',
    detail:
      'The installer does this for you: conch then works in any terminal, without going to Conch’s folder first. It always runs the version of Conch that’s running. When its folder isn’t on your PATH yet, Conch adds one marked line to your shell’s profile; off takes the command and that line away again.',
  },
  {
    name: 'background',
    usage: 'background [on|off]',
    summary: 'Always on: start at login, run with no window',
    group: 'Running Conch',
    detail:
      'With nothing after it, says whether Always on is on and where Conch is running. on starts Conch at login and moves it to the background now; off stops it starting by itself, and leaves the running Conch alone.',
  },
  {
    name: 'quit',
    usage: 'quit',
    summary: 'Stop Conch, wherever it’s running',
    group: 'Running Conch',
    detail:
      'Stops the Conch that is answering, in a window or in the background. With Always on, it starts again at the next login or when you open the app.',
  },
  {
    name: 'shortcut',
    usage: 'shortcut [remove]',
    summary: 'Put Conch where your apps are (Applications, Start)',
    group: 'Running Conch',
    detail:
      'Adds Conch to Applications, the Start menu or the app menu. Opening it starts Conch first when it isn’t running. remove takes it out again.',
  },
  {
    name: 'tray',
    usage: 'tray [on|off]',
    summary: 'Conch in the menu bar, tray or panel',
    group: 'Running Conch',
    detail:
      'Shows a pearl that says whether Conch is running, wears a dot when something needs you, and opens, starts or quits Conch. With nothing after it, says whether it’s showing.',
  },
  {
    name: 'background',
    usage: 'background after-logout on',
    summary: 'Keep running after you log out (Linux)',
    group: 'Running Conch',
    detail:
      'For a computer that stays on. When it needs an administrator, it prints the one command to run. off undoes it.',
  },
  {
    name: 'phone',
    usage: 'phone',
    summary: 'Give your phone a secure address (Tailscale)',
    group: 'Running Conch',
    detail:
      'Turns on an encrypted address that only your own devices can reach, through Tailscale, and prints it. When Tailscale is missing, stopped or signed out, it says what to do next.',
  },
  {
    name: 'import',
    usage: 'import --from <app> [--dry-run]',
    summary: 'Bring your things from OpenClaw or Hermes',
    group: 'Your things',
    detail:
      'Brings memories, your persona, skills (off until you turn them on) and scheduled jobs (as draft routines) from openclaw or hermes. --dry-run only lists what would come over. Chat bots and keys come over in the app, where you can tick them.',
  },
  {
    name: 'skills',
    usage: 'skills sign <folder>',
    summary: 'Sign a skill you share (skills help)',
    group: 'Your things',
    detail:
      'Signs a skill folder with your key, so people who trust you see “Verified”, and manages whose signed skills you trust. Your key is locked with this computer’s own key, so it opens here and nowhere else (a passphrase-locked backup carries it to a new computer).',
    subcommands: SKILLS_SUBCOMMANDS,
  },
  {
    name: 'dashboards',
    usage: 'dashboards [prometheus | send <destination> | test | off]',
    summary: 'Conch’s numbers on a dashboard of your own (dashboards help)',
    group: 'Running Conch',
    detail:
      'Turns on the Prometheus page at /metrics (behind a scrape token, or for programs on this computer only) and prints the scrape config, or sends Conch’s numbers and the shape of each turn over OpenTelemetry to Grafana Cloud, Honeycomb, Datadog, New Relic, Langfuse, Phoenix, a Grafana on this computer or any collector. Paste what the service shows you and Conch reads the endpoint and key out of it. Never the words of your chats: those go only if you turn them on in Settings → Dashboards.',
    subcommands: DASHBOARDS_SUBCOMMANDS,
  },
] as const satisfies readonly CliCommand[];

/** The words that pick a handler in `cli.ts`. */
export type CliCommandName = (typeof CLI_COMMANDS)[number]['name'];
