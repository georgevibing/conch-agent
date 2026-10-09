/**
 * The GitHub Release's page (ADR 0127): the notes, then how to install it
 * and how to check what you downloaded is the real thing. The desktop
 * updater and the website read the notes from here (`parseNotes`), and the
 * headings after them aren't groups it knows, so they're never taken for notes.
 */
import { releaseBody, type Notes } from './notes';
import { parseRelease, tagOf } from './semver';

export interface PageFacts {
  version: string;
  notes: Notes;
  /** `owner/name` on GitHub. */
  repository: string;
  /** Whether the desktop apps were signed by Apple and Microsoft's rules (the certificates are set up). */
  signed: { mac: boolean; windows: boolean };
}

export function releasePage({ version, notes, repository, signed }: PageFacts): string {
  const release = parseRelease(version);
  const channel = release?.pre ? `CONCH_CHANNEL=${release.pre.kind} ` : '';
  const unsigned = [!signed.mac && 'macOS', !signed.windows && 'Windows'].filter(Boolean);
  const lines = [
    releaseBody(notes).trimEnd(),
    '',
    '---',
    '',
    '### Install',
    '',
    '- **The app:** download the file for your computer below (`.dmg` for a Mac, `.exe` for Windows, `.AppImage` or `.deb` for Linux).',
    `- **From a terminal:** \`curl -fsSL https://conchagent.com/install.sh | ${channel}sh\` on macOS and Linux, or \`irm https://conchagent.com/install.ps1 | iex\` in PowerShell${channel ? ` (set \`$env:CONCH_CHANNEL='${release?.pre?.kind}'\` first)` : ''}.`,
    '- **Already have Conch?** It offers this version itself, in Settings → Health → Updates.',
    '',
    '### Check it’s genuine',
    '',
    `- The tag \`${tagOf(version)}\` is signed with Conch’s release key. Every Conch checks it against \`release/allowed_signers\` before it updates, and so does the installer.`,
    `- Each download has a build provenance attestation: \`gh attestation verify <file> --repo ${repository}\`.`,
    '- `SHA256SUMS` lists every file’s checksum: `sha256sum -c SHA256SUMS --ignore-missing`.',
    `- \`conch-${version}.spdx.json\` is the software bill of materials: every package this release is built from.`,
  ];
  if (unsigned.length)
    lines.push(
      '',
      `> The desktop app isn’t code-signed for ${unsigned.join(' or ')} yet, so ${unsigned.length > 1 ? 'they ask' : 'it asks'} once before opening it${!signed.mac ? ', and a Mac offers each update as a download instead of installing it itself' : ''}. The checks above still hold.`,
    );
  return `${lines.join('\n')}\n`;
}
