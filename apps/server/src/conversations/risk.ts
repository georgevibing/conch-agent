/**
 * What could seriously go wrong with one step (ADR 0100): the risk policy
 * behind **Auto**, and the reason a card gives in every mode that asks.
 *
 * Auto must get on with routine work silently and stop only for something
 * serious. "Serious" is scored, not listed by feel. Each rule says:
 *
 * - **harm**: `severe` (your keys, someone else's systems, a whole disk,
 *   production, running code from a stranger) or `moderate` (data leaving,
 *   a new dependency, a setting that lasts);
 * - **lasting**: whether Conch can put it back. A file changed by a file
 *   tool, or anything in the work folder, can be put back (Undo, ADR 0030);
 *   a push, a message, a deletion outside the folder, a secret read, can't.
 *
 * and the chat adds **provenance**: whether it has read something untrusted
 * (ADR 0028). The score is harm (severe 2, moderate 1) + lasting (1) +
 * untrusted (1); three or more asks. So something severe that can't be put
 * back always asks; severe-but-undoable and moderate-but-lasting ask only
 * once the chat read something that could be steering it; the rest never.
 *
 * Built from the threats the industry agrees on: Claude Code's auto-mode
 * classifier defaults (code.claude.com/docs/en/permission-modes, read
 * 2026-10-07), Codex's sandbox and approval presets, Gemini CLI's policy
 * engine, Cursor's run-everything deny list, and OWASP's Top 10 for LLM
 * applications (LLM01 prompt injection, LLM06 excessive agency) and
 * agentic AI threats (tool misuse, privilege compromise, resource abuse).
 * A careful reader, not a sandbox: the sealed box, protected paths and
 * Conch's own powers hold whatever this says.
 *
 * Pure functions. `risk.test.ts` holds the corpus, benign and serious, and
 * measures the false positive rate.
 */
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export type RiskKind =
  /** Running code downloaded from the internet, or decoded from a blob. */
  | 'remote-code'
  /** Reading keys, sign-ins and tokens into the chat. */
  | 'credentials'
  /** Sending to a drop box, a reverse shell, a tunnel to this computer. */
  | 'exfiltration'
  /** Deleting what can't come back: outside the folder, a whole disk. */
  | 'wipe'
  /** Rewriting or deleting shared git history; discarding work. */
  | 'history'
  /** Running as administrator, granting access. */
  | 'privilege'
  /** Something that runs again by itself later. */
  | 'persistence'
  /** Turning off a safety check of this computer or of an agent. */
  | 'safety-off'
  /** Cloud and production infrastructure, databases. */
  | 'infra'
  /** Publishing a package, a release or a repository. */
  | 'publish'
  /** Data leaving this computer. */
  | 'egress'
  /** A dependency that runs its own code as it installs. */
  | 'install'
  /** An app's step that deletes. */
  | 'app-delete'
  /** Stopping what the computer needs to keep running, or shutting it down. */
  | 'disrupt';

export interface Risk {
  kind: RiskKind;
  harm: 'severe' | 'moderate';
  /** Conch can't put it back. */
  lasting: boolean;
  /** What it would do, after "So I'm checking before I " (plain words, no jargon). */
  reason: string;
  /** No mode lifts it, Full trust included: a whole folder or disk gone (`breaksCircuit`). */
  critical?: boolean;
}

export interface RiskContext {
  /** The chat's work folder. */
  workspace: string;
  /** For an app's tool: it says it deletes or can't be undone. */
  destructive?: boolean;
  /** Home folder (tests). */
  home?: string;
}

/** The score: three or more asks (ADR 0100). */
export function riskScore(risk: Risk, untrusted: boolean): number {
  return (risk.harm === 'severe' ? 2 : 1) + (risk.lasting ? 1 : 0) + (untrusted ? 1 : 0);
}

/** What the card says (`GuardNote`): what it would do, and whether that can be put back. */
export function riskWords(risk: Risk | undefined): string {
  if (!risk) return 'This could matter, so I’m checking first.';
  return `This would ${risk.reason}${risk.lasting ? ', and that can’t be undone' : ''}. So I’m checking first.`;
}

/** Whether this risk stops Auto, given what the chat read. */
export function riskAsks(risk: Risk | undefined, untrusted: boolean): boolean {
  return Boolean(risk) && riskScore(risk as Risk, untrusted) >= 3;
}

// ── Commands ──────────────────────────────────────────────────────────────

/** A shell's own wrappers, unwrapped so the command inside is what's read. */
const PREFIX =
  /^(?:(?:sudo|doas|nohup|time|command|exec|builtin|nice|ionice|stdbuf|caffeinate)(?:\s+-[\w-]+)*\s+|env(?:\s+-[\w-]+)*\s+|[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;

/** The command line and every script inside it: `bash -c '…'`, `eval '…'`, `$(…)`, backticks. */
function scriptsOf(command: string): string[] {
  const scripts: string[] = [];
  const queue = [command];
  while (queue.length && scripts.length < 50) {
    const text = queue.shift() ?? '';
    scripts.push(text);
    for (const inner of text.matchAll(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|`([^`]*)`/g))
      queue.push(inner[1] ?? inner[2] ?? '');
    for (const inner of text.matchAll(
      /\b(?:ba|z|da|k|fi)?sh\s+-\w*c\w*\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g,
    ))
      queue.push(inner[1] ?? inner[2] ?? '');
    for (const inner of text.matchAll(/\beval\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g))
      queue.push(inner[1] ?? inner[2] ?? '');
  }
  return scripts;
}

/** The pieces a command line runs, wrappers (`sudo`, `env A=1`, `nohup`) taken off. */
export function commandParts(command: string): string[] {
  return scriptsOf(command).flatMap((text) =>
    text
      .split(/\|\||&&|;|\n|\|(?!&)|(?<![>&\d])&(?![>&])/)
      .map((piece) =>
        piece
          .trim()
          .replace(/^[({]\s*/, '')
          .replace(/\s*[)}]+$/, '')
          .replace(PREFIX, ''),
      )
      .filter(Boolean),
  );
}

/** Words of one part, as the shell would split them: quotes joined to what's beside them. */
function wordsOf(part: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < part.length; i++) {
    const c = part[i] ?? '';
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < part.length) word += part[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === '\\' && i + 1 < part.length) {
      word += part[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started || word) words.push(word);
      word = '';
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started || word) words.push(word);
  return words;
}

const program = (part: string) => (wordsOf(part)[0] ?? '').replace(/^.*[\\/]/, '');

/** Branch names a team protects, or that publish when pushed. */
const PROTECTED_BRANCH =
  /^(?:main|master|trunk|develop|dev|default|stable|production|prod|live|release(?:[/-].*)?|gh-pages|HEAD)$/i;

/** Production named on the command line. */
const PROD = /(?:^|[\s=/:_.-])(?:prod|production|prd|live)(?:$|[\s/:_.-])|--prod\b/i;

/** Hosts whose whole purpose is catching what's sent to them. */
const DROP_BOXES =
  /\b(?:webhook\.site|requestbin\.\w+|pipedream\.net|[\w-]+\.ngrok(?:-free)?\.(?:io|app|dev)|ngrok\.io|pastebin\.com|paste\.ee|hastebin\.com|transfer\.sh|0x0\.st|file\.io|termbin\.com|ix\.io|discord(?:app)?\.com\/api\/webhooks|interact\.sh|oast\.(?:fun|pro|live|site|online|me)|burpcollaborator\.net|canarytokens\.(?:com|org)|requestcatcher\.com|beeceptor\.com|hookbin\.com|webhook\.cool|postb\.in)\b/i;

const DOWNLOADER = /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|fetch|aria2c)\b/i;
/** A program in a pipeline that sends to another computer. */
const SENDS =
  /(?:^|[\s|;&(`]|\$\()(?:curl|wget|nc|ncat|netcat|socat|telnet|http|https|xh|ssh|scp|sftp|rsync|ftp|lftp|rclone|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(?=\s|$)/i;
/** A project's `.env` (not its `.env.example`) being read, attached or uploaded. */
const ENV_FILE =
  /(?:@|<\s*|\b(?:cat|base64|xxd|od|gzip|tar|zip|openssl|gpg|head|tail|strings|type|Get-Content|gc)\s+(?:-\S+\s+)*|(?:-T|--upload-file|-F\s*\S+=@?)\s*)["']?(?:[^\s"']*[\\/])?\.env(?!\.(?:example|sample|template|dist|defaults?)\b)(?:\.[\w-]+)?["']?(?=$|[\s;|&)<>,])/i;
/** Gone for good, whoever answers: Full trust asks too. */
const WHOLE: Risk = {
  kind: 'wipe',
  harm: 'severe',
  lasting: true,
  critical: true,
  reason: 'delete a whole folder like your home, the work folder or the disk',
};

const severe = (kind: RiskKind, reason: string, lasting = true): Risk => ({
  kind,
  harm: 'severe',
  lasting,
  reason,
});
const moderate = (kind: RiskKind, reason: string, lasting = true): Risk => ({
  kind,
  harm: 'moderate',
  lasting,
  reason,
});

interface Places {
  workspace: string;
  home: string;
  scratch: string[];
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** A path a command or a tool names, made absolute (`~` is home, relative is the folder). */
function placeOf(raw: string, places: Places): string | undefined {
  const word = raw.replace(/^["']|["']$/g, '');
  if (!word || word.startsWith('-')) return undefined;
  const home = word.replace(/^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE)(?=$|[\\/])/, places.home);
  if (/[$`]/.test(home)) return undefined;
  return resolve(places.workspace, home.replace(/(?:^|[\\/])\*+$/, '') || '.');
}

/**
 * The few places a recursive delete must never reach without a person
 * (Claude Code's "critical paths"): the root, a top-level folder, the home
 * folder, the work folder or one above it, a drive, everything in one of
 * those, or a target only known when it runs.
 */
function criticalTarget(raw: string, places: Places, workFolder = true): boolean {
  const word = raw.replace(/^["']|["']$/g, '');
  if (/^[A-Za-z]:[\\/]?(?:[^\\/]+[\\/]?)?$/.test(word)) return true;
  if (/^\\+$/.test(word)) return true;
  // A variable that may be empty: `rm -rf "$DIR"/*` becomes `rm -rf /*`.
  if (/^\$\{?(?!HOME\b)\w+\}?(?:[\\/]\*?|[\\/]?(?:mnt|tmp|usr|Users|home|etc|var|opt))$/.test(word))
    return true;
  // Only known when it runs: `rm -rf "$(pwd)"`.
  if (/^\$\(/.test(word)) return true;
  const path = placeOf(word, places);
  if (!path) return false;
  const root = resolve('/');
  if (path === root) return true;
  if (resolve(path, '..') === root) return true;
  if (path === places.home || inside(path, places.home)) return true;
  return workFolder && inside(path, places.workspace);
}

function rmRisk(words: string[], places: Places): Risk | undefined {
  const flags = words.filter((w) => w.startsWith('-')).join(' ');
  const recursive = /(?:^|\s)-\w*[rR]|--recursive/.test(flags) || words[0] === 'rmdir';
  const targets = words.slice(1).filter((w) => !w.startsWith('-'));
  if (!targets.length) return undefined;
  if (recursive && targets.some((t) => criticalTarget(t, places))) return WHOLE;
  // A repository's history: Undo keeps the work folder's files, not `.git` (ADR 0030).
  if (recursive && targets.some((t) => /(?:^|[\\/])\.git[\\/]?$/.test(t)))
    return severe('history', 'delete the whole history of the repository');
  const outside = targets.some((t) => {
    const path = placeOf(t, places);
    return (
      path &&
      !inside(places.workspace, path) &&
      !places.scratch.some((s) => inside(s, path)) &&
      // Caches and build output come back by themselves.
      !/[\\/](?:\.cache|Caches|\.npm|\.pnpm-store|node_modules|\.next|dist|build|target)(?:[\\/]|$)/.test(
        path,
      )
    );
  });
  if (outside && recursive) return severe('wipe', 'delete files outside the work folder for good');
  if (outside) return moderate('wipe', 'delete a file outside the work folder for good');
  return undefined;
}

/** `git …`: force pushes, deleted branches, thrown-away work. */
function gitRisk(words: string[]): Risk | undefined {
  // `git -C dir push …`: the subcommand after git's own options.
  let i = 1;
  while (i < words.length && (words[i] ?? '').startsWith('-'))
    i += /^-(?:C|c)$|^--(?:git-dir|work-tree)$/.test(words[i] ?? '') ? 2 : 1;
  const sub = words[i];
  const rest = words.slice(i + 1);
  const flags = rest.filter((w) => w.startsWith('-'));
  const args = rest.filter((w) => !w.startsWith('-'));
  if (sub === 'push') {
    const force = flags.some((f) => /^--force(?:-with-lease|-if-includes)?(?:=|$)|^-\w*f/.test(f));
    const plus = args.some((a) => a.startsWith('+'));
    const deleting =
      flags.some((f) => /^(?:--delete|-d)$/.test(f)) || args.some((a) => /^:/.test(a));
    if (flags.includes('--mirror'))
      return severe('history', 'mirror-push, replacing everything on the remote');
    const refs = args.slice(1).map((a) =>
      a
        .replace(/^\+|^:/, '')
        .split(':')
        .pop()
        ?.replace(/^refs\/heads\//, ''),
    );
    const named = refs.filter((r): r is string => Boolean(r));
    const shared = !named.length || named.some((r) => PROTECTED_BRANCH.test(r));
    if (deleting)
      return shared
        ? severe('history', `delete the ${named[0] ?? 'remote'} branch others rely on`)
        : moderate('history', `delete the ${named[0] ?? 'remote'} branch`);
    if (force || plus)
      return shared
        ? severe(
            'history',
            named[0]
              ? `force-push over ${named[0]}, which rewrites history others share`
              : 'force-push, which rewrites history others may share',
          )
        : moderate('history', `force-push over ${named[0] ?? 'a branch'}`);
    return moderate('egress', 'push code to a remote');
  }
  if (sub === 'reset' && flags.includes('--hard'))
    return severe('history', 'throw away changes that aren’t committed', false);
  if (sub === 'clean' && flags.some((f) => /^-\w*f/.test(f)) && flags.some((f) => /[dxX]/.test(f)))
    return severe('history', 'delete every file git doesn’t track', false);
  if ((sub === 'checkout' || sub === 'restore') && rest.some((w) => w === '.' || w === ':/'))
    return severe('history', 'throw away changes that aren’t committed', false);
  if (sub === 'stash' && /^(?:drop|clear)$/.test(args[0] ?? ''))
    return moderate('history', 'throw away stashed changes');
  if (sub === 'filter-branch' || sub === 'filter-repo')
    return severe('history', 'rewrite the whole history of the repository', false);
  if (sub === 'config' && rest.some((w) => /^core\.hooksPath$|^http\.sslVerify$/i.test(w)))
    return moderate('safety-off', 'change how git runs hooks or checks certificates', false);
  return undefined;
}

/** Cloud, clusters, infrastructure as code, deploys and databases. */
function infraRisk(part: string, prog: string, words: string[]): Risk | undefined {
  const sub = words.slice(1).join(' ');
  const prod = PROD.test(part);
  if (/^(?:terraform|tofu|terragrunt|pulumi|cdk|cdktf|sst|serverless|sls)$/.test(prog)) {
    if (/\bdestroy\b|apply\b.*-destroy|\bstack\s+rm\b/.test(sub))
      return severe('infra', 'tear down cloud infrastructure');
    if (/\b(?:apply|up|deploy|import|state\s+(?:rm|mv|push))\b/.test(sub))
      return prod
        ? severe('infra', 'change production infrastructure')
        : severe('infra', 'change cloud infrastructure', false);
  }
  if (/^(?:kubectl|oc)$/.test(prog)) {
    if (/\b(?:delete|drain|cordon)\b/.test(sub))
      return severe('infra', 'delete or drain things in a cluster');
    if (/\b(?:create\s+(?:cluster)?rolebinding)\b/.test(sub))
      return severe('privilege', 'grant access in a cluster');
    if (/\b(?:apply|create|replace|patch|scale|rollout|set|edit|annotate|label)\b/.test(sub))
      return prod
        ? severe('infra', 'change a production cluster')
        : severe('infra', 'change a cluster', false);
  }
  if (prog === 'helm') {
    if (/\b(?:uninstall|delete|rollback)\b/.test(sub))
      return severe('infra', 'remove a release from a cluster');
    if (/\b(?:install|upgrade)\b/.test(sub))
      return prod
        ? severe('infra', 'change a production cluster')
        : severe('infra', 'change a cluster', false);
  }
  if (/^(?:aws|gcloud|gsutil|az|doctl|linode-cli|hcloud|oci|ibmcloud|scw)$/.test(prog)) {
    if (
      /\b(?:iam\s+(?:attach|put|create-access-key|create-login-profile|add-user-to-group|update-assume-role)|add-iam-policy-binding|set-iam-policy|role\s+assignment\s+create|put-bucket-(?:policy|acl)|delete-public-access-block|put-public-access-block)/.test(
        sub,
      )
    )
      return severe('privilege', 'grant access to cloud resources');
    if (
      /\b(?:secretsmanager\s+(?:put|create|update)|kms\s+(?:schedule-key-deletion|disable)|route53\s+change|dns\s+record-sets|acm\s+delete)/.test(
        sub,
      )
    )
      return severe('infra', 'change secrets, DNS or certificates in the cloud');
    if (
      /(?:^|\s)(?:delete|terminate|remove|deregister|purge|destroy|rb)(?:[-\s]|$)|[a-z]-(?:delete|terminate|remove|deregister|purge)(?:[-\s]|$)|\bdelete-\w|\bterminate-\w|\brm\b.*(?:-r|--recursive)|\b(?:rm|rb)\s+(?:-\w+\s+)*gs:\/\//.test(
        sub,
      )
    )
      return severe('infra', 'delete cloud resources');
    if (/\b(?:deploy|update-function-code|update-service|create-deployment)\b/.test(sub))
      return prod
        ? severe('infra', 'deploy to production')
        : severe('infra', 'deploy to the cloud', false);
  }
  if (
    /^(?:vercel|netlify|fly|flyctl|firebase|heroku|wrangler|railway|render|eb|amplify|surge)$/.test(
      prog,
    )
  ) {
    if (/\b(?:destroy|remove|rm|delete|apps:destroy|pg:reset|\w+:delete)\b/.test(sub))
      return severe('infra', 'delete a deployed app or its data');
    if (
      /\b(?:deploy|publish|up|release|promote)\b/.test(sub) ||
      prod ||
      (words.length === 1 && /^(?:vercel|surge)$/.test(prog))
    )
      return prod
        ? severe('infra', 'deploy to production')
        : severe('infra', 'deploy where people can reach it', false);
  }
  if (prog === 'gh') {
    if (/\b(?:repo\s+delete|release\s+delete|secret\s+(?:set|delete)|variable\s+set)\b/.test(sub))
      return severe('infra', 'delete a repository or change its secrets');
    if (
      /\brepo\s+(?:edit\b.*--visibility\s*=?\s*public|create\b.*--public)|gist\s+create\b.*--public/.test(
        sub,
      )
    )
      return severe('publish', 'make a repository or gist public');
    if (
      /\bpr\s+merge\b.*--admin|\bapi\b.*(?:collaborators|branches\/[^/\s]+\/protection)/.test(sub)
    )
      return severe('privilege', 'change who can push or what protects a branch');
    if (/\brelease\s+create\b/.test(sub)) return severe('publish', 'publish a release');
    if (/\bpr\s+merge\b/.test(sub)) return moderate('egress', 'merge a pull request');
  }
  if (
    /^(?:supabase|prisma|rails|rake|alembic|knex|sequelize|flyway|liquibase|dbmate)$/.test(prog)
  ) {
    if (/\b(?:db\s+reset|migrate\s+reset|db:drop|db:reset|db:schema:load|drop)\b/.test(sub))
      return severe('infra', 'wipe a database');
    if (/\b(?:migrate|db:migrate|upgrade|db\s+push)\b/.test(sub) && prod)
      return severe('infra', 'change a production database');
  }
  if (
    /^(?:psql|mysql|mariadb|sqlite3|mongosh|mongo|redis-cli|cqlsh|clickhouse-client)$/.test(prog) ||
    /^(?:dropdb|dropuser)$/.test(prog)
  ) {
    if (/^(?:dropdb|dropuser)$/.test(prog)) return severe('infra', 'delete a database');
    if (
      /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE|COLLECTION)|TRUNCATE\b|FLUSHALL|FLUSHDB|dropDatabase\s*\(|DELETE\s+FROM\s+[\w."`]+\s*(?:;|"|'|$))/i.test(
        part,
      )
    )
      return severe('infra', 'delete data in a database');
    if (prod && /\b(?:UPDATE|DELETE|INSERT|ALTER|CREATE|GRANT)\b/i.test(part))
      return severe('infra', 'change a production database');
  }
  return undefined;
}

/** Packages and releases going out to everyone. */
function publishRisk(prog: string, words: string[]): Risk | undefined {
  const sub = words.slice(1).filter((w) => !w.startsWith('-'));
  if (words.includes('--dry-run')) return undefined;
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog)) {
    if (sub[0] === 'unpublish' || sub[0] === 'deprecate')
      return severe('publish', 'take a published package down for everyone');
    if (sub[0] === 'publish' || (sub[0] === 'npm' && sub[1] === 'publish'))
      return severe('publish', 'publish a package for everyone to install');
  }
  if (
    (prog === 'cargo' && sub[0] === 'publish') ||
    (prog === 'twine' && sub[0] === 'upload') ||
    (prog === 'poetry' && sub[0] === 'publish') ||
    (prog === 'gem' && sub[0] === 'push') ||
    (prog === 'dotnet' && sub[0] === 'nuget' && sub[1] === 'push') ||
    (prog === 'mvn' && sub.includes('deploy')) ||
    (/^(?:gradle|gradlew)$/.test(prog) && sub.some((s) => /^publish/.test(s))) ||
    (/^(?:vsce|ovsx)$/.test(prog) && sub[0] === 'publish') ||
    (prog === 'flutter' && sub[0] === 'pub' && sub[1] === 'publish') ||
    (prog === 'uv' && sub[0] === 'publish')
  )
    return severe('publish', 'publish a package for everyone to install');
  if (/^(?:docker|podman)$/.test(prog) && sub[0] === 'push')
    return moderate('publish', 'push an image to a registry');
  return undefined;
}

/** The tools a project runs through npx every day: already in it, nothing new arrives. */
const DEV_TOOLS = new Set([
  'tsc',
  'tsx',
  'ts-node',
  'vitest',
  'jest',
  'mocha',
  'ava',
  'eslint',
  'prettier',
  'biome',
  'oxlint',
  'playwright',
  'cypress',
  'vite',
  'next',
  'nuxi',
  'astro',
  'svelte-kit',
  'turbo',
  'nx',
  'rimraf',
  'concurrently',
  'nodemon',
  'husky',
  'lint-staged',
  'knip',
  'stylelint',
  'tailwindcss',
  'postcss',
  'esbuild',
  'rollup',
  'webpack',
  'storybook',
  'prisma',
  'drizzle-kit',
  'changeset',
  'typedoc',
  'serve',
  'http-server',
  'degit',
  'ncu',
  'npm-check-updates',
]);

/** `npx <tool>` that runs what the project already has, by name or in node_modules/.bin. */
function localTool(name: string, places: Places): boolean {
  if (/@|\//.test(name.replace(/^@[^/]+\//, ''))) return false;
  if (DEV_TOOLS.has(name)) return true;
  return existsSync(join(places.workspace, 'node_modules', '.bin', name));
}

/** Installing something that runs its own code as it arrives. */
function installRisk(prog: string, words: string[], places: Places): Risk | undefined {
  const sub = words.slice(1);
  const named = (from: number) =>
    sub
      .slice(from)
      .filter((w) => !w.startsWith('-') && !/^(?:\.|\.\/.*|-r|requirements.*)$/.test(w));
  const fromUrl = (list: string[]) =>
    list.some((w) => /^(?:git\+|https?:\/\/|github:|git@)/.test(w));
  let pkgs: string[] = [];
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog) && /^(?:i|install|add)$/.test(sub[0] ?? ''))
    pkgs = named(1);
  else if (/^(?:npx|bunx)$/.test(prog))
    pkgs = named(0)
      .slice(0, 1)
      .filter((p) => !localTool(p, places));
  else if (/^(?:pnpm|yarn|bun)$/.test(prog) && sub[0] === 'dlx') pkgs = named(1).slice(0, 1);
  else if (/^pip\d?(?:\.\d+)?$/.test(prog) && sub[0] === 'install') {
    if (sub.some((w) => /^-(?:r|e|c)$|^--(?:requirement|editable|constraint)/.test(w)))
      return undefined;
    pkgs = named(1);
  } else if (prog === 'uv' && (sub[0] === 'add' || (sub[0] === 'pip' && sub[1] === 'install')))
    pkgs = named(sub[0] === 'add' ? 1 : 2);
  else if (/^(?:uvx|pipx)$/.test(prog)) pkgs = named(prog === 'pipx' ? 1 : 0).slice(0, 1);
  else if (prog === 'cargo' && sub[0] === 'install') pkgs = named(1);
  else if (prog === 'go' && (sub[0] === 'install' || sub[0] === 'get')) pkgs = named(1);
  else if (
    (prog === 'gem' || prog === 'brew' || prog === 'composer') &&
    /^(?:install|require)$/.test(sub[0] ?? '')
  )
    pkgs = named(1);
  else if (prog === 'dotnet' && sub[0] === 'add' && sub.includes('package')) pkgs = named(2);
  if (!pkgs.length) return undefined;
  if (fromUrl(pkgs))
    return severe('remote-code', 'install and run code straight from an address on the internet');
  return moderate('install', `install ${pkgs.slice(0, 2).join(' and ')}, which runs its own code`);
}

/** Paths whose files run again by themselves later, or let someone in. */
const PERSISTENT =
  /(?:^|[\\/])(?:Library[\\/]Launch(?:Agents|Daemons)|\.config[\\/](?:autostart|systemd)|etc[\\/](?:cron[^\\/]*|systemd|init\.d|rc\.local|profile(?:\.d)?|launchd\.conf))(?:[\\/]|$)|(?:^|[\\/])\.(?:bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin|config[\\/]fish[\\/]config\.fish)$/;
const ACCESS =
  /(?:^|[\\/])(?:\.ssh[\\/](?:authorized_keys2?|rc)|etc[\\/]sudoers(?:\.d)?)(?:[\\/]|$)/;
/** Files that tell an agent what it may do: writing them raises its own powers. */
const AGENT_CONFIG =
  /(?:^|[\\/])(?:\.claude[\\/]settings(?:\.local)?\.json|\.mcp\.json|\.codex[\\/]config\.toml|\.gemini[\\/]settings\.json|\.cursor[\\/](?:mcp\.json|permissions\.json)|\.vscode[\\/]tasks\.json)$/;
const HOOKS =
  /(?:^|[\\/])(?:\.git[\\/](?:hooks[\\/]|config$)|\.husky[\\/]|\.github[\\/]workflows[\\/])/;

/**
 * The computer's own files: what it starts from, its programs and settings.
 * Not `/usr/local` or `/opt` (where installs put programs), `/var/folders`
 * or `/var/tmp` (scratch), or `/dev`.
 */
const SYSTEM =
  /^(?:\/(?:etc|bin|sbin|boot|lib|lib32|lib64|System|Library|private\/etc|usr\/(?!local(?:[\\/]|$))[^/]+|var\/(?!folders|tmp)[^/]+)(?:\/|$)|[A-Za-z]:[\\/](?:Windows|Program Files(?: \(x86\))?)(?:[\\/]|$))/i;

/** Writing to a path: what that means beyond the file itself. */
function writeRisk(path: string): Risk | undefined {
  if (ACCESS.test(path)) return severe('privilege', 'let someone sign in to this computer');
  if (SYSTEM.test(path)) return severe('privilege', 'change the computer’s own system files');
  if (AGENT_CONFIG.test(path))
    return severe('privilege', 'change what an assistant is allowed to do', false);
  if (PERSISTENT.test(path))
    return severe('persistence', 'set something to run by itself later', false);
  if (HOOKS.test(path))
    return moderate('persistence', 'change what runs when you commit, push or build');
  return undefined;
}

/** Files that hold keys, sign-ins or saved passwords, named on a command line. */
const SECRET_FILES =
  /(?:^|[\s"'=/\\])(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|\.netrc|\.git-credentials|\.pgpass|credentials\.db|application_default_credentials\.json|access_tokens\.db|Login Data|key4\.db|logins\.json)(?=$|[\s"';|&)])/;

/**
 * Where keys and sign-ins live, as absolute paths. `sandbox.ts` lists the
 * folders the box can't read; this is narrower, so reading a public key, a
 * folder's settings or Claude Code's skills isn't taken for a secret.
 */
const SECRET_PATHS: RegExp[] = [
  /[\\/]\.ssh[\\/](?![^\\/]*\.pub$)(?!config$)(?!known_hosts)[^\\/]+$/,
  /[\\/]\.aws[\\/](?:credentials|sso[\\/]cache)/,
  /[\\/]\.config[\\/]gcloud[\\/](?:credentials\.db|access_tokens\.db|application_default_credentials\.json|legacy_credentials)/,
  /[\\/]\.azure[\\/](?:accessTokens|msal_token_cache)/,
  /[\\/]\.kube[\\/]config$/,
  /[\\/]\.docker[\\/]config\.json$/,
  /[\\/]\.netrc$|[\\/]\.git-credentials$|[\\/]\.pgpass$/,
  /[\\/]\.config[\\/]gh[\\/]hosts\.yml$/,
  /[\\/]\.gnupg(?:[\\/]|$)/,
  /[\\/]\.password-store(?:[\\/]|$)/,
  /[\\/]Library[\\/](?:Keychains|Cookies)(?:[\\/]|$)/,
  /[\\/]\.claude[\\/]\.credentials\.json$|[\\/]\.codex[\\/]auth\.json$/,
  /[\\/]Group Containers[\\/]2BUA8C4S2C\.com\.1password|Bitwarden CLI[\\/]data\.json/,
  /[\\/](?:Login Data|Cookies|key4\.db|logins\.json)$/,
];

const isSecret = (path: string) => SECRET_PATHS.some((re) => re.test(path));
/** A whole folder of keys or sign-ins, copied or packed up at once. */
const SECRET_FOLDER =
  /[\\/](?:\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.password-store|\.config[\\/](?:gcloud|gh))[\\/]?$/;

function secretsNamed(part: string, places: Places): boolean {
  if (SECRET_FILES.test(part)) return true;
  return wordsOf(part)
    .slice(1)
    .map((w) => placeOf(w, places))
    .some((p) => p !== undefined && isSecret(p));
}

/** The processes a computer can't do without: stopping one logs you out, or worse. */
const SYSTEM_PROCESSES =
  /^(?:launchd|kernel_task|WindowServer|loginwindow|SystemUIServer|Finder|Dock|coreaudiod|mds|systemd|init|sshd|dbus-daemon|Xorg|Xwayland|gnome-shell|plasmashell|kwin\w*|gdm\w*|explorer(?:\.exe)?|csrss(?:\.exe)?|winlogon(?:\.exe)?|lsass(?:\.exe)?|svchost(?:\.exe)?|wininit(?:\.exe)?|smss(?:\.exe)?|services(?:\.exe)?|dwm(?:\.exe)?)$/i;

/** Stopping what the computer runs on, or shutting it down: unsaved work anywhere is lost. */
function disruptRisk(prog: string, words: string[], part: string): Risk | undefined {
  const args = words.slice(1);
  if (prog === 'kill') {
    // `kill -9 -1` is every program you run; `kill 1` is the one everything else starts from.
    // The signal first (`-9`, `-KILL`, `-s KILL`), then what it's sent to.
    let i = 0;
    if (args[0] === '-s' || args[0] === '-n') i = 2;
    else if (/^-(?:\d+|[A-Za-z]+)$/.test(args[0] ?? '')) i = 1;
    if (args[i] === '--') i++;
    if (args.slice(i).some((w) => w === '1' || w === '-1'))
      return severe('disrupt', 'stop every program on this computer, or the one it runs on');
  }
  if (/^(?:killall|pkill|taskkill)$/i.test(prog)) {
    const names = args.filter((w) => !/^[-/]/.test(w));
    if (names.some((n) => SYSTEM_PROCESSES.test(n.replace(/^["']|["']$/g, ''))))
      return severe('disrupt', 'stop a program this computer needs to keep running');
    if (prog === 'pkill' && /\s-\w*u\s*(?:root|0)\b/.test(part))
      return severe('disrupt', 'stop a program this computer needs to keep running');
  }
  if (
    /^(?:shutdown|reboot|halt|poweroff)$/.test(prog) ||
    (prog === 'systemctl' && /\b(?:reboot|poweroff|halt|kexec|suspend|hibernate)\b/.test(part)) ||
    (prog === 'init' && /^[06]$/.test(args[0] ?? '')) ||
    /\b(?:Stop|Restart)-Computer\b/i.test(part) ||
    (prog === 'osascript' && /\b(?:shut down|restart|log out)\b/i.test(part))
  )
    return severe('disrupt', 'restart or shut down this computer');
  return undefined;
}

/** Programs that reach another computer, by address or by name. */
const NETWORK =
  /^(?:curl|wget|http|https|xh|httpie|aria2c|nc|ncat|netcat|socat|telnet|ssh|scp|sftp|rsync|ftp|lftp|rclone|dig|nslookup|host|ping|ping6|traceroute|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)$/i;

/** A word that's an address on the internet, with a long query or path that could carry something. */
function carriesData(word: string): boolean {
  if (!/^https?:\/\//i.test(word)) return false;
  try {
    const u = new URL(word);
    return (
      u.search.length > 80 ||
      u.hash.length > 80 ||
      u.pathname.split('/').some((segment) => segment.length > 60) ||
      /[?&](?:q|data|d|payload|text|content|body|msg|token|key|secret|env)=[^&]{24,}/i.test(
        u.search,
      )
    );
  } catch {
    return false;
  }
}

/** One piece of a command line. */
function partRisk(part: string, places: Places): Risk | undefined {
  const words = wordsOf(part);
  const prog = program(part);
  if (!prog) return undefined;
  if (/^(?:rm|rmdir|unlink|shred|srm)$/.test(prog)) {
    const risk = rmRisk(words, places);
    if (risk) return risk;
  }
  if (
    /^(?:Remove-Item|ri|rd|del|erase)$/i.test(prog) &&
    words.some((w) => /^(?:-Recurse|\/s)$/i.test(w))
  ) {
    const targets = words.slice(1).filter((w) => !/^[-/]/.test(w));
    if (targets.some((t) => criticalTarget(t, places))) return WHOLE;
  }
  if (prog === 'find' && /\s-delete\b|-exec\s+rm\b/.test(part)) {
    const start = words[1] ?? '.';
    if (criticalTarget(start, places, false)) return WHOLE;
  }
  if (
    /^(?:mkfs(?:\.\w+)?|wipefs|fdisk|sfdisk|gdisk|parted)$/.test(prog) ||
    (prog === 'diskutil' &&
      /\b(?:erase\w*|zeroDisk|randomDisk|secureErase|partitionDisk|reformat)\b/i.test(part)) ||
    (prog === 'dd' && /\bof=\/dev\/(?!null\b|zero\b|stdout\b|stderr\b)/.test(part)) ||
    /^format$/i.test(prog)
  )
    return { ...WHOLE, reason: 'erase a disk' };
  if (/^(?:chmod|chown|chgrp)$/.test(prog) && /\s-\w*R/.test(part)) {
    const targets = words
      .slice(1)
      .filter((w) => !w.startsWith('-'))
      .slice(1);
    if (targets.some((t) => criticalTarget(t, places, false)))
      return { ...WHOLE, reason: 'change who owns every file in a whole folder like your home' };
  }
  if (/^(?:chmod|chown|chgrp|chflags|setfacl|icacls|takeown)$/i.test(prog)) {
    const targets = words.slice(prog === 'takeown' || prog === 'icacls' ? 1 : 2);
    if (
      targets.some((t) => {
        const path = placeOf(t, places);
        return path !== undefined && SYSTEM.test(path);
      })
    )
      return severe('privilege', 'change who may use the computer’s own system files');
  }
  if (prog === 'chmod' && /(?:^|\s)(?:[ugoa]*\+[rwx]*s|[2467][0-7]{3})(?:\s|$)/.test(part))
    return severe('privilege', 'make a program run with more power than you');
  const disrupt = disruptRisk(prog, words, part);
  if (disrupt) return disrupt;
  if (/^(?:su|runas|gsudo|run0)$/.test(prog) || /-Verb\s+RunAs\b/i.test(part))
    return severe('privilege', 'run something as the computer’s administrator');
  if (/^(?:visudo|dscl|usermod|useradd|adduser|passwd|chpasswd|net)$/.test(prog)) {
    if (prog !== 'net' || /\b(?:user|localgroup)\b/i.test(part))
      return severe('privilege', 'change who can use this computer or what they may do');
  }
  if (prog === 'git') return gitRisk(words);
  if (prog === 'csrutil' && /\bdisable\b/.test(part))
    return severe('safety-off', 'turn off your Mac’s system protection');
  if (prog === 'spctl' && /--(?:master|global)-disable|--disable\b/.test(part))
    return severe('safety-off', 'let any app run, checked or not');
  if (prog === 'xattr' && /com\.apple\.quarantine|(?:^|\s)-\w*c/.test(part))
    return severe('safety-off', 'take away the check your Mac does on downloaded apps');
  if (/^(?:setenforce)$/.test(prog) && /\b0\b/.test(part))
    return severe('safety-off', 'turn off SELinux');
  if (/^(?:ufw)$/.test(prog) && /\bdisable\b/.test(part))
    return severe('safety-off', 'turn off the firewall');
  if (/Set-MpPreference\b.*-Disable|Add-MpPreference\b.*-Exclusion/i.test(part))
    return severe('safety-off', 'turn off Windows Defender');
  if (
    /^(?:claude|codex|gemini|aider|goose|opencode|cline|cursor-agent|copilot|amp|qwen)$/.test(
      prog,
    ) &&
    /--dangerously-skip-permissions|--yolo\b|--dangerously-bypass-approvals-and-sandbox|--full-auto\b|--yes-always\b|--no-sandbox\b/.test(
      part,
    )
  )
    return severe('safety-off', 'start another assistant with its safety checks off', false);
  if (/^(?:crontab)$/.test(prog) && !/\s-l\b/.test(part))
    return severe('persistence', 'set something to run by itself on a schedule', false);
  if (prog === 'launchctl' && /\b(?:load|bootstrap|enable|submit)\b/.test(part))
    return severe('persistence', 'set something to run by itself at login', false);
  if (prog === 'systemctl' && /\b(?:enable|link)\b/.test(part))
    return severe('persistence', 'set a service to start by itself', false);
  if (/^(?:schtasks)$/i.test(prog) && /\/create\b/i.test(part))
    return severe('persistence', 'set something to run by itself on a schedule', false);
  if (/Register-ScheduledTask|New-Service\b|reg(?:\.exe)?\s+add\b.*\\Run\b/i.test(part))
    return severe('persistence', 'set something to run by itself later', false);
  if (
    /^(?:security)$/.test(prog) &&
    /\b(?:find-(?:generic|internet)-password|dump-keychain|export)\b/.test(part)
  )
    return severe('credentials', 'read saved passwords from your keychain');
  if (
    (prog === 'gh' && /\bauth\s+token\b/.test(part)) ||
    (prog === 'aws' &&
      /\bconfigure\s+(?:get\s+\w*(?:secret|key|token)|export-credentials)\b/.test(part)) ||
    (prog === 'gcloud' &&
      /\bauth\s+(?:print-access-token|print-identity-token|application-default\s+print-access-token)\b/.test(
        part,
      )) ||
    (prog === 'az' && /\bget-access-token\b/.test(part)) ||
    /169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254/.test(part)
  )
    return severe('credentials', 'print a sign-in token into the chat');
  // Keys handed to a copy as what's copied, not as the key it signs in with (`-i`): a file,
  // or a whole folder of them.
  if (/^(?:scp|sftp|rsync|rclone|tar|zip|7z|7za|ditto|cp)$/.test(prog)) {
    const copied = words
      .slice(1)
      .filter((w, i, all) => !/^-(?:i|F)$/.test(all[i - 1] ?? '') && !/IdentityFile/i.test(w));
    const folder = copied.some((w) => {
      const path = placeOf(w, places);
      return path !== undefined && SECRET_FOLDER.test(path);
    });
    if (folder || secretsNamed(['x', ...copied].join(' '), places))
      return /^(?:scp|sftp|rsync|rclone)$/.test(prog)
        ? severe('exfiltration', 'send your keys or saved sign-ins to another computer')
        : severe('credentials', 'read your keys or saved sign-ins');
  }
  if (
    secretsNamed(part, places) &&
    !/^(?:ssh|scp|sftp|ssh-keygen|ssh-add|ssh-copy-id|chmod|chown|ls|stat|test|\[|git|gpg-agent|keychain)$/.test(
      prog,
    )
  )
    return severe('credentials', 'read your keys or saved sign-ins');
  if (
    /^(?:ngrok|cloudflared|lt|localtunnel|bore|frpc|tailscale)$/.test(prog) &&
    /\b(?:http|tcp|tls|tunnel|local|funnel|start)\b|--port/.test(part)
  )
    return severe('exfiltration', 'open this computer to the internet', false);
  if (prog === 'ssh' && /\s-\w*R\b/.test(part))
    return severe('exfiltration', 'open this computer to another one', false);
  const infra = infraRisk(part, prog, words);
  if (infra) return infra;
  const publish = publishRisk(prog, words);
  if (publish) return publish;
  const install = installRisk(prog, words, places);
  if (install) return install;
  if (
    /^(?:docker|podman)$/.test(prog) &&
    (/\b(?:system|volume)\s+prune\b.*(?:--volumes|-a\b|--all\b)|\bvolume\s+(?:rm|remove)\b/.test(
      part,
    ) ||
      /\bcompose\b.*\bdown\b.*(?:\s-v\b|--volumes)/.test(part))
  )
    return moderate('wipe', 'delete the data a container kept, like a database’s');
  if (NETWORK.test(prog)) {
    // What a command prints, put in an address or a name to look up: a way out for anything.
    if (/\$\(|`/.test(part))
      return moderate('egress', 'send what a command printed to another computer');
    if (words.some(carriesData))
      return moderate('egress', 'send something in a web address that could carry what it read');
  }
  if (/^(?:curl|wget|http|https|xh|httpie)$/.test(prog)) {
    if (
      /\s(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|-F|--form(?:-string)?|-T|--upload-file|--json|--post-(?:data|file)|--body-(?:data|file))\b|\s-X\s*(?:POST|PUT|PATCH|DELETE)\b|--request\s+(?:POST|PUT|PATCH|DELETE)\b|--method=(?:POST|PUT|PATCH|DELETE)\b/i.test(
        part,
      ) ||
      (/^(?:http|https|xh)$/.test(prog) && /^(?:POST|PUT|PATCH|DELETE)$/i.test(words[1] ?? ''))
    )
      return moderate('egress', 'send data to an address on the internet');
  }
  if (
    /Invoke-(?:WebRequest|RestMethod)\b.*-Method\s+(?:Post|Put|Patch|Delete)|-InFile\b/i.test(part)
  )
    return moderate('egress', 'send data to an address on the internet');
  if (/^(?:nc|ncat|netcat|socat|telnet)$/.test(prog))
    return moderate('egress', 'open a raw connection to another computer');
  if (
    /^(?:scp|sftp|rsync|rclone|lftp|ftp)$/.test(prog) &&
    /(?:^|\s)(?:[\w.-]+@)?[\w.-]+:(?!\/\/)|\s\w+:[^\s]*|s3:\/\/|gs:\/\//.test(part)
  )
    return moderate('egress', 'copy files to another computer');
  if (prog === 'ssh' && words.filter((w) => !w.startsWith('-')).length >= 2)
    return moderate('egress', 'run a command on another computer');
  if (/^(?:aws|gsutil|azcopy)$/.test(prog) && /\b(?:cp|sync|mv)\b.*(?:s3|gs|https):\/\//.test(part))
    return moderate('egress', 'copy files to cloud storage');
  if (
    /^(?:python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php)$/.test(prog) &&
    /\s-(?:c|e|r|E)\b|\seval\b/.test(part) &&
    /\b(?:urllib|requests|httpx|http\.client|socket|fetch|https?\.request|net\.connect|XMLHttpRequest|IO::Socket|LWP|Net::HTTP|open-uri|curl_init|file_get_contents\s*\(\s*['"]https?)/.test(
      part,
    )
  )
    return moderate('egress', 'send data out from a script');
  return undefined;
}

const RANK = (risk: Risk) => (risk.harm === 'severe' ? 2 : 1) + (risk.lasting ? 1 : 0);

/** The most serious of several. */
function worst(risks: (Risk | undefined)[]): Risk | undefined {
  let best: Risk | undefined;
  for (const risk of risks) if (risk && (!best || RANK(risk) > RANK(best))) best = risk;
  return best;
}

/** What a command line could do, at its worst. */
export function commandRisk(command: string, context: RiskContext): Risk | undefined {
  const places: Places = {
    workspace: resolve(context.workspace),
    home: context.home ?? homedir(),
    scratch: [tmpdir(), '/tmp', '/private/tmp', '/var/folders'].map((p) => resolve(p)),
  };
  const risks: (Risk | undefined)[] = [];
  for (const script of scriptsOf(command)) {
    // Whole-line shapes: downloaded or decoded code handed straight to a shell.
    if (
      new RegExp(
        `${DOWNLOADER.source}[^|;&\\n]*\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:env\\s+)?(?:\\S*[\\\\/])?(?:(?:ba|z|da|k|fi)?sh|python\\d?(?:\\.\\d+)?|node|perl|ruby|php|pwsh|powershell|iex|Invoke-Expression|osascript)(?=\\s*(?:$|[;&|)\\n])|\\s+-s\\b|\\s+-(?:\\s|$)|\\s+--(?:\\s|$))`,
        'i',
      ).test(script) ||
      /(?:ba|z|da|k)?sh\s+<\(\s*(?:curl|wget)\b|(?:^|[\s;&|])(?:source|\.)\s+<\(\s*(?:curl|wget)\b/.test(
        script,
      ) ||
      /\b(?:iex|Invoke-Expression)\b[\s(]*(?:\(|\$)?\s*(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|\(?New-Object\s+(?:System\.)?Net\.WebClient)/i.test(
        script,
      ) ||
      /(?:^|[\s;&|])(?:(?:ba|z|da|k)?sh|eval)\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)\b/.test(
        script,
      ) ||
      /(?:^|[\s;&|])(?:python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php)\s+-[ce]\s+["']?\$\(\s*(?:curl|wget)\b/.test(
        script,
      ) ||
      /base64\s+(?:-d|--decode|-D)\b[^|;&]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python\d?|perl|node)\b/.test(
        script,
      ) ||
      /\|\s*base64\s+(?:-d|--decode|-D)\b[^|;&]*\|\s*(?:(?:ba|z|da|k)?sh|python\d?|perl|node)\b/.test(
        script,
      ) ||
      /FromBase64String\([^)]{40,}\)/i.test(script)
    )
      risks.push(
        severe('remote-code', 'run code downloaded from the internet without reading it first'),
      );
    // Run as the computer's administrator, wherever in the line.
    if (
      /(?:^|[;&|\n(]\s*|\$\(\s*|`\s*)(?:sudo|doas|pkexec|gsudo|run0)\b/.test(script) ||
      /(?:^|[;&|\n]\s*)su(?:\s+-\S*)*(?:\s+[\w-]+)?\s*(?:$|[;&|]|-c\b)/.test(script)
    )
      risks.push(severe('privilege', 'run something as the computer’s administrator'));
    // A safety check of the network disarmed for what runs next.
    if (
      /\b(?:NODE_TLS_REJECT_UNAUTHORIZED=0|PYTHONHTTPSVERIFY=0|GIT_SSL_NO_VERIFY=(?:1|true))\b/.test(
        script,
      )
    )
      risks.push(moderate('safety-off', 'turn off the check that keeps connections private'));
    // Every setting this computer has, printed whole: sign-in tokens among them.
    if (/^\s*(?:printenv|env|set)\s*$|^\s*(?:Get-ChildItem|gci|dir|ls)\s+env:\s*$/i.test(script))
      risks.push(
        moderate('credentials', 'print every setting this computer has, sign-in tokens included'),
      );
    if (DROP_BOXES.test(script))
      risks.push(severe('exfiltration', 'send something to an address made for catching data'));
    // Sign-ins on their way out, in one pipeline: every setting, or a project's `.env`.
    for (const pipeline of script.split(/\|\||&&|;|\n/)) {
      if (!SENDS.test(pipeline)) continue;
      if (
        /(?:^|[|(`]\s*|\$\(\s*)(?:env|printenv|set|export\s+-p|(?:Get-ChildItem|gci|dir|ls)\s+env:)\s*(?:$|[|)`])/i.test(
          pipeline.trim(),
        )
      )
        risks.push(
          severe(
            'exfiltration',
            'send every setting this computer has, sign-in tokens included, to another computer',
          ),
        );
      if (ENV_FILE.test(pipeline))
        risks.push(severe('exfiltration', 'send the keys in your .env file to another computer'));
    }
    if (
      /\/dev\/(?:tcp|udp)\/|\bnc\b[^|;&]*\s-\w*e\b|socat\b[^|;&]*\bexec:|bash\s+-i\s*>&/.test(
        script,
      )
    )
      risks.push(severe('exfiltration', 'hand control of this computer to another one'));
  }
  for (const part of commandParts(command)) {
    risks.push(partRisk(part, places));
    // `echo … > ~/.zshrc`, `tee -a ~/.ssh/authorized_keys`, `cp x ~/Library/LaunchAgents/`.
    for (const m of part.matchAll(
      /(?:>>?|\btee\s+(?:-a\s+)?|\b(?:cp|mv|ln|install)\s+(?:-\S+\s+)*\S+\s+)\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g,
    )) {
      const path = placeOf(m[1] ?? '', places);
      if (path && !/^\/dev\//.test(path)) risks.push(writeRisk(path));
    }
  }
  return worst(risks);
}

/**
 * Programs whose everyday use is reading, building, testing and tidying a
 * project, and the tools whose risky uses the rules above already read. A
 * second look (`risk-look.ts`) adds nothing for a line made only of these.
 */
const EVERYDAY = new Set([
  ...'ls pwd cd pushd popd cat bat head tail less more grep egrep fgrep rg ag find fd wc tree echo printf which whereis type date cal true false sleep test [ stat file du df basename dirname realpath readlink sort uniq cut tr sed awk jq yq diff cmp comm column paste fmt nl rev tee mkdir touch cp mv rm rmdir ln chmod tar unzip zip gzip gunzip bzip2 xz zstd ps lsof top htop pgrep kill pkill killall open code cursor vim nano export source . unset set printenv history clear time wait'.split(
    ' ',
  ),
  ...'git gh npm pnpm yarn bun npx bunx corepack nvm volta node tsc tsx ts-node vitest jest mocha eslint prettier biome oxlint turbo nx vite next playwright cypress storybook'.split(
    ' ',
  ),
  ...'python python3 pip pip3 pipx poetry uv uvx pytest ruff black mypy pyright tox nox virtualenv'.split(
    ' ',
  ),
  ...'cargo rustc rustup rustfmt go gofmt make cmake ninja meson bazel gradle gradlew mvn mvnw java javac kotlin kotlinc dotnet swift swiftc xcodebuild xcrun flutter dart deno ruby bundle rails rake rspec gem php composer elixir mix erl ghc stack cabal zig clang gcc g++ cc ld'.split(
    ' ',
  ),
  ...'docker podman kubectl helm terraform tofu pulumi aws gcloud az fly vercel netlify firebase brew apt apt-get dnf yum pacman sqlite3 psql mysql redis-cli mongosh ffmpeg ffprobe convert magick sips pandoc hugo jekyll'.split(
    ' ',
  ),
]);

/** Interpreters given code on the line itself, not a file of the project's. */
const INLINE_CODE =
  /^(?:python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php|pwsh|powershell|osascript|lua|Rscript)$/i;

/**
 * Whether a command is worth a second look by a small model, once the chat
 * has read something (`risk-look.ts`): the rules found nothing, and it isn't
 * only everyday work, and it can reach the internet or your sign-ins (it
 * runs outside the sealed box, or names an address or a program that sends).
 */
export function wantsSecondLook(command: string, unsealed: boolean): boolean {
  const parts = commandParts(command);
  const unusual = parts.some((part) => {
    const prog = program(part);
    if (!prog) return false;
    if (INLINE_CODE.test(prog)) return /\s-(?:c|e|r|E|Command)\b|\seval\b/i.test(part);
    return !EVERYDAY.has(prog);
  });
  if (!unusual) return false;
  return (
    unsealed ||
    /https?:\/\/|\/dev\/(?:tcp|udp)\//i.test(command) ||
    parts.some((part) => NETWORK.test(program(part)))
  );
}

// ── Any step ──────────────────────────────────────────────────────────────

const FILE_WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FILE_READERS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
/** Conch's own steps that delete in your apps. */
const DELETES =
  /(?:^|_|-)(?:delete|destroy|purge|drop|wipe|erase|trash|unpublish|revoke)(?:_|-|$)/i;

/**
 * What one step could do, at its worst, or undefined when it's routine.
 * Reading and changing the work folder are routine; so is what the sealed
 * box and Undo already cover.
 */
export function assessRisk(
  toolName: string,
  input: unknown,
  context: RiskContext,
): Risk | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const bare = toolName.replace(/^mcp__conch__/, '');
  const home = context.home ?? homedir();
  const places: Places = {
    workspace: resolve(context.workspace),
    home,
    scratch: [tmpdir(), '/tmp', '/private/tmp'].map((p) => resolve(p)),
  };
  if (
    (toolName === 'Bash' || toolName === 'PowerShell' || /^process_start$/.test(bare)) &&
    typeof args.command === 'string'
  )
    return commandRisk(args.command, context);
  if (FILE_WRITERS.has(toolName)) {
    const raw = String(args.file_path ?? args.notebook_path ?? '');
    const path = raw ? placeOf(raw, places) : undefined;
    return path ? writeRisk(path) : undefined;
  }
  if (FILE_READERS.has(toolName)) {
    const raw = String(
      args.file_path ?? args.path ?? (toolName === 'Glob' ? args.pattern : '') ?? '',
    );
    const path = raw ? placeOf(raw, places) : undefined;
    return path && isSecret(path)
      ? severe('credentials', 'read your keys or saved sign-ins')
      : undefined;
  }
  if (
    (/^(?:WebFetch|web_fetch)$/.test(bare) &&
      typeof args.url === 'string' &&
      DROP_BOXES.test(args.url)) ||
    (bare === 'recipe' &&
      Array.isArray(args.urls) &&
      args.urls.some((u) => typeof u === 'string' && DROP_BOXES.test(u)))
  )
    return severe('exfiltration', 'send something to an address made for catching data');
  if (
    bare === 'product_details' &&
    Array.isArray(args.urls) &&
    args.urls.some((url) => typeof url === 'string' && DROP_BOXES.test(url))
  )
    return severe('exfiltration', 'send something to an address made for catching data');
  // An app's step (your MCP apps, Conch's own Google, Slack and apps): what it deletes stays deleted.
  const app = /^mcp__(?!conch__)[a-z0-9_-]+?__(.+)$/.exec(toolName)?.[1];
  if (context.destructive || DELETES.test(app ?? (/^(?:google|slack|app)_/.test(bare) ? bare : '')))
    return severe('app-delete', 'delete something in one of your apps');
  return undefined;
}

/**
 * The circuit breaker no mode lifts, Full trust included (ADR 0100): deleting
 * a whole folder like home, the work folder or the disk. One model mistake
 * there can't be put back by anyone; Claude Code asks for these in bypass
 * mode too.
 */
export function breaksCircuit(
  toolName: string,
  input: unknown,
  context: RiskContext,
): Risk | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const bare = toolName.replace(/^mcp__conch__/, '');
  if (!(toolName === 'Bash' || toolName === 'PowerShell' || bare === 'process_start'))
    return undefined;
  if (typeof args.command !== 'string') return undefined;
  const places: Places = {
    workspace: resolve(context.workspace),
    home: context.home ?? homedir(),
    scratch: [],
  };
  for (const part of commandParts(args.command)) {
    const risk = partRisk(part, places);
    if (risk?.critical) return risk;
  }
  return undefined;
}
