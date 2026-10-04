/**
 * Looking at a skill before it steers anything (ADR 0028). A skill is
 * instructions an assistant follows with your powers, so a hostile one is a
 * hostile program: the ClawHavoc campaign (Feb 2026) planted skills on
 * ClawHub that hid info-stealers behind "prerequisite" steps telling the
 * agent to download and run something.
 *
 * Conch reads every text file in the folder and says, in plain words, what
 * could hurt you: running something downloaded, reaching for keys and saved
 * passwords, sending things somewhere, telling the assistant to hide what it
 * does, invisible characters. It's a careful reader, not an antivirus: the
 * verdict decides how loudly Conch asks before a skill is turned on, and
 * permission prompts still stand between any skill and your computer.
 */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { SkillFinding, SkillReview } from '@conch/protocol';

/** Enough to read any real skill; anything bigger is itself worth a word. */
/** As many as a skill from Discover may have (ADR 0070), so every file in one is read. */
const MAX_FILES = 200;
const MAX_FILE = 256 * 1024;
const TEXT =
  /\.(md|markdown|txt|sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|json|ya?ml|toml|ini|cfg|conf|html?|xml|applescript|scpt)$/i;

interface Rule {
  kind: SkillFinding['kind'];
  severity: SkillFinding['severity'];
  /** Said to a person: what it does, not how it was found. */
  message: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  // ── Running something from the internet ──────────────────────────────
  {
    kind: 'download-run',
    severity: 'danger',
    message: 'Downloads something from the internet and runs it straight away.',
    pattern:
      /\b(?:curl|wget|fetch)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)|\b(?:iex|invoke-expression)\b[^\n]*\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b|\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|\s*(?:iex|invoke-expression)\b/i,
  },
  {
    kind: 'download-run',
    severity: 'danger',
    message: 'Decodes hidden code and runs it.',
    pattern:
      /base64\s+(?:-d|--decode|-D)\b[^\n]*\|\s*(?:ba|z)?sh\b|\beval\s*\(\s*(?:atob|Buffer\.from)\b|\bexec\s*\(\s*(?:base64\.b64decode|bytes\.fromhex|zlib\.decompress)|powershell(?:\.exe)?\s+[^\n]*-e(?:nc(?:odedcommand)?)?\s+[A-Za-z0-9+/=]{20,}/i,
  },
  {
    kind: 'download-run',
    severity: 'danger',
    message: 'Downloads something from the internet and runs it straight away.',
    // `bash -c "$(curl …)"`, `python3 <(wget …)`, `curl … | python`: the same thing, other spellings.
    pattern:
      /\b(?:ba|z|da|k)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b|\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:python[0-9.]*|node|perl|ruby|php|osascript)\b|\b(?:python[0-9.]*|node|perl|ruby)\s+<\(\s*(?:curl|wget)/i,
  },
  {
    kind: 'download-run',
    severity: 'danger',
    message: 'Opens a way into this computer for someone else.',
    pattern:
      /\/dev\/tcp\/[\w.-]+\/\d+|\bn(?:c|cat)\b[^\n]*\s-[a-z]*e\s+\/bin\/(?:ba)?sh|\bbash\s+-i\s+>&|\bsocat\b[^\n]*\bexec:/i,
  },
  {
    // ClawHavoc's Windows half: "download the helper zip, the password is openclaw".
    kind: 'download-run',
    severity: 'danger',
    message:
      'Asks for a locked archive to be downloaded and opened, the way harmful programs hide from virus checks.',
    pattern:
      /\bdownload\w*\b[^\n]{0,160}\b(?:zip|archive|rar|7z)\b[\s\S]{0,160}?\b(?:password|passcode|pass)\s*(?:is|:|=)|\b(?:password|passcode)\s*(?:is|:|=)\s*\S+[^\n]{0,80}\b(?:extract|unzip|unpack)\b[^\n]{0,80}\b(?:run|open|launch|execute)\b/i,
  },
  {
    kind: 'download-run',
    severity: 'warning',
    message: 'Points to a paste site for code to run, where what’s there can change at any time.',
    pattern:
      /\b(?:glot\.io\/snippets|pastebin\.com\/raw|paste\.ee\/r|hastebin\.com\/raw|rentry\.(?:co|org)\/[\w-]+\/raw|0bin\.net|ghostbin\.\w+|dpaste\.(?:com|org)\/[\w-]+\/raw)/i,
  },
  {
    kind: 'download-run',
    severity: 'warning',
    message: 'Fetches something from a bare internet address instead of a named site.',
    // Private and loopback addresses are a local server, which is ordinary in instructions.
    pattern:
      /\bhttps?:\/\/(?!(?:127|10|0)\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)\d{1,3}(?:\.\d{1,3}){3}\b/i,
  },
  {
    kind: 'download-run',
    severity: 'danger',
    message: 'Turns off the Mac’s check on downloaded programs.',
    pattern:
      /xattr\s+(?:-[a-z]*d[a-z]*\s+|-r\s+-d\s+)com\.apple\.quarantine|spctl\s+--master-disable/i,
  },
  // ── Reaching for keys and passwords ───────────────────────────────────
  {
    kind: 'secrets',
    severity: 'danger',
    message: 'Reaches for saved passwords, keys or wallets.',
    pattern:
      /~\/\.ssh\/id_|\.aws\/credentials|\.config\/gcloud|Login Data\b|Cookies\.binarycookies|Library\/Keychains|security\s+(?:find|dump)-(?:generic|internet)-password|\bdump-keychain\b|wallet\.dat|\bseed phrase\b|\.conch\/(?:secrets|vault|access)|\.env\b[^\n]*(?:cat|send|upload|post|curl)|\.(?:clawdbot|openclaw|moltbot|hermes)\/(?:[\w-]+\/)*(?:\.env|credentials|auth-profiles\.json)|\.claude\/\.credentials|\.codex\/auth\.json|\bauth-profiles\.json\b/i,
  },
  // ── Sending things somewhere ──────────────────────────────────────────
  {
    kind: 'exfiltration',
    severity: 'danger',
    message: 'Sends things to a drop box on the internet that skills have no reason to use.',
    pattern:
      /webhook\.site|requestbin|pipedream\.net|hookbin|pastebin\.com\/api|transfer\.sh|ngrok(?:-free)?\.(?:io|app)|discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot[^\s/]+\/send(?:Document|Message)|\.trycloudflare\.com|interact\.sh|burpcollaborator/i,
  },
  // ── Telling the assistant to hide or override ─────────────────────────
  {
    kind: 'deception',
    severity: 'danger',
    message: 'Tells the assistant to ignore its rules or hide what it does from you.',
    pattern:
      /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|messages)|(?:do\s+not|don['’]t|never)\s+(?:tell|inform|show|mention\s+(?:this\s+)?to)\s+the\s+user|without\s+(?:telling|informing|asking)\s+the\s+user|\bsilently\s+(?:run|install|download|send|upload|execute)|hide\s+(?:this|it|the\s+output)\s+from\s+the\s+user/i,
  },
  {
    kind: 'deception',
    severity: 'warning',
    message: 'Asks for the assistant’s safety checks to be turned off.',
    pattern:
      /--dangerously-skip-permissions|bypassPermissions|disable\s+(?:the\s+)?(?:sandbox|permission\s+prompts?|safety)|--no-verify\b[^\n]*push|yolo\s+mode/i,
  },
  // ── Fake "prerequisites" (ClawHavoc) ──────────────────────────────────
  {
    kind: 'prerequisite',
    severity: 'warning',
    message: 'Says something must be downloaded and installed first, from a link in the skill.',
    pattern:
      /(?:prerequisite|before\s+(?:using|you\s+(?:can\s+)?use)\s+this\s+skill|first,?\s+(?:download|install))[^\n]{0,160}https?:\/\/(?!(?:github\.com\/(?:anthropics|openai|ggml-org)|docs\.|www\.npmjs\.com|pypi\.org|brew\.sh|nodejs\.org))/i,
  },
  {
    kind: 'download-run',
    severity: 'warning',
    message: 'Downloads a program and makes it runnable.',
    pattern: /(?:curl|wget)\b[^\n]*-o\s*\S+[^\n]*(?:&&|;|\n)\s*chmod\s+\+x/i,
  },
  // ── Hidden things ─────────────────────────────────────────────────────
  {
    kind: 'hidden',
    severity: 'warning',
    message: 'Has a long block of encoded data that a person can’t read.',
    pattern: /[A-Za-z0-9+/]{400,}={0,2}/,
  },
];

/** Characters a person can't see that change what a model reads (Trojan Source, hidden prompts). */
const SMUGGLED = /[\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/u;
/** Zero-width marks that also turn up in pasted text; worth a word, not an alarm (emoji joiners aren't counted). */
const ZERO_WIDTH = /[\u200B\u200C\u2060-\u2064]|(?!^)\uFEFF/u;

async function files(
  folder: string,
  options: { withSignature?: boolean } = {},
): Promise<{ path: string; size: number; text: boolean }[]> {
  const out: { path: string; size: number; text: boolean }[] = [];
  const visit = async (dir: string, depth: number) => {
    if (out.length >= MAX_FILES || depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      // The signature is about the rest of the folder, so it isn't part of it (ADR 0031).
      if (depth === 1 && entry.name === 'SKILL.sig' && !options.withSignature) continue;
      const path = join(dir, entry.name);
      // Links aren't followed: a skill can't make Conch read your files as its own.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile()) {
        const size = (await lstat(path).catch(() => undefined))?.size ?? 0;
        out.push({ path, size, text: TEXT.test(entry.name) || entry.name === 'SKILL.md' });
      }
    }
  };
  await visit(folder, 1);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Cheap: names, sizes and times. Reading the files again waits until one of them changed. */
export async function folderSignature(
  folder: string,
  options: { withSignature?: boolean } = {},
): Promise<string> {
  const parts: string[] = [];
  for (const f of await files(folder, options)) {
    const info = await lstat(f.path).catch(() => undefined);
    parts.push(`${f.path}:${f.size}:${info?.mtimeMs ?? 0}`);
  }
  return parts.join('|');
}

/** A fingerprint of everything in the folder: a skill that changes gets a new one. */
export async function skillHash(folder: string): Promise<string> {
  const hash = createHash('sha256');
  for (const f of await files(folder)) {
    hash.update(relative(folder, f.path).split(sep).join('/'));
    hash.update('\0');
    hash.update(await readFile(f.path).catch(() => Buffer.alloc(0)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Executables a skill has no business carrying (Mach-O, ELF, PE). */
function binaryKind(head: Buffer): string | undefined {
  if (head.length < 4) return undefined;
  const magic = head.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'Mac';
  if (magic === 0x7f454c46) return 'Linux';
  if (head[0] === 0x4d && head[1] === 0x5a) return 'Windows';
  return undefined;
}

/** What could hurt you in this skill, each said once per file. */
/** What the rules find in one text: a skill's file, or a memory brought from another app. */
function findingsIn(text: string, file?: string): SkillFinding[] {
  const out: SkillFinding[] = [];
  const lines = text.split('\n');
  for (const rule of RULES) {
    const at = lines.findIndex(
      (line, i) =>
        rule.pattern.test(line) ||
        (i < lines.length - 1 && rule.pattern.test(`${line}\n${lines[i + 1]}`)),
    );
    if (at >= 0)
      out.push({
        kind: rule.kind,
        severity: rule.severity,
        message: rule.message,
        file,
        line: at + 1,
      });
  }
  const smuggled = lines.findIndex((line) => SMUGGLED.test(line));
  if (smuggled >= 0)
    out.push({
      kind: 'hidden',
      severity: 'danger',
      message: 'Contains invisible characters that can say things to the assistant you can’t see.',
      file,
      line: smuggled + 1,
    });
  const zeroWidth = lines.findIndex((line) => ZERO_WIDTH.test(line));
  if (zeroWidth >= 0)
    out.push({
      kind: 'hidden',
      severity: 'warning',
      message: 'Has invisible spacing characters in its text.',
      file,
      line: zeroWidth + 1,
    });
  return out;
}

const verdictOf = (findings: SkillFinding[]): SkillReview['verdict'] =>
  findings.some((f) => f.severity === 'danger')
    ? 'danger'
    : findings.some((f) => f.severity === 'warning')
      ? 'caution'
      : 'clean';

/**
 * Words from another app that will reach the assistant (a memory, a persona,
 * ADR 0035), read with the same eyes as a skill.
 */
export function scanText(text: string, file?: string): Pick<SkillReview, 'verdict' | 'findings'> {
  const findings = findingsIn(text, file);
  return { verdict: verdictOf(findings), findings };
}

/** Invisible characters that only ever say things to a model: never kept. */
export const unsmuggle = (text: string) => text.replace(new RegExp(SMUGGLED.source, 'gu'), '');

export async function scanSkill(folder: string): Promise<SkillReview> {
  const findings: SkillFinding[] = [];
  const say = (finding: SkillFinding) => {
    if (
      findings.some(
        (f) => f.kind === finding.kind && f.file === finding.file && f.message === finding.message,
      )
    )
      return;
    findings.push(finding);
  };
  const list = await files(folder);
  if (list.length >= MAX_FILES)
    say({
      kind: 'hidden',
      severity: 'warning',
      message: 'Has more files than Conch reads, so not all of it was looked at.',
    });
  for (const f of list) {
    const file = relative(folder, f.path).split(sep).join('/');
    if (!f.text) {
      const head = await readFile(f.path)
        .then((b) => b.subarray(0, 8))
        .catch(() => Buffer.alloc(0));
      const kind = binaryKind(head);
      if (kind)
        say({
          kind: 'binary',
          severity: 'danger',
          message: `Carries a ready-made ${kind} program, which nobody can read before it runs.`,
          file,
        });
      continue;
    }
    if (f.size > MAX_FILE) {
      say({
        kind: 'hidden',
        severity: 'warning',
        message: 'Has a file too big to read through.',
        file,
      });
      continue;
    }
    const text = await readFile(f.path, 'utf8').catch(() => '');
    for (const finding of findingsIn(text, file)) say(finding);
  }
  return {
    verdict: verdictOf(findings),
    findings,
    hash: await skillHash(folder),
    checkedAt: Date.now(),
  };
}
