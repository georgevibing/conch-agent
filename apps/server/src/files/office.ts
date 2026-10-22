/**
 * Older Office files the sealed reader can't take itself (Word 95, Excel 95,
 * or a 97–2003 file it finds damaged), turned into their current format by
 * the computer's own converter: LibreOffice, else macOS's `textutil` for a
 * Word file. The sealed reader then reads the result like any DOCX, XLSX or
 * PPTX (`documents.ts`).
 *
 * The converter is a big program reading a stranger's file, so it gets as
 * little as Conch can give it: a private temporary folder that is deleted
 * afterwards, arguments (never a shell), no environment but that folder, a
 * fresh LibreOffice profile (macros stay off), a deadline, and on macOS a
 * Seatbelt profile with no network and nowhere to write but temporary
 * folders. LibreOffice is a need (`setup/known.ts`), so Conch can offer it.
 */
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { findExecutable, presentSync, run } from '../lib/proc';

export type LegacyKind = 'doc' | 'xls' | 'ppt';

const TARGET: Record<LegacyKind, string> = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };
const EXTENSIONS: Record<string, LegacyKind> = {
  doc: 'doc',
  dot: 'doc',
  xls: 'xls',
  xlt: 'xls',
  ppt: 'ppt',
  pot: 'ppt',
  pps: 'ppt',
};
const COMPOUND = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const CONVERT_TIMEOUT_MS = 90_000;
const MAX_CONVERTED = 30 * 1024 * 1024;

/** Which older Office file this is, from its bytes (an OLE compound file) and its parts or name. */
export function legacyKind(bytes: Buffer, name: string): LegacyKind | undefined {
  if (!bytes.subarray(0, 8).equals(COMPOUND)) return undefined;
  // An Outlook message is a compound file too; the sealed reader takes it.
  if (bytes.includes(Buffer.from('__substg1.0_', 'utf16le'))) return undefined;
  const parts: [string, LegacyKind][] = [
    ['WordDocument', 'doc'],
    ['Workbook', 'xls'],
    ['PowerPoint Document', 'ppt'],
  ];
  for (const [part, kind] of parts) if (bytes.includes(Buffer.from(part, 'utf16le'))) return kind;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? EXTENSIONS[name.slice(dot + 1).toLowerCase()] : undefined;
}

/** LibreOffice's `soffice`, where its installers put it. */
export async function findOffice(
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform === 'darwin') {
    const app = ['/Applications', join(homedir(), 'Applications')]
      .map((dir) => join(dir, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'))
      .find(presentSync);
    if (app) return app;
  }
  const extraDirs =
    platform === 'win32'
      ? ['C:\\Program Files\\LibreOffice\\program', 'C:\\Program Files (x86)\\LibreOffice\\program']
      : ['/usr/lib/libreoffice/program', '/opt/libreoffice/program', '/snap/bin'];
  return (await findExecutable('soffice', { extraDirs })) ?? (await findExecutable('libreoffice'));
}

/** Whether this computer can turn an older Office file of this kind into a current one. */
export async function canConvert(kind: LegacyKind): Promise<boolean> {
  if (await findOffice()) return true;
  return kind === 'doc' && process.platform === 'darwin' && presentSync('/usr/bin/textutil');
}

/** On macOS, the converter runs with no network and writes only to temporary folders. */
async function sealed(file: string, args: string[]): Promise<[string, string[]]> {
  if (process.platform !== 'darwin' || !presentSync('/usr/bin/sandbox-exec')) return [file, args];
  const temp = dirname(await realpath(tmpdir()));
  const quote = (path: string) => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${quote(temp)}) (subpath "/dev"))`;
  return ['/usr/bin/sandbox-exec', ['-p', profile, file, ...args]];
}

/**
 * The file in its current format (DOCX, XLSX or PPTX), or undefined when
 * nothing here converts it or the conversion failed. Never throws.
 */
export async function convertLegacy(
  bytes: Buffer,
  kind: LegacyKind,
  signal: AbortSignal,
): Promise<Buffer | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'conch-office-')).catch(() => undefined);
  if (!dir) return undefined;
  try {
    const input = join(dir, `in.${kind}`);
    await writeFile(input, bytes, { mode: 0o600 });
    const target = TARGET[kind];
    const env: Record<string, string> =
      process.platform === 'win32'
        ? {
            SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
            TEMP: dir,
            TMP: dir,
            USERPROFILE: dir,
          }
        : { HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin' };
    const soffice = await findOffice();
    let output: string | undefined;
    if (soffice) {
      const [file, args] = await sealed(soffice, [
        '--headless',
        '--norestore',
        '--nolockcheck',
        '--nologo',
        '--nodefault',
        `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
        '--convert-to',
        target,
        '--outdir',
        join(dir, 'out'),
        input,
      ]);
      const done = await run(file, args, { env, cwd: dir, timeout: CONVERT_TIMEOUT_MS, signal });
      if (done.code === 0) output = join(dir, 'out', `in.${target}`);
    } else if (kind === 'doc' && process.platform === 'darwin') {
      output = join(dir, 'out.docx');
      const [file, args] = await sealed('/usr/bin/textutil', [
        '-convert',
        'docx',
        '-output',
        output,
        input,
      ]);
      const done = await run(file, args, { env, cwd: dir, timeout: CONVERT_TIMEOUT_MS, signal });
      if (done.code !== 0) output = undefined;
    }
    if (!output) return undefined;
    const info = await stat(output).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_CONVERTED) return undefined;
    return await readFile(output);
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
