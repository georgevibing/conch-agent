/**
 * The Teams app for a bot, ready to upload (ADR 0045): Teams only shows a
 * bot people have installed, and a bot of your own is installed from a
 * small zip (a manifest and two icons) with **Apps → Manage your apps →
 * Upload an app**. Conch makes the zip, so nobody edits a manifest by hand.
 *
 * Written with `node:zlib` only: the icons are tiny PNGs drawn here (a
 * pearl on Teams' purple, and its white outline), and the zip is stored,
 * uncompressed, which every unzip reads.
 */
import { crc32, deflateSync } from 'node:zlib';

import { nativeMenu } from './commands';

/** A PNG of `size`×`size` pixels, from `paint(x, y)` → RGBA. */
function png(
  size: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) row.set(paint(x, y), 1 + x * 4);
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Teams' colour icon (192×192): a pearl on purple. */
export function colorIcon(): Buffer {
  return png(192, (x, y) => {
    const d = Math.hypot(x - 96, y - 96);
    if (d < 52) {
      // A soft highlight up and to the left.
      const light = Math.max(0, 1 - Math.hypot(x - 80, y - 78) / 60);
      const v = Math.round(225 + 30 * light);
      return [v, v, Math.min(255, v + 6), 255];
    }
    return [0x62, 0x64, 0xa7, 255];
  });
}

/** Teams' outline icon (32×32): white on transparent. */
export function outlineIcon(): Buffer {
  return png(32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5);
    return d > 9 && d < 12 ? [255, 255, 255, 255] : [255, 255, 255, 0];
  });
}

/** A zip of `files`, stored (no compression). */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt32LE(0, 10); // no date
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(file.data.length, 18);
    head.writeUInt32LE(file.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, file.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + file.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** The manifest of a personal bot that takes files, for the bot's App ID. */
export function teamsManifest(options: {
  appId: string;
  name: string;
  owner?: string;
  website: string;
}) {
  const short = options.name.slice(0, 30) || 'Conch';
  const who = options.owner ? `${options.owner}’s` : 'Your';
  return {
    $schema:
      'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
    manifestVersion: '1.17',
    version: '1.0.0',
    id: options.appId,
    developer: {
      name: 'Conch',
      websiteUrl: options.website,
      privacyUrl: options.website,
      termsOfUseUrl: options.website,
    },
    name: { short, full: `${short} on Conch`.slice(0, 100) },
    description: {
      short: `${who} assistant, running on their own computer.`.slice(0, 80),
      full: `${who} assistant on Conch. It runs on their own computer and answers here in a private chat. Only people who were let in can talk to it.`,
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: '#6264A7',
    bots: [
      {
        botId: options.appId,
        scopes: ['personal'],
        supportsFiles: true,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ['personal'],
            // Conch's commands (ADR 0098): Teams lists ten, and writes the title when one is chosen.
            commands: nativeMenu({ max: 10, words: 128 }).map((c) => ({
              title: `/${c.command}`,
              description: c.description,
            })),
          },
        ],
      },
    ],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [],
  };
}

/** The zip to upload in Teams. */
export function teamsAppPackage(options: Parameters<typeof teamsManifest>[0]): Buffer {
  return zip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(teamsManifest(options), null, 2)) },
    { name: 'color.png', data: colorIcon() },
    { name: 'outline.png', data: outlineIcon() },
  ]);
}
