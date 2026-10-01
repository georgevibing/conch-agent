/**
 * Every `pnpm conch` command, in words: what `pnpm conch help` prints and what
 * the documentation's CLI reference is generated from (`apps/docs/reference`).
 *
 * A command exists once it has a row here: `cli.ts` types its handlers by
 * these names, so a new command without its words doesn't compile.
 */

export type CliGroup = 'Signing in' | 'Devices' | 'Running Conch' | 'Your things';

export interface CliSubcommand {
  /** What follows the command, as help shows it: `approve [code] [--yes]`. */
  usage: string;
  summary: string;
}

export interface CliCommand {
  /** The word after `pnpm conch` that picks the handler. */
  name: string;
  /** The command with its arguments, as help shows it. */
  usage: string;
  /** One line, as `pnpm conch help` says it. */
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
  { usage: 'trust <key> --as name', summary: 'Trust a publisher’s key' },
  { usage: 'trusted', summary: 'Whose skills you trust' },
  { usage: 'forget <fingerprint>', summary: 'Stop trusting a publisher' },
] as const satisfies readonly CliSubcommand[];

export const CLI_COMMANDS = [
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
      'Prints a QR code and a link that sign one device in. It works once, for ten minutes. Sign-in has to be set up first, and the phone has to be able to reach Conch: pnpm conch phone gives it an address.',
  },
  {
    name: 'devices',
    usage: 'devices',
    summary: 'What has signed in; approve new devices (devices help)',
    group: 'Devices',
    detail:
      'Lists every device that has signed in and any that are waiting. With approval on, a new device waits, even with the right password, until you let it in from this computer.',
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
    summary: 'Forgot your password? Turn sign-in off and start again',
    group: 'Signing in',
    detail:
      'The way back in: having this terminal is the proof that it’s you. Deletes the password and every access key, signs every device out and leaves Conch open to this computer only. Asks you to type “reset” first.',
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
      'Signs a skill folder with your key, so people who trust you see “Verified”, and manages whose signed skills you trust.',
    subcommands: SKILLS_SUBCOMMANDS,
  },
] as const satisfies readonly CliCommand[];

/** The words that pick a handler in `cli.ts`. */
export type CliCommandName = (typeof CLI_COMMANDS)[number]['name'];
