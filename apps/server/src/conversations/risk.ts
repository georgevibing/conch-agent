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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { isRunScript, isSpaceChar } from '@conch/protocol';

import { declared, fromTooling, imitates, packageName, type Registry, wellKnown } from './packages';

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
  /** An app's step that pays, buys or moves money (ADR 0117). */
  | 'spend'
  /** Stopping what the computer needs to keep running, or shutting it down. */
  | 'disrupt';

export interface Risk {
  kind: RiskKind;
  harm: 'severe' | 'moderate';
  /** Conch can't put it back. */
  lasting: boolean;
  /** A tool's capability hint, not an established effect of this call. */
  possible?: boolean;
  /** What it would do, after "So I'm checking before I " (plain words, no jargon). */
  reason: string;
  /** No mode lifts it, Full trust included: a whole folder or disk gone (`breaksCircuit`). */
  critical?: boolean;
  /**
   * What a person would say to ask for this very step (ADR 0128): the words that name the
   * act, and the names (a branch, a package, a host, a path) their message must carry. A risk
   * without one can't be asked for: keys leaving, a stranger's code, money, the circuit breaker.
   */
  wish?: Wish;
  /**
   * The person asked for this very step in their own words, in their latest message
   * (ADR 0117, ADR 0128): a push, a deploy they named, a package they named. It goes ahead
   * before and after reading, as Claude Code's auto mode clears a soft block the person
   * named. It scores two at most.
   */
  asked?: boolean;
  /**
   * The person said not to, or not yet ("don't push", "wait before deploying"), and hasn't
   * said otherwise since (ADR 0128): a boundary, so it asks before reading too.
   */
  held?: boolean;
  /**
   * The step runs in one of the person's apps, on its own servers and as their account
   * (ADR 0118, 2026-10-27): code a Cloudflare or Supabase tool runs, not code on this computer.
   * Auto's review may lift it as it lifts other work in service of the request.
   */
  inApp?: boolean;
}

/** What a person says to ask for a step: the verbs, and what their message must name. */
export interface Wish {
  /** Words that name the act, as a regular expression's source without anchors or flags. */
  verbs: RegExp;
  /** Each must be named in the message, if any: a branch, a package, a host, a path, or a shape of words. */
  names?: readonly (string | RegExp)[];
}

export interface RiskContext {
  /** The chat's work folder. */
  workspace: string;
  /** For an app's tool: it may perform destructive updates (MCP destructiveHint). */
  destructive?: boolean;
  /**
   * For an app's tool, when known: `write` when it changes things, `read` when
   * it only looks (ADR 0117). What a tool's name says it does with money or
   * other people is read only for a tool known to change things.
   */
  access?: 'read' | 'write';
  /** Home folder (tests). */
  home?: string;
  /**
   * The person's own words, latest last, when a person is here and no one else's words are
   * in the chat (ADR 0117, 2026-10-09). Only they can make a step `asked`; a page can't.
   */
  said?: readonly string[];
  /**
   * Whether the repository a command would throw changes away in has nothing to lose: no
   * staged, changed or untracked files (ADR 0128). Asked only for such a command, with the
   * folder `git -C` names when it does; undefined when it can't be known.
   */
  treeClean?: (dir?: string) => boolean | undefined;
  /** Fresh local evidence that a remote keeps the same destination. */
  sameRemote?: (dir: string | undefined, remote: string, target: string) => boolean;
  /** For an app's step: the app by its name ("Cloudflare"), for the person to name too. */
  app?: string;
  /**
   * The branch checked out in the work folder, or the folder a command names (2026-10-27):
   * what "my branch" means for a force-push or a deleted remote branch. Undefined when unknown.
   */
  currentBranch?: (dir?: string) => string | undefined;
  /**
   * Variables a command gets from Passwords through its `secrets` (ADR 0151): a key that
   * leaves for anywhere but its own service asks after reading, whatever was said.
   */
  secretNames?: readonly string[];
}

/**
 * The score: three or more asks (ADR 0100). Harm (severe 2, moderate 1), lasting (1), what the
 * chat read (1), and a boundary the person stated (1). A step the person asked for in their own
 * words scores two at most (ADR 0128), so it goes ahead before and after reading; what can't be
 * asked for (`wish` unset) keeps its score.
 */
export function riskScore(risk: Risk, untrusted: boolean): number {
  const base = (risk.harm === 'severe' ? 2 : 1) + (risk.lasting ? 1 : 0);
  if (risk.asked) return Math.min(base, 2);
  return base + (untrusted ? 1 : 0) + (risk.held ? 1 : 0);
}

/**
 * Whether the person could lift this step by asking for it (ADR 0128): the risk has words to
 * ask with, and the chat has read nothing that would make its score three on its own.
 * `riskAsks(risk, true)` with this false asks on its own terms, whatever anyone says.
 */
export function askable(risk: Risk): boolean {
  if (risk.critical || risk.wish === NEVER) return false;
  return Boolean(risk.wish ?? WISHES[risk.kind]);
}

/** A step no words ask for: keys leaving, a stranger's code decoded from a blob, money. */
export const NEVER: Wish = { verbs: /(?!)/ };
/**
 * No one's words ask for it, but Auto's review may still see it serve the request (2026-10-27):
 * code an app runs that the rules couldn't read. Unlike `NEVER`, it stays reviewable.
 */
export const NOT_BY_WORDS: Wish = { verbs: /(?!)/ };

// ── What a person says, in the languages they write in (ADR 0145) ─────────

/**
 * Words for an act, each a stem that takes the rest of its word. They are read from a folded
 * message (`fold`: lower case, accents off), so "löschen" is written `l(?:o|oe)sch` and
 * "déployer" `deploy`. English is first, as each rule always said it.
 */
const stems = (...groups: readonly string[]) =>
  new RegExp(`\\b(?:${groups.filter(Boolean).join('|')})\\w*`);

/** Spanish, Portuguese and Italian put "it" on the end of the verb: "súbelo", "mándalo", "invialo". */
const CLITIC = '(?:lo|la|los|las|le|les|li|selo|sela|melo|ci)?';

/**
 * Each act in German, French, Spanish, Portuguese, Italian and Dutch, one line per language,
 * as `isHighStakes` knows a shop's words in them (ADR 0117). People write to Conch in their
 * own language; a push asked for in French is as asked as one in English (ADR 0145).
 */
const ABROAD = {
  push: [
    'gepusht', // German and Dutch ("pushen", "pushe" read as push)
    'pouss(?:e|es|er|ez|ons)\\b|envoi(?:e|es)\\b|envoy(?:er|ez)\\b', // French
    `sub(?:e|es|ir|id|a|an|as)${CLITIC}\\b|empuj`, // Spanish
    `sobe\\b|envi(?:a|ar|e|em)${CLITIC}\\b|empurr`, // Portuguese
    `push(?:a|are|ate|i|o)${CLITIC}\\b`, // Italian
  ].join('|'),
  forcePush: [
    'push\\w*\\s+(?:mit\\s+)?force|force[- ]?pushen', // German
    'pouss\\w*\\s+en\\s+force|forcer\\s+(?:le\\s+)?push|push\\s+force', // French
    'push\\s+forzado|forz(?:ar|a)\\s+(?:el\\s+)?push', // Spanish
    'push\\s+forcado|forc(?:ar|a)\\s+(?:o\\s+)?push', // Portuguese
    'push\\s+forzato|forz(?:are|a)\\s+(?:il\\s+)?push', // Italian
    'push\\s+geforceerd|forceer\\s+(?:de\\s+)?push', // Dutch
  ].join('|'),
  overwrite: [
    'u(?:e)?berschreib|umschreib', // German
    'ecras|reecri', // French
    'sobre?scrib|reescrib', // Spanish
    'sobrescrev|reescrev', // Portuguese
    'sovrascriv|riscriv', // Italian
    'overschrij|herschrij', // Dutch
  ].join('|'),
  delete: [
    'l(?:o|oe)sch|entfern', // German
    'supprim|effac|enlev|retir', // French
    `borr(?:a|ar|e|es|en|ad)${CLITIC}\\b|elimin(?:a|ar|e|en)${CLITIC}\\b|suprim|quit(?:a|ar|en)${CLITIC}\\b`, // Spanish
    `apag|exclu(?:a|ir|i|am)${CLITIC}\\b|remov`, // Portuguese
    `cancell|elimin(?:a|are|i)${CLITIC}\\b|rimuov|togli`, // Italian
    'verwijder|wis(?:sen|t)?\\b|weggooi', // Dutch
  ].join('|'),
  clean: [
    'aufr(?:a|ae)um|bereinig', // German
    'nettoi|nettoy|vide(?:r|z)?\\b', // French
    'limpi|vaci(?:a|ar)\\b', // Spanish
    'limp(?:a|ar|e)\\b|esvazi', // Portuguese
    'pulisc|pulir|svuot', // Italian
    'opruim|leeg', // Dutch
  ].join('|'),
  discard: [
    'verwerf|verwirf|zur(?:u|ue)cksetz|r(?:u|ue)ckg(?:a|ae)ngig', // German
    'annul|reinitialis|jet(?:te|er|ez)\\b', // French
    'descart|deshac|anul(?:a|ar|e)\\b|restablec', // Spanish
    'descart|desfaz|redefin(?:a|ir)\\b', // Portuguese
    'scart|annull|ripristin', // Italian
    'verwerp|terugzet|ongedaan', // Dutch
  ].join('|'),
  send: [
    'schick|verschick|versend|send(?:e|en|et)\\b|teil(?:e|en|t)\\b|hochlad|antwort|beantwort|benachrichtig', // German
    'envoi|envoy|partag|televers|repond|notifi|previen', // French
    `envi(?:a|ar|e|en)${CLITIC}\\b|mand(?:a|ar|e|en)${CLITIC}\\b|compart|sub(?:e|ir)${CLITIC}\\b|contest(?:a|ar|e)\\b|avis(?:a|ar|e)\\b`, // Spanish
    `envi(?:a|ar|e)${CLITIC}\\b|mand(?:a|ar|e)${CLITIC}\\b|compartilh|partilh|respond|avis(?:a|ar|e)\\b`, // Portuguese
    `invi(?:a|are|ate|o)${CLITIC}\\b|mand(?:a|are|ate)${CLITIC}\\b|condivid|carica|rispond|avvis`, // Italian
    'stuur|verstuur|verzend|deel(?:t|en)?\\b|antwoord|beantwoord|verwittig', // Dutch
  ].join('|'),
  copy: [
    'kopier|synchronisier|(?:u|ue)bertrag|verbind', // German
    'copi|synchronis|transfer|connect', // French
    'copi|sincroniz|transfer|conect', // Spanish and Portuguese
    'copi|sincronizz|trasferi|collega', // Italian
    'kopieer|synchroniseer|verbind', // Dutch
  ].join('|'),
  deploy: [
    'bereitstell|ausroll|live\\s+(?:schalt|stell|bring)', // German ("deployen" reads as deploy)
    'deploi|mett?(?:re|s|ez)?\\s+(?:\\w+\\s+)?en\\s+(?:prod|production|ligne)\\b', // French
    'despleg|desplieg|pon(?:er|lo|la)?\\s+(?:\\w+\\s+)?en\\s+(?:produccion|prod)\\b', // Spanish
    'implant|coloc(?:a|ar|que)\\s+(?:\\w+\\s+)?em\\s+(?:producao|prod)\\b', // Portuguese
    'rilasci|metti\\s+(?:\\w+\\s+)?in\\s+(?:produzione|prod)\\b', // Italian
    'uitrol|zet\\s+(?:\\w+\\s+)?(?:live|in\\s+(?:productie|prod))\\b', // Dutch
  ].join('|'),
  publish: [
    'ver(?:o|oe)ffentlich', // German
    'publi(?:e|er|ez)\\b', // French
    `publi(?:ca|car|que|quen)${CLITIC}\\b`, // Spanish and Portuguese
    `pubblic(?:a|are|ate)${CLITIC}\\b`, // Italian
    'publiceer', // Dutch
  ].join('|'),
  update: [
    'aktualisier', // German
    'met(?:s|tre|tez)?\\s+a\\s+jour', // French
    'actualiz|atualiz', // Spanish and Portuguese
    'aggiorn', // Italian
    'bijwerk|werk\\s+\\w+\\s+bij', // Dutch
  ].join('|'),
  install: [
    'installier|hinzuf(?:u|ue)g|verwend|benutz', // German
    'ajout|utilis', // French ("installer" reads as install)
    `instal|anad|agreg|us(?:a|ar|en)${CLITIC}\\b`, // Spanish
    'instal|adicion|us(?:a|ar|e)\\b', // Portuguese
    'aggiung|utilizz|us(?:a|are)\\b', // Italian
    'installeer|voeg|toevoeg|gebruik', // Dutch
  ].join('|'),
  run: [
    'ausf(?:u|ue)hr', // German
    'execut', // French and Portuguese
    'ejecut', // Spanish
    'esegu', // Italian
    'uitvoer|draai', // Dutch
  ].join('|'),
  destroy: [
    'zerst(?:o|oe)r|abbau|deinstallier', // German
    'detrui|desinstal', // French ("désinstaller")
    'destru|desinstal', // Spanish and Portuguese
    'distrugg|smantell|disinstall', // Italian
    'vernietig|afbre?ek', // Dutch
  ].join('|'),
  restart: [
    'neu\\s*start|herunterfahr|ausschalt|beend|abmeld|stopp', // German
    'redemarr|etein|arret|deconnect', // French
    'reinici|apag|deten|cierr|cerr(?:a|ar)\\b', // Spanish
    'reinici|deslig|encerr', // Portuguese
    'riavvi|spegn|ferm(?:a|are)\\b|chiud', // Italian
    'herstart|afsluit|uitschakel', // Dutch
  ].join('|'),
  schedule: [
    'zeitplan|t(?:a|ae)glich|st(?:u|ue)ndlich|w(?:o|oe)chentlich|jede[nr]?\\s+(?:tag|morgen|abend|stunde|woche)|autostart|beim\\s+(?:start|hochfahren|anmelden)', // German
    'planifi|tous\\s+les\\s+(?:jours|matins|soirs)|chaque\\s+(?:jour|matin|soir|heure|semaine)|au\\s+demarrage', // French
    'program(?:a|ar)\\b|cada\\s+(?:dia|hora|semana|manana|noche)|todos\\s+(?:los|os)\\s+dias|diariamente|al\\s+(?:iniciar|arrancar)', // Spanish
    'agendar|agende\\b|todo\\s+dia|ao\\s+iniciar|em\\s+segundo\\s+plano', // Portuguese
    "pianific|programmar|ogni\\s+(?:giorno|ora|settimana|mattina|sera)|quotidian|all'avvio", // Italian
    'inplan|elke\\s+(?:dag|ochtend|avond|week|uur)|dagelijks|bij\\s+het\\s+opstarten', // Dutch
  ].join('|'),
  safetyOff: [
    'deaktivier|abschalt|ausschalt|u(?:e)?berspring|umgeh', // German
    'desactiv|contourn', // French
    'desactiv|omit', // Spanish
    'desativ|pul(?:ar|e)\\b', // Portuguese
    'disattiv|aggir', // Italian
    'uitschakel|omzeil|overslaan', // Dutch
  ].join('|'),
  grant: [
    'berechtig|zugriff|freigeb|gew(?:a|ae)hr|erlaub|rechte\\b|einlad', // German
    'autoris|acces|accorde(?:r|z)?\\b|droits\\b|invit', // French
    'acces|permis|otorg|conced|autoriz|invit', // Spanish
    'acess|permiss|conced|autoriz|convid', // Portuguese
    'accesso|permess|concedi|autorizz|invit', // Italian
    'toegang|rechten\\b|machtig|bevoegd|uitnodig', // Dutch
  ].join('|'),
  admin: 'administrat|amministrat|beheerder', // the computer's administrator, in every language
  merge: 'fusion|zusammenf(?:u|ue)hr|mescl|unisc|samenvoeg',
  mirror: 'spiegel|miroir|espej|espelh|specchi',
  // Not French "accessible", which is English too.
  expose:
    'erreichbar|weiterleit|expon(?:er|e|ga)\\b|expor\\b|espon(?:i|ere|ete)\\b|blootstel|accesible|acessivel|raggiungibile|bereikbaar',
  change: '(?:a|ae)nder|modifi|cambi|mud(?:a|ar|e)\\b|altera|wijzig|verander',
  migrate: 'migr',
  public: '(?:o|oe)ffentlich|publique|pubblic|openbaar',
  secret:
    'geheim|schl(?:u|ue)ssel|secreto|segredo|clave|llave|chave|chiave|segret|sleutel|zertifikat|certificat|certificad|certificaat',
} as const;

/** The words that ask for each kind of step, when a rule names none of its own (ADR 0128). */
const WISHES: Partial<Record<RiskKind, RegExp>> = {
  history: stems(
    'force[- ]?push|overwrite|rewrite|reset|discard|throw\\s+away|revert|undo|start\\s+(?:over|fresh|again)|scrap|drop|clear|stash|delete|remove|prune',
    ABROAD.forcePush,
    ABROAD.overwrite,
    ABROAD.discard,
    ABROAD.delete,
  ),
  egress: stems(
    'send|post|upload|submit|put|patch|sync|copy|transfer|push|deploy|publish|share|call|hit|request|ssh|connect|run\\s+(?:it\\s+)?on',
    ABROAD.send,
    ABROAD.copy,
    ABROAD.push,
    ABROAD.deploy,
    ABROAD.publish,
  ),
  infra: stems(
    'deploy|ship|release|roll\\s*out|go\\s+live|put\\s+(?:it\\s+)?(?:up|live|online)|apply|launch|publish|provision|create|destroy|tear\\s+down|delete|remove|take\\s+down|decommission|scale|restart|rollback|roll\\s+back|migrat|drop|reset|wipe|truncate|recreate|grant|give|allow|share|secret|dns|record|certificate|cert|domain|merge|public|open[- ]source|protect|admin',
    ABROAD.deploy,
    ABROAD.publish,
    ABROAD.destroy,
    ABROAD.delete,
    ABROAD.migrate,
    ABROAD.grant,
    ABROAD.merge,
    ABROAD.secret,
    ABROAD.public,
  ),
  publish: stems(
    'publish|release|ship|push|upload|unpublish|deprecate|yank|take\\s+(?:it\\s+)?down|remove|tag',
    ABROAD.publish,
    // Not "sube" or "envía": they say more than publishing does.
    'gepusht|pouss(?:e|er|ez)\\b|rilasci|hochlad|televers',
  ),
  install: stems(
    'install|add|use|need|try|with|set\\s*up|get|bring\\s+in|pull\\s+in|update|upgrade|bump',
    ABROAD.install,
    ABROAD.update,
  ),
  wipe: stems(
    'delete|remove|rm|clean|clear|wipe|erase|get\\s+rid|trash|tidy|prune|empty|reset|fresh',
    ABROAD.delete,
    ABROAD.clean,
  ),
  'app-delete': stems(
    'delete|remove|trash|cancel|clear|get\\s+rid|drop|archive|unsubscribe|decline|dismiss|erase|wipe|clean',
    ABROAD.delete,
    ABROAD.clean,
    'storn|absag|k(?:u|ue)ndig|annul|anul(?:a|ar)\\b|disdic|opzeg|archiv', // cancelling and archiving
  ),
  disrupt: stems(
    'restart|reboot|shut\\s*down|power\\s+off|kill|stop|quit|force[- ]quit|log\\s*out|end',
    ABROAD.restart,
  ),
  persistence: stems(
    'schedule|cron|every\\s+(?:day|hour|morning|night|week|minute|evening)|daily|hourly|weekly|nightly|at\\s+login|on\\s+(?:start|boot|login)|start\\s*up|automatic|launch\\s*agent|service|daemon|background|keep\\s+(?:it\\s+)?running|by\\s+itself|hook|workflow|action|pipeline|ci\\b|zshrc|bashrc|profile|shell|path|alias|dotfile',
    ABROAD.schedule,
    'automati(?:sch|que|co|ca|camente|quement)\\b', // automatisch, automatique, automático
  ),
  'safety-off': stems(
    'disable|turn\\s+off|switch\\s+off|skip|bypass|unsafe|insecure|no[- ]verify|yolo|dangerously|without\\s+(?:the\\s+)?(?:check|sandbox|permission|verif|guard|protection)|allow\\s+(?:any|all|unsigned)|quarantine|gatekeeper|firewall|defender|selinux|sip\\b|certificate|ssl|tls|hook',
    ABROAD.safetyOff,
    'quarant(?:a|ae)ne|quarantaine|cuarentena|quarentena|quarantena', // the quarantine flag
  ),
  privilege: stems(
    'sudo|admin|administrator|root|superuser|elevat|as\\s+super|permission|chmod|chown|owner|grant|give|allow|access|role|policy|iam|share|collaborator|protect|user|account|password|group|setuid',
    ABROAD.admin,
    ABROAD.grant,
  ),
  'remote-code': stems(
    'install|run|set\\s*up|use|get|execute|bootstrap|script|installer|curl|wget|pipe',
    ABROAD.install,
    ABROAD.run,
  ),
};

// ── Reading the person's own words (ADR 0128, ADR 0145) ───────────────────

/**
 * A message as its intent is read: lower case, accents off ("löschen" reads as "loschen",
 * "não" as "nao"), one kind of apostrophe, and French elisions apart ("n'oublie" is
 * "ne oublie"). The words above and below are written for this.
 */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘ʼ´`]/g, "'")
    .replace(/[¿¡]/g, ' ')
    .replace(/\b(qu|[cdjlmnst])'(?=[a-z])/g, '$1e ');
}

/**
 * Where a "not" governs something other than the act, so it holds nothing: "don't forget to
 * push", "no need to ask me", "not only … but also", "can't you just push?", "I haven't
 * pushed yet" (a state, not a boundary). Blanked out before a message is read for holds.
 */
const NOT_A_HOLD = new RegExp(
  [
    // English
    "\\b(?:do\\s+not|don't|dont|never)\\s+(?:you\\s+)?(?:forget|hesitate|worry|bother|fail|mind|be\\s+(?:afraid|shy|scared)|wait(?:\\s+(?:for|on|up)(?:\\s+(?:me|us))?)?|ask(?:\\s+(?:me|us))?|check\\s+with\\s+(?:me|us))\\b",
    "\\b(?:(?:do|does)\\s+not|don't|dont|doesn't|needn't)\\s+(?:need|have)\\s+to\\s+(?:ask|wait|check|confirm)\\w*(?:\\s+(?:with\\s+)?(?:me|us))?",
    '\\bno\\s+need\\s+(?:to\\s+|for\\s+)?(?:ask|wait|check|confirm|run\\s+it\\s+by|ping)\\w*(?:\\s+(?:with\\s+)?(?:me|us))?',
    '\\bwithout\\s+(?:asking|waiting|checking|confirming|bothering)(?:\\s+(?:(?:with|for)\\s+)?(?:me|us))?\\b',
    '\\bnot\\s+only\\b|\\bnever\\s*mind\\b|\\bno\\s+(?:problem|worries|rush|doubt)\\b|\\bno\\s+reason\\s+not\\s+to\\b',
    "\\b(?:can't|cannot|couldn't|won't|wouldn't)\\s+(?:you|we)\\b(?!\\s+dare)|\\bwhy\\s+(?:not|don't\\s+(?:you|we))\\b|\\b(?:wouldn't|won't|doesn't|can't)\\s+hurt\\b",
    "\\b(?:didn't|haven't|hasn't|hadn't|wasn't|weren't|(?:did|have|has|had|was|were)\\s+not)\\b",
    // German
    '\\bvergi(?:ss|sst)\\s+(?:\\w+\\s+){0,2}?nicht\\b|\\bnicht\\s+vergessen\\b|\\bz(?:o|oe)ger\\w*\\s+(?:\\w+\\s+)?nicht\\b',
    '\\bkeine?\\s+(?:sorge|sorgen|angst|problem|eile)\\b|\\bnicht\\s+nur\\b|\\bwarum\\s+nicht\\b',
    '\\b(?:musst|brauchst|muss|braucht|m(?:u|ue)sst)\\s+(?:mich\\s+|uns\\s+)?(?:nicht|kein\\w*)\\s+(?:mehr\\s+)?(?:zu\\s+)?(?:fragen|nachfragen|warten|best(?:a|ae)tigen)\\b',
    '\\bohne\\s+(?:mich\\s+|uns\\s+)?(?:zu\\s+)?(?:fragen|nachzufragen|nachfragen|warten|r(?:u|ue)ckfrage)\\b|\\bwarte[nt]?\\s+nicht(?:\\s+auf\\s+(?:mich|uns))?\\b',
    '\\b(?:kannst|k(?:o|oe)nntest|k(?:o|oe)nnt)\\s+(?:du|ihr)\\s+(?:das\\s+|es\\s+)?nicht\\b',
    // French
    '\\b(?:ne\\s+)?(?:oubli|hesit)(?:e|es|ez)\\s+pas\\b|\\b(?:ne\\s+)?(?:te|vous)\\s+(?:inquiete[sz]?|en\\s+fai(?:s|tes))\\s+pas\\b',
    '\\bpas\\s+(?:besoin|la\\s+peine)\\s+de\\s+(?:me\\s+|nous\\s+)?(?:demander|redemander|attendre|verifier|confirmer)\\b',
    '\\bsans\\s+(?:me\\s+|nous\\s+)?(?:demander|attendre|confirmer)\\b|\\b(?:ne\\s+)?(?:me\\s+|nous\\s+)?attend(?:s|ez)\\s+pas\\b',
    '\\bnon\\s+seulement\\b|\\b(?:pas\\s+de|aucun)\\s+(?:souci|soucis|probleme)\\b|\\b(?:tu|vous)\\s+(?:ne\\s+)?(?:peux|pouvez|pourrais|pourriez)\\s+pas\\b|\\bpourquoi\\s+pas\\b',
    // Spanish
    '\\bno\\s+(?:te\\s+|se\\s+)?olvid(?:es|e|en)\\b|\\bno\\s+(?:lo\\s+)?dud(?:es|e|en)\\b|\\bno\\s+(?:te\\s+|se\\s+)?preocup(?:es|e|en)\\b',
    '\\bno\\s+(?:hace\\s+falta|es\\s+necesario|necesitas|tienes\\s+que|hay\\s+que)\\s+(?:que\\s+)?(?:preguntar|esperar|consultar|confirmar)\\w*',
    '\\bsin\\s+(?:preguntar|esperar|consultar|confirmar)\\w*|\\bno\\s+(?:me\\s+)?esper(?:es|e|en)\\b',
    '\\bno\\s+(?:solo|solamente)\\b|\\b(?:no\\s+hay|ningun|sin)\\s+problema\\b|\\bno\\s+(?:puedes|podrias)\\b|\\bpor\\s+que\\s+no\\b',
    // Portuguese
    '\\bnao\\s+(?:se\\s+|te\\s+)?esque(?:ca|cas|cam|ce)\\b|\\bnao\\s+hesit(?:e|es)\\b|\\bnao\\s+(?:se\\s+|te\\s+)?preocup(?:e|es)\\b',
    '\\bnao\\s+(?:precisa|precisas|e\\s+preciso|tem\\s+que|tens\\s+que)\\s+(?:de\\s+)?(?:me\\s+)?(?:perguntar|esperar|consultar|confirmar)\\b',
    '\\bsem\\s+(?:me\\s+)?(?:perguntar|esperar|consultar|confirmar)\\b|\\bnao\\s+(?:me\\s+)?esper(?:e|es)\\b',
    '\\bnao\\s+(?:so|apenas)\\b|\\b(?:sem|nenhum)\\s+problema\\b|\\bnao\\s+(?:podes|poderias|consegues)\\b|\\bpor\\s*que\\s+nao\\b',
    // Italian
    '\\bnon\\s+(?:ti\\s+)?(?:dimentic|scord|preoccup)\\w*|\\bnon\\s+esit\\w*',
    '\\bnon\\s+(?:serve|devi|occorre|e\\s+necessario|ce\\s+e\\s+bisogno\\s+di)\\s+(?:che\\s+)?(?:mi\\s+)?(?:chied|aspett|conferm)\\w*',
    '\\bsenza\\s+(?:chied|aspett|conferm)\\w*|\\bnon\\s+(?:mi\\s+)?aspett\\w*',
    '\\bnon\\s+solo\\b|\\bnessun\\s+problema\\b|\\bnon\\s+(?:puoi|potresti)\\b|\\bperche\\s+no\\b',
    // Dutch
    '\\bvergeet\\s+(?:\\w+\\s+)?niet\\b|\\bniet\\s+vergeten\\b|\\baarzel\\s+niet\\b|\\bgeen\\s+(?:zorgen|probleem|haast)\\b',
    '\\b(?:hoeft|hoef|hoeven)\\s+(?:je\\s+)?(?:het\\s+)?(?:mij\\s+|me\\s+|ons\\s+)?niet\\s+(?:eerst\\s+)?(?:te\\s+)?(?:vragen|wachten)\\b|\\bniet\\s+nodig\\s+om\\s+(?:eerst\\s+)?(?:te\\s+)?(?:vragen|wachten)\\b',
    '\\bzonder\\s+(?:te\\s+)?(?:vragen|wachten|overleggen)\\b|\\bwacht\\s+niet(?:\\s+op\\s+(?:mij|me|ons))?\\b',
    '\\bniet\\s+alleen\\b|\\b(?:kun|kunt)\\s+(?:je|jij|u)\\s+(?:het\\s+)?niet\\b|\\bwaarom\\s+niet\\b',
  ].join('|'),
  'g',
);

/** A word that says not to: "don't", "never", "without", "nicht", "pas", "no", "não", "non", "niet". */
const NEG_WORD =
  /^(?:\w+n't|dont|not|no|never|without|nor|neither|cannot|nicht|nichts|kein\w*|nie|niemals|ohne|ne|pas|jamais|sans|aucune?|rien|nunca|jamas|sin|ningun[oa]?|nada|nao|sem|nenhuma?|non|mai|senza|nessun[oa]?|niente|nulla|niet|nooit|zonder|geen|niets)$/;
/** A word that says not yet: "wait", "hold off", "avoid", "skip", "warte", "attends", "espera", "aspetta", "wacht". */
const HOLD_WORD =
  /^(?:wait\w*|hold\w*|avoid\w*|skip\w*|refrain\w*|stop|pause|postpone\w*|delay\w*|leave|warte[nt]?|vermeid\w*|u(?:e)?berspring\w*|verschieb\w*|attend(?:s|ez|re)|evit\w*|arret(?:e|ez|er)|esper(?:a|e|ad|ar|en)|omit\w*|pospon\w*|aguard\w*|aspett\w*|attendi|rimand\w*|wacht\w*|vermijd\w*)$/;
/** German, Dutch and French say not after the verb: "push nicht", "push nog niet", "pousse pas". */
const NEG_AFTER =
  /^(?:nicht|nichts|nie|niemals|kein\w*|niet|niets|nooit|geen|pas|rien|jamais|aucune?)$/;
/** "And", which starts a new act unless one "not" covers both ("don't commit and push"). */
const AND_WORD = /^(?:and|&|plus|und|sowie|et|y|ed|en)$/;
/** Where one clause ends and another starts: "but", "then", "so", in every language. */
const CLAUSE_WORD =
  /^(?:[,;:()]|but|then|so|afterwards|aber|dann|danach|anschliessend|sondern|mais|puis|ensuite|alors|pero|luego|despues|entonces|sino|depois|entao|ma|poi|dopo|quindi|allora|maar|daarna|vervolgens)$/;
/** Acts two at a time under one "not": "don't commit and push", "nicht committen und pushen". */
const TOGETHER =
  /^(?:commit|merg|rebas|tag|build|push|deploy|release|publish|ship|send|delet|remov|install|upload|pouss|sub|envi|l(?:o|oe)sch|supprim|borr|verwijder)/;
/** How many words before the act a "not" still reaches. */
const REACH = 7;

/**
 * Said as the person's say: "until I say", "once I've looked", "my OK", "ask me first", "wait
 * for me". The act waits on them, wherever in the sentence it is.
 */
const ON_THEIR_SAY = new RegExp(
  [
    // English
    "\\b(?:until|till|til|unless|before|when|once|after|as\\s+soon\\s+as)\\s+i(?:'ve|'m|'ll|'d|\\s+have|\\s+am|\\s+will|\\s+can)?\\s+(?:\\w+\\s+){0,2}?(?:say|said|tell|told|approv|review|look|check|confirm|give|gave|sign|ok|okay|decid|agree|am\\s+back|get\\s+back|come\\s+back|see|seen|saw|test|read|let\\s+you\\s+know|green)",
    '\\bmy\\s+(?:ok|okay|approval|review|go-?ahead|go\\s+ahead|say-?so|sign-?off|green\\s+light|permission|consent|confirmation)\\b|\\bwait\\s+for\\s+(?:me|us|my)\\b',
    '\\b(?:ask|check\\s+with|ping|confirm\\s+with|run\\s+it\\s+by|talk\\s+to|consult|show)\\s+(?:me|us)\\b[^\\n]{0,120}\\b(?:first|before|beforehand)\\b',
    '\\b(?:first|before|beforehand)\\b[^\\n]{0,120}\\b(?:ask|check\\s+with|ping|confirm\\s+with|run\\s+it\\s+by|talk\\s+to|consult|show)\\s+(?:me|us)\\b',
    "\\b(?:let\\s+me|i\\s+(?:want|need|would\\s+like|'d\\s+like)\\s+to)\\s+(?:look|review|see|check|test|read|approve|decide)\\b[^\\n]{0,120}\\b(?:first|before)\\b",
    // German
    '\\b(?:bis|bevor|sobald|nachdem|erst\\s+wenn|erst\\s+nachdem)\\s+ich\\b|\\bwenn\\s+ich\\s+(?:es\\s+|das\\s+)?(?:sage|sag|freigebe|ok|okay|bescheid|zustimme)\\b',
    '\\bfrag\\w*\\s+(?:mich|uns)\\s+(?:vorher|zuerst|erst)\\b|\\bmeine?\\s+(?:ok|okay|go|freigabe|zustimmung)\\b|\\bwarte\\w*\\s+auf\\s+(?:mich|uns|mein\\w*)\\b',
    // French
    "\\b(?:jusqu'?a\\s+ce\\s+que|avant\\s+que|des\\s+que|apres\\s+que|une\\s+fois\\s+que|tant\\s+que)\\s+je\\b|\\bquand\\s+je\\s+(?:te\\s+)?(?:le\\s+)?(?:dis|dirai|valide|confirme)\\b",
    '\\bdemande[rsz]?\\s*-?\\s*(?:moi|nous)\\s+(?:avant|de\\s+abord)\\b|\\bmon\\s+(?:accord|feu\\s+vert|ok|aval|go)\\b|\\battend(?:s|ez)\\s*-?\\s*moi\\b',
    // Spanish
    '\\b(?:hasta\\s+que|antes\\s+de\\s+que|en\\s+cuanto|despues\\s+de\\s+que|una\\s+vez\\s+que|cuando)\\s+(?:yo\\s+)?(?:te\\s+)?(?:lo\\s+)?(?:diga|revise|apruebe|mire|vea|confirme|autorice|compruebe)\\b',
    '\\b(?:preguntame|consultame)\\s+(?:antes|primero)\\b|\\bmi\\s+(?:ok|visto\\s+bueno|aprobacion|confirmacion)\\b|\\besperame\\b',
    // Portuguese
    '\\b(?:ate\\s+(?:que\\s+)?eu|antes\\s+(?:de|que)\\s+eu|quando\\s+eu|assim\\s+que\\s+eu|depois\\s+(?:que|de)\\s+eu)\\b',
    '\\b(?:pergunte|pergunta)\\s*-?\\s*me\\s+(?:antes|primeiro)\\b|\\bme\\s+pergunte\\s+(?:antes|primeiro)\\b|\\bmeu\\s+(?:ok|aval|sinal\\s+verde)\\b|\\bminha\\s+(?:aprovacao|confirmacao|autorizacao)\\b|\\b(?:espere|espera|aguarde)\\s+por\\s+mim\\b',
    // Italian
    '\\b(?:finche\\s+non|fino\\s+a\\s+quando|prima\\s+che\\s+io|dopo\\s+che\\s+io|appena\\s+io)\\b|\\bquando\\s+(?:te\\s+lo\\s+|lo\\s+)?(?:dico|diro|approvo|controllo|guardo|confermo)\\b',
    '\\bchiedimi\\s+(?:prima|conferma)\\b|\\bil\\s+mio\\s+(?:ok|via\\s+libera|consenso)\\b|\\bla\\s+mia\\s+(?:approvazione|conferma)\\b|\\baspettami\\b',
    // Dutch
    '\\b(?:tot(?:dat)?|voordat|zodra|nadat)\\s+ik\\b|\\bals\\s+ik\\s+(?:het\\s+)?(?:zeg|goedkeur)\\b|\\bvraag\\s+(?:het\\s+)?(?:mij|me)\\s+eerst\\b|\\bmijn\\s+(?:ok|akkoord|goedkeuring|fiat)\\b|\\bwacht\\s+op\\s+(?:mij|me|mijn|ons)\\b',
  ].join('|'),
);

/** Not yet, said on its own: "push it, but not yet", "pas encore", "noch nicht", "nog niet". */
const NOT_YET = new RegExp(
  [
    '\\bnot\\s+(?:yet|now|today|until)\\b|\\bbut\\s+(?:wait|hold)\\b', // English
    '\\bnoch\\s+nicht\\b|\\bnicht\\s+(?:jetzt|heute|sofort)\\b|\\baber\\s+warte\\b', // German
    "\\bpas\\s+(?:encore|maintenant|aujourd'hui|tout\\s+de\\s+suite)\\b|\\bmais\\s+attend", // French
    '\\b(?:todavia|aun)\\s+no\\b|\\bno\\s+(?:todavia|aun|ahora|hoy)\\b|\\bpero\\s+espera\\b', // Spanish
    '\\bainda\\s+nao\\b|\\bnao\\s+(?:ainda|agora|hoje)\\b|\\bmas\\s+espera', // Portuguese
    '\\bnon\\s+(?:ancora|ora|adesso|oggi|subito)\\b|\\bma\\s+aspetta\\b', // Italian
    '\\bnog\\s+niet\\b|\\bniet\\s+(?:nu|vandaag|meteen)\\b|\\bmaar\\s+wacht\\b', // Dutch
  ].join('|'),
);

/** A short sentence after it that takes it back: "Push it. No, wait.", "Never mind.", "Laisse tomber." */
const TAKEN_BACK =
  /^\s*(?:(?:no|nein|non|nee|nao|actually)\b[\s,]*)*(?:wait|hold\s+(?:on|off)|stop|scratch\s+that|never\s*mind|not\s+yet|don't|warte|stopp|doch\s+nicht|noch\s+nicht|vergiss\s+es|attends|pas\s+encore|laisse\s+tomber|espera|todavia\s+no|aun\s+no|olvidalo|ainda\s+nao|esquece|aspetta|non\s+ancora|lascia\s+perdere|wacht|nog\s+niet|laat\s+maar)\b/;

const WORD = /[,;:()]|[^\s,;:()-]+/g;

/** A "not" or a "wait" over the act, in its own clause, a few words before it. */
function heldBefore(text: string): boolean {
  const words = text.match(WORD) ?? [];
  for (let i = words.length - 1, reach = 0; i >= 0 && reach < REACH; i--, reach++) {
    const word = words[i] ?? '';
    if (CLAUSE_WORD.test(word)) return false;
    // French "n'en supprime aucune" reads "ne en": that "en" is "of them", not "and".
    if (AND_WORD.test(word) && words[i - 1] !== 'ne') {
      const [not, act] = [words[i - 2] ?? '', words[i - 1] ?? ''];
      return (NEG_WORD.test(not) || HOLD_WORD.test(not)) && TOGETHER.test(act);
    }
    if (NEG_WORD.test(word) || HOLD_WORD.test(word)) return true;
  }
  return false;
}

/** A "not" just after the act, as German, Dutch and French say it: "lösch die Einträge nicht". */
function heldAfter(text: string): boolean {
  for (const word of (text.match(WORD) ?? []).slice(0, 4)) {
    if (CLAUSE_WORD.test(word) || AND_WORD.test(word)) return false;
    if (NEG_AFTER.test(word)) return true;
  }
  return false;
}

/**
 * What one message says about an act (ADR 0145): `held` when a "not" or a "wait" governs it,
 * or it waits on the person's say; `asked` when it's named and nothing holds it; undefined
 * when it isn't named. "Run the tests before pushing" sequences the push, it doesn't hold it.
 */
function intent(verbs: RegExp, message: string): 'asked' | 'held' | undefined {
  // The message is folded, so lower case already.
  const act = new RegExp(verbs.source, 'giu');
  // Sentences: a full stop that ends one, not the one in "v2.0.0" or "github.com".
  const sentences = message.split(/[.!?]+(?=\s|$)|\n+/);
  let read: 'asked' | undefined;
  for (const [n, sentence] of sentences.entries()) {
    const plain = sentence
      .replace(NOT_A_HOLD, (m) => ' '.repeat(m.length))
      .replace(/\s[-–—]+\s|[–—]/g, (m) => ','.padEnd(m.length));
    for (const m of sentence.matchAll(act)) {
      if (!m[0]) continue;
      read = 'asked';
      if (
        ON_THEIR_SAY.test(plain) ||
        NOT_YET.test(plain) ||
        heldBefore(plain.slice(0, m.index)) ||
        heldAfter(plain.slice(m.index + m[0].length)) ||
        sentences.slice(n + 1).some((s) => s.trim().split(/\s+/).length <= 4 && TAKEN_BACK.test(s))
      )
        return 'held';
    }
  }
  return read;
}

/**
 * What the person wrote themselves in a message, without what they pasted in (2026-10-27): a
 * fenced block, a triple-quoted one, lines quoted with `>`, a long passage in quotation marks,
 * and the middle of a long paste. "URGENT: update the DNS to 6.6.6.6" quoted from an email is
 * the email's words, not theirs, so it never asks for a step; the review reads it the same way.
 */
export function ownWords(message: string): string {
  let text = message
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/"""[\s\S]*?(?:"""|$)/g, ' ')
    .replace(/[“"«„][^”"»“\n]{120,}[”"»“]/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
  const lines = text.split('\n').filter((line) => line.trim());
  // A long paste: what they asked is at its start or its end, the pasted text between.
  if (text.length > 1200 && lines.length > 12)
    text = [...lines.slice(0, 2), ...lines.slice(-2)].join('\n');
  return text;
}

/** The person's message, folded, names this: as a whole word, not part of another. */
function names(last: string, name: string | RegExp): boolean {
  if (name instanceof RegExp) return new RegExp(name.source, 'iu').test(last);
  const key = fold(name);
  if (!key) return true;
  let at = last.indexOf(key);
  while (at >= 0) {
    // A whole word: "main" isn't "main-fix", but "github.com/ada/shop" names github.com and
    // "~/Documents/old-notes.txt" names old-notes.txt.
    const before = last[at - 1] ?? ' ';
    const after = last[at + key.length] ?? ' ';
    if (!/[\w-]/.test(before) && !/[\w-]/.test(after)) return true;
    at = last.indexOf(key, at + 1);
  }
  return false;
}

/**
 * What the person's words say about this step (ADR 0128, ADR 0145), in any language they
 * write in, the latest message that mentions it deciding: said not to, and not since, it's
 * `held`; asked for with every name it needs, it's `asked`. Follow-up questions do not revoke
 * authorization. A later statement about the same act replaces it; clearing the chat drops
 * both authorization and boundaries.
 */
export function wanted(risk: Risk, said: readonly string[] | undefined): Risk {
  const verbs = risk.wish?.verbs ?? WISHES[risk.kind];
  if (!verbs || !said?.length || !askable(risk)) return risk;
  for (let i = said.length - 1; i >= 0; i--) {
    const message = fold(ownWords(said[i] ?? ''));
    const read = intent(verbs, message);
    if (!read) continue;
    if (read === 'held') return { ...risk, held: true, asked: false };
    if ((risk.wish?.names ?? []).every((name) => names(message, name)))
      return { ...risk, asked: true };
    return risk;
  }
  return risk;
}

/** What the card says (`GuardNote`): what it would do, and whether that can be put back. */
export function riskWords(risk: Risk | undefined): string {
  if (!risk) return 'This could matter, so I’m checking first.';
  if (risk.possible)
    return 'This tool can change or delete app data. I’m checking before running it.';
  return `This would ${risk.reason}${risk.lasting ? ', and that can’t be undone' : ''}. So I’m checking first.`;
}

/**
 * The class a person's **Always allow** lifts for the rest of a chat, when Auto asked about this
 * risk after reading (ADR 0117, 2026-10-09): every install of a package Conch doesn't know well,
 * or this very kind of step ("push code to a remote"), never every command. What asks whatever
 * was read (severe and lasting) can't be lifted this way.
 */
export function riskClass(risk: Risk): string {
  return risk.kind === 'install' ? `risk:install:${risk.harm}` : `risk:${risk.kind}:${risk.reason}`;
}

/** Whether this risk stops Auto, given what the chat read. */
export function riskAsks(risk: Risk | undefined, untrusted: boolean): boolean {
  return Boolean(risk) && riskScore(risk as Risk, untrusted) >= 3;
}

// ── Commands ──────────────────────────────────────────────────────────────

/** A shell's own wrappers, unwrapped so the command inside is what's read. */
const PREFIX =
  /^(?:(?:sudo|doas|nohup|time|command|exec|builtin|nice|ionice|stdbuf|caffeinate)(?:\s+-[\w-]+)*\s+|env(?:\s+-[\w-]+)*\s+|[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/i;

/**
 * Wrappers whose options take a value (`timeout 60`, `nice -n 10`, `env -u FOO`, `sudo -u root`),
 * and the shell's own words before a command (`then`, `do`, `!`, an unquoted `eval`): what
 * follows is the command that runs.
 */
const WRAPPERS: (RegExp | ((text: string) => string))[] = [
  /^(?:if|then|else|elif|do|while|until|!)\s+/,
  stripTimeout,
  /^nice(?:\s+-n\s*[+-]?\d+|\s+--adjustment=[+-]?\d+|\s+-[+-]?\d+)+\s+/i,
  /^ionice(?:\s+-[cnpP]\s*\S+|\s+-t)+\s+/i,
  /^stdbuf(?:\s+-[ioe]\s*\S+|\s+--(?:input|output|error)=\S+)+\s+/i,
  /^env(?:\s+-[uCS]\s*\S+|\s+--(?:unset|chdir)=\S+|\s+-[\w-]+)+\s+/i,
  /^(?:sudo|doas)(?:\s+-[ugCDpRrTt]\s*\S+|\s+--(?:user|group)=\S+|\s+-[\w-]+)+\s+/i,
  /^eval\s+(?=[^\s"'])/,
];

const TIMEOUT_VALUED = /^-[sk]/i;
const TIMEOUT_LONG = /^--(?:signal|kill-after)=/i;
const TIMEOUT_FLAG = /^-[\w-]+$/;
const TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/i;

/**
 * `timeout`'s own words off the front (`timeout -k 5 -s KILL 60 cargo test`
 * runs `cargo test`): what
 * `/^timeout(?:\s+-(?:s|k)\s*\S+|\s+--(?:signal|kill-after)=\S+|\s+-[\w-]+)*\s+\d+(?:\.\d+)?[smhd]?\s+/i`
 * took off, read word by word instead. That expression could read `-k-` two
 * ways, so a long run of them without a duration took exponential time (CodeQL
 * js/redos); here each word is decided once, from the last back, with the
 * expression's own preference (an option's value first, then a bare flag).
 */
export function stripTimeout(text: string): string {
  if (text.slice(0, 7).toLowerCase() !== 'timeout') return text;
  // The words after `timeout`, by where they start and end; the first needs a space before it.
  const words: { start: number; end: number }[] = [];
  let at = 7;
  for (;;) {
    let start = at;
    while (start < text.length && isSpaceChar(text.charAt(start))) start++;
    if (start === at || start === text.length) break;
    let end = start;
    while (end < text.length && !isSpaceChar(text.charAt(end))) end++;
    words.push({ start, end });
    at = end;
  }
  // rest[i]: where the command starts if reading options from word i on succeeds, else -1.
  const rest = new Array<number>(words.length + 1).fill(-1);
  for (let i = words.length - 1; i >= 0; i--) {
    const { start, end } = words[i] as { start: number; end: number };
    const word = text.slice(start, end);
    if (TIMEOUT_VALUED.test(word)) {
      // `-s KILL`, `-k 5`: the value is the next word; `-sKILL` carries its own.
      const valued = word.length === 2 ? (rest[i + 2] ?? -1) : (rest[i + 1] ?? -1);
      rest[i] = valued >= 0 || !TIMEOUT_FLAG.test(word) ? valued : (rest[i + 1] ?? -1);
    } else if (
      (TIMEOUT_LONG.test(word) && word.length > word.indexOf('=') + 1) ||
      TIMEOUT_FLAG.test(word)
    ) {
      rest[i] = rest[i + 1] ?? -1;
    } else if (TIMEOUT_DURATION.test(word) && end < text.length) {
      let next = end;
      while (next < text.length && isSpaceChar(text.charAt(next))) next++;
      rest[i] = next;
    }
  }
  const from = rest[0] ?? -1;
  return from >= 0 ? text.slice(from) : text;
}

/** One piece of a command line with every wrapper taken off. */
function unwrap(piece: string): string {
  let text = piece;
  for (let i = 0; i < 20; i++) {
    const before = text;
    for (const wrapper of WRAPPERS)
      text = typeof wrapper === 'function' ? wrapper(text) : text.replace(wrapper, '');
    text = text.replace(PREFIX, '');
    if (text === before) break;
  }
  return text;
}

/** Programs that run what a here-document gives them: its body is commands, not words. */
const RUNS_INPUT =
  /^(?:(?:ba|z|da|k|fi)?sh|python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php|pwsh|powershell|osascript|ssh|eval|source|\.|xargs|sudo|doas|su)$/i;

/**
 * A command line with its here-documents taken out (`git commit -F - <<'EOF'` … `EOF`), and
 * what in them runs: the whole body handed to a shell or an interpreter (`bash <<EOF`), or only
 * the `$(…)` and backticks a shell fills in when the end word isn't quoted. A commit message
 * is words: an apostrophe in it ("Nacre's") mustn't swallow the push on the next line.
 */
export function withoutHeredocs(command: string): { text: string; runs: string[] } {
  if (!command.includes('<<')) return { text: command, runs: [] };
  const lines = command.split('\n');
  const kept: string[] = [];
  const runs: string[] = [];
  const pending: { end: string; strip: boolean; quoted: boolean; runs: boolean }[] = [];
  let body: string[] = [];
  for (const line of lines) {
    const open = pending[0];
    if (open) {
      if ((open.strip ? line.replace(/^\t+/, '') : line) === open.end) {
        if (open.runs) runs.push(body.join('\n'));
        else if (!open.quoted)
          for (const inner of body
            .join('\n')
            .matchAll(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|`([^`]*)`/g))
            runs.push(inner[1] ?? inner[2] ?? '');
        body = [];
        pending.shift();
      } else body.push(line);
      continue;
    }
    kept.push(line);
    for (const m of line.matchAll(/(?<!<)<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/g)) {
      const before =
        line
          .slice(0, m.index)
          .split(/\|\||&&|[;|&(]/)
          .pop() ?? '';
      const prog = (wordsOf(unwrap(before.trim()))[0] ?? '').replace(/^.*[\\/]/, '');
      pending.push({
        end: m[3] ?? '',
        strip: m[1] === '-',
        quoted: Boolean(m[2]),
        runs: RUNS_INPUT.test(prog),
      });
    }
  }
  // Never closed: the shell reads to the end, so the rest is the body, read as it would run.
  if (pending[0]) runs.push(body.join('\n'));
  return { text: kept.join('\n'), runs };
}

/**
 * A line with what's inside quotes blanked out, the quotes kept: single quotes (the shell fills
 * in nothing there), and double quotes too when `double`. A backslash outside quotes escapes.
 */
function blankQuoted(text: string, double: boolean): string {
  let out = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quote) {
      if (c === quote) {
        quote = undefined;
        out += c;
      } else if (quote === '"' && c === '\\' && i + 1 < text.length) {
        out += double ? '  ' : c + (text[i + 1] ?? '');
        i++;
      } else out += quote === "'" || double ? (c === '\n' ? c : ' ') : c;
    } else {
      if (c === '"' || c === "'") quote = c;
      else if (c === '\\' && i + 1 < text.length) {
        out += c + (text[i + 1] ?? '');
        i++;
        continue;
      }
      out += c;
    }
  }
  return out;
}

/** The command line and every script inside it: `bash -c '…'`, `eval '…'`, `$(…)`, backticks. */
function scriptsOf(command: string): string[] {
  const scripts: string[] = [];
  const queue = [command];
  while (queue.length && scripts.length < 50) {
    const { text, runs } = withoutHeredocs(queue.shift() ?? '');
    queue.push(...runs);
    scripts.push(text);
    // Nothing in single quotes is filled in: `git commit -m 'why \`rm -rf ~\` is blocked'` is words.
    const filled = blankQuoted(text, false);
    for (const inner of filled.matchAll(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|`([^`]*)`/g))
      queue.push(inner[1] ?? inner[2] ?? '');
    for (const inner of text.matchAll(
      /\b(?:ba|z|da|k|fi)?sh(?:\s+-[\w-]+)*?\s+-\w*c\w*\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g,
    ))
      queue.push(inner[1] ?? inner[2] ?? '');
    for (const inner of text.matchAll(/\beval\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g))
      queue.push(inner[1] ?? inner[2] ?? '');
  }
  return scripts;
}

/**
 * A command line cut where the shell would cut it (`||`, `&&`, `;`, a new line, `|`, a lone
 * `&`), never inside quotes: `curl 'https://shop.example/?a=1&b=2' | sh` is a download piped
 * to a shell, not three commands.
 */
export function splitLine(text: string): string[] {
  const pieces: string[] = [];
  let piece = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"') {
        piece += c + next;
        i++;
        continue;
      }
      piece += c;
      continue;
    }
    if (c === '\\') {
      piece += c + next;
      i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    const prev = text[i - 1] ?? '';
    const cut =
      (c === '|' && next === '|') || (c === '&' && next === '&')
        ? 2
        : c === ';' || c === '\n' || (c === '|' && next !== '&')
          ? 1
          : c === '&' && !/[>&\d]/.test(prev) && !/[>&]/.test(next)
            ? 1
            : 0;
    if (cut) {
      pieces.push(piece);
      piece = '';
      i += cut - 1;
      continue;
    }
    piece += c;
  }
  pieces.push(piece);
  return pieces;
}

/** Words echoed into `xargs`: `echo ~ | xargs rm -rf` is `rm -rf ~`. */
const ECHOED_INTO = /\b(?:echo|printf)\s+([^|;&\n]*?)\s*\|\s*xargs(?:\s+-[\w-]+)*\s+([^|;&\n]+)/g;

/** The pieces a command line runs, wrappers (`sudo`, `env A=1`, `nohup`) taken off. */
export function commandParts(command: string): string[] {
  return scriptsOf(command).flatMap((text) => [
    ...splitLine(text)
      .map((piece) =>
        unwrap(
          piece
            .trim()
            .replace(/^[({]\s*/, '')
            .replace(/\s*[)}]+$/, ''),
        ),
      )
      .filter(Boolean),
    ...[...text.matchAll(ECHOED_INTO)].map((m) => unwrap(`${m[2] ?? ''} ${m[1] ?? ''}`.trim())),
  ]);
}

/** Words of one part, as the shell would split them: quotes joined to what's beside them. */
export function wordsOf(part: string): string[] {
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

/** The program a part runs, as a Mac's disk finds it: `RM` runs `rm`. */
const program = (part: string) => (wordsOf(part)[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase();

/** Branch names a team protects, or that publish when pushed. */
const PROTECTED_BRANCH =
  /^(?:main|master|trunk|develop|dev|default|stable|production|prod|live|release(?:[/-].*)?|gh-pages|HEAD)$/i;

/** Production named on the command line. */
const PROD = /(?:^|[\s=/:_.${-])(?:prod|production|prd|live)(?:$|[\s/:_.}-])|--prod\b/i;

/** Hosts whose whole purpose is catching what's sent to them. */
const DROP_BOXES =
  /\b(?:webhook\.site|requestbin\.\w+|pipedream\.net|[\w-]+\.ngrok(?:-free)?\.(?:io|app|dev)|ngrok\.io|pastebin\.com|paste\.ee|hastebin\.com|transfer\.sh|0x0\.st|file\.io|termbin\.com|ix\.io|discord(?:app)?\.com\/api\/webhooks|interact\.sh|oast\.(?:fun|pro|live|site|online|me)|burpcollaborator\.net|canarytokens\.(?:com|org)|requestcatcher\.com|beeceptor\.com|hookbin\.com|webhook\.cool|postb\.in)\b/i;

/**
 * The rest of one command up to its pipe, quotes kept whole: an address in quotes may carry
 * `&` and `;` (`curl 'https://shop.example/?a=1&b=2' | sh`) without ending the command.
 */
const UNQUOTED_RUN = `(?:'[^']*'|"(?:[^"\\\\]|\\\\.)*"|[^|;&\\n'"])*`;

const DOWNLOADER = /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|fetch|aria2c)\b/i;
/** The file a download is saved to: curl's `-o`, wget's `-O`, or wget's own name for it. */
function savedDownload(piece: string): string | undefined {
  const words = wordsOf(piece.trim());
  const prog = (words[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase();
  if (prog !== 'curl' && prog !== 'wget') return undefined;
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? '';
    const flag = prog === 'curl' ? /^-\w*o$|^--output$/ : /^-\w*O$|^--output-document$/;
    if (flag.test(w)) return words[i + 1];
    const joined = (
      prog === 'curl' ? /^(?:-\w*o|--output=)(.+)$/ : /^(?:-O|--output-document=)(.+)$/
    ).exec(w);
    if (joined?.[1] && joined[1] !== '-') return joined[1];
  }
  // wget, and curl's `-O`, keep the address's own file name.
  const remoteName =
    prog === 'wget' || words.some((w) => /^-[a-zA-Z]*O[a-zA-Z]*$|^--remote-name$/.test(w));
  const url = remoteName ? words.find((w) => /^https?:\/\//i.test(w)) : undefined;
  return (
    url
      ?.replace(/[?#].*$/, '')
      .split('/')
      .pop() || undefined
  );
}

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

const severe = (kind: RiskKind, reason: string, lasting = true, wish?: Wish): Risk => ({
  kind,
  harm: 'severe',
  lasting,
  reason,
  ...(wish && { wish }),
});
const moderate = (kind: RiskKind, reason: string, lasting = true, wish?: Wish): Risk => ({
  kind,
  harm: 'moderate',
  lasting,
  reason,
  ...(wish && { wish }),
});
/** The words to ask with, and what the message must name. */
const wish = (verbs: RegExp, ...names: (string | RegExp | undefined)[]): Wish => ({
  verbs,
  names: names.filter((n): n is string | RegExp => Boolean(n)),
});
/** Production, as a person names it, in their language too (ADR 0145). */
const PROD_WORDS =
  /\b(?:prod|production|live|produktion|produktiv\w*|produccion|producao|produzione|productie)\b/;
/** The host an address names, for the person to name too. */
function hostOf(word: string): string | undefined {
  const m = /^(?:https?:\/\/|git@|ssh:\/\/|[\w.-]+@)?([\w.-]+\.[a-z]{2,})(?=[/:\s]|$)/i.exec(
    word.replace(/^["']|["']$/g, ''),
  );
  return m?.[1]?.toLowerCase();
}

interface Places {
  workspace: string;
  home: string;
  scratch: string[];
  /** The person's own words (`RiskContext.said`). */
  said?: readonly string[];
  treeClean?: RiskContext['treeClean'];
  sameRemote?: RiskContext['sameRemote'];
  currentBranch?: RiskContext['currentBranch'];
  secretNames?: readonly string[];
  /** How deep in a package script this part is: one level is read, no more. */
  depth?: number;
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
  // The person names what goes ("delete ~/Documents/old-notes.txt", "remove the old notes").
  const named = targets
    .map((t) => placeOf(t, places))
    .filter((p): p is string => Boolean(p))
    .map((p) => p.split(/[\\/]/).filter(Boolean).pop() ?? '')
    .filter(Boolean);
  const asks = wish(WISHES.wipe as RegExp, named[0]);
  if (outside && recursive)
    return severe('wipe', 'delete files outside the work folder for good', true, asks);
  if (outside)
    return moderate('wipe', 'delete a file outside the work folder for good', true, asks);
  return undefined;
}

/** Deleting inside folders, as `find -delete` or `rsync --delete` does: a whole one, or outside the work folder. */
function deletesIn(folders: string[], places: Places): Risk | undefined {
  if (folders.some((f) => criticalTarget(f, places, false))) return WHOLE;
  const elsewhere = folders.filter((f) => {
    const path = placeOf(f, places);
    return !path || !inside(places.workspace, path);
  });
  return elsewhere.length ? rmRisk(['rm', '-r', ...elsewhere], places) : undefined;
}

/** Branches a push publishes or deploys from: pushed as asked only when the person names them. */
const DEPLOY_BRANCH = /^(?:stable|production|prod|live|release(?:[/-].*)?|gh-pages)$/i;

/** "Push it", "pousse sur main", "sube los cambios", "pushen" (ADR 0145). */
const PUSH_WORDS = stems(
  'push(?:es|ed|ing|en|e|t|st)?\\b',
  // A pull request needs the branch on the remote: asking for one asks for the push (2026-10-27).
  '(?:open|create|raise|make|submit|send|put\\s+up|file)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:new\\s+|draft\\s+)?(?:pr|pull\\s+request|mr|merge\\s+request)\\b',
  'ship(?:\\s+it)?\\b|release\\s+it\\b',
  ABROAD.push,
);
/** Merging a pull request is asked by "merge it", or by "push to main" when main takes PRs. */
const MERGE_WORDS = new RegExp(
  `${stems('merg', ABROAD.merge).source}|${PUSH_WORDS.source}[^.!?\\n]{0,30}\\b(?:main|master|trunk)\\b`,
);
/** Throwing away uncommitted changes, as a person says it. */
const DISCARD_WORDS = stems(
  'reset|discard|throw\\s+away|revert|undo|start\\s+(?:over|fresh|again)|scrap|clean|wipe|drop',
  ABROAD.discard,
  ABROAD.clean,
);

/** `git …`: force pushes, deleted branches, thrown-away work. */
function gitRisk(words: string[], places: Places): Risk | undefined {
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
    // A plain push to the repository's own remote (`origin`, or the one the branch tracks),
    // asked for in the person's own words (ADR 0117, ADR 0128): the outcome they asked for,
    // not a way out. A remote named or written out, a config override, or another program
    // to receive it is still a way out, whatever they said; a publishing branch, a
    // force-push or a deleted branch is theirs to name.
    const own =
      !words.slice(1, i).includes('-c') &&
      !words.slice(1, i).some((w) => w.startsWith('--config-env')) &&
      !flags.some((f) => /^--(?:repo|receive-pack|exec)(?:=|$)/.test(f)) &&
      (args[0] === undefined || args[0] === 'origin');
    if (flags.includes('--mirror'))
      return severe(
        'history',
        'mirror-push, replacing everything on the remote',
        true,
        own ? wish(stems('mirror', ABROAD.mirror)) : NEVER,
      );
    const refs = args.slice(1).map((a) =>
      a
        .replace(/^\+|^:/, '')
        .split(':')
        .pop()
        ?.replace(/^refs\/heads\//, ''),
    );
    const given = refs.filter((r): r is string => Boolean(r));
    // No branch named: it pushes the one checked out, when that's known (2026-10-27).
    const at = words.indexOf('-C');
    const here = places.currentBranch?.(at > 0 && at < i ? words[at + 1] : undefined);
    const named =
      deleting || given.length || (args[0] !== undefined && args[0] !== 'origin') || !here
        ? given
        : [here];
    const shared = !named.length || named.some((r) => PROTECTED_BRANCH.test(r));
    // "my branch", "this branch" names the one checked out, when others don't share it.
    const mine = (branch: string | undefined) =>
      branch && branch === here && !PROTECTED_BRANCH.test(branch)
        ? new RegExp(
            `\\b${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|\\b(?:my|this|the|current|our|that)\\s+(?:own\\s+)?(?:feature\\s+|working\\s+|local\\s+)?branch\\b`,
          )
        : branch;
    if (deleting) {
      const asks = own
        ? wish(stems('delet|remov|drop|prune|clean', ABROAD.delete), mine(named[0]))
        : NEVER;
      return shared
        ? severe('history', `delete the ${named[0] ?? 'remote'} branch others rely on`, true, asks)
        : moderate('history', `delete the ${named[0] ?? 'remote'} branch`, true, asks);
    }
    if (force || plus) {
      const asks = own
        ? wish(
            stems(
              'force[- ]?push|push\\w*\\s+(?:--force|-f)\\b|overwrit|rewrit',
              ABROAD.forcePush,
              ABROAD.overwrite,
            ),
            mine(named[0]),
          )
        : NEVER;
      return shared
        ? severe(
            'history',
            named[0]
              ? `force-push over ${named[0]}, which rewrites history others share`
              : 'force-push, which rewrites history others may share',
            true,
            asks,
          )
        : moderate('history', `force-push over ${named[0] ?? 'a branch'}`, true, asks);
    }
    return moderate(
      'egress',
      'push code to a remote',
      true,
      own ? wish(PUSH_WORDS, ...named.filter((r) => DEPLOY_BRANCH.test(r))) : NEVER,
    );
  }
  // Where pushes go: a new or repointed remote is a new way out, before reading too, unless
  // the person named it (Claude Code asks the same way).
  if (sub === 'remote' && /^(?:add|set-url|rename)$/.test(args[0] ?? '')) {
    // A plain replacement with exactly the destination we just read adds no new reach.
    // Overrides, extra URLs and push-only changes still use the ordinary risk policy.
    const prefix = words.slice(1, i);
    const dir = prefix.length === 2 && prefix[0] === '-C' ? prefix[1] : undefined;
    if (
      args[0] === 'set-url' &&
      rest.length === 3 &&
      flags.length === 0 &&
      (prefix.length === 0 || (prefix.length === 2 && prefix[0] === '-C')) &&
      places.sameRemote?.(dir, args[1] ?? '', args[2] ?? '')
    )
      return undefined;
    const target = args.slice(1).map(hostOf).find(Boolean) ?? args[1];
    return severe(
      'egress',
      'change where pushes go',
      true,
      wish(/\b(?:remote|point|set[- ]?url|origin|upstream|mirror|fork)\w*/, target),
    );
  }
  // Throwing away changes that aren't committed: nothing to lose in a clean tree (ADR 0128),
  // and Undo keeps the work folder's files, so it isn't lasting.
  const dir = (() => {
    const at = words.indexOf('-C');
    return at > 0 && at < i ? words[at + 1] : undefined;
  })();
  const discards = (reason: string) =>
    places.treeClean?.(dir) === true
      ? undefined
      : severe('history', reason, false, wish(DISCARD_WORDS));
  if (sub === 'reset' && flags.includes('--hard'))
    return discards('throw away changes that aren’t committed');
  if (sub === 'clean' && flags.some((f) => /^-\w*f/.test(f)) && flags.some((f) => /[dxX]/.test(f)))
    return discards('delete every file git doesn’t track');
  if ((sub === 'checkout' || sub === 'restore') && rest.some((w) => w === '.' || w === ':/'))
    return discards('throw away changes that aren’t committed');
  if (sub === 'stash' && /^(?:drop|clear)$/.test(args[0] ?? ''))
    return moderate(
      'history',
      'throw away stashed changes',
      true,
      wish(stems('stash|drop|clear|discard', ABROAD.discard, ABROAD.delete)),
    );
  if (sub === 'filter-branch' || sub === 'filter-repo')
    return severe(
      'history',
      'rewrite the whole history of the repository',
      false,
      wish(
        stems(
          'rewrit|purg|scrub|filter|remov\\w*\\s[^.!?\\n]{0,30}\\bhistory\\b',
          ABROAD.overwrite,
        ),
      ),
    );
  if (sub === 'config' && rest.some((w) => /^core\.hooksPath$|^http\.sslVerify$/i.test(w)))
    return moderate(
      'safety-off',
      'change how git runs hooks or checks certificates',
      false,
      wish(stems('hook|ssl\\b|verif|certificate', 'zertifikat|certificat|certificad|certificaat')),
    );
  return undefined;
}

/** Cloud, clusters, infrastructure as code, deploys and databases. */
/** Words that ask for a deploy or a change to infrastructure; production must be named too. */
const DEPLOY_WORDS = stems(
  "deploy|ship|release|roll\\s*out|go\\s+live|(?:is|are|it'?s|goes|be|being|going)\\s+live|make\\s+sure\\b[^.!?\\n]{0,40}\\blive|put\\s+(?:it\\s+)?(?:up|live|online)|apply|launch|publish|provision|update|upgrade|scale|promote|push\\s+(?:it\\s+)?(?:up|out|to)",
  ABROAD.deploy,
  ABROAD.publish,
  ABROAD.update,
  // "Pousse-le en prod", "súbelo a producción", "push es nach prod".
  `(?:${ABROAD.push}|push\\w*)\\s+(?:\\w+\\s+)?(?:nach|in|auf|en|sur|a|al|em|para|su|naar|op)\\s+(?:${PROD_WORDS.source})`,
);
const DESTROY_WORDS = stems(
  'destroy|tear\\s+down|delete|remove|take\\s+down|decommission|drain|uninstall|roll\\s*back|terminate|purge|nuke|clean\\s*up|wipe|drop|reset|truncate|clear|recreate|start\\s+fresh',
  ABROAD.destroy,
  ABROAD.delete,
  ABROAD.clean,
  ABROAD.discard,
);
const GRANT_WORDS = stems(
  'grant|give|allow|add|share|invite|permission|access|role|policy|binding|iam|collaborator|protect|public|open[- ]source',
  ABROAD.grant,
  ABROAD.public,
  'partag|compart|compartilh|partilh|condivid|sch(?:u|ue)tz|proteg|bescherm', // sharing, protecting
);

/** SQL that deletes for good: a dropped table, everything truncated, a DELETE with no WHERE. */
const DESTRUCTIVE_SQL =
  /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE|COLLECTION)|TRUNCATE\b|FLUSHALL|FLUSHDB|dropDatabase\s*\(|DELETE\s+FROM\s+[\w."`]+\s*(?:;|"|'|$))/i;
/** Words that ask to change data or settings somewhere. */
const INFRA_CHANGE = stems(
  'updat|chang|insert|add|creat|alter|fix|set|apply|migrat|run\\b|execut',
  ABROAD.update,
  ABROAD.change,
  ABROAD.migrate,
  ABROAD.run,
);

/**
 * Cloud, clusters, infrastructure as code, deploys and databases: someone else's systems, so
 * a change asks before reading too, unless the person named it (ADR 0128); production must be
 * named as such. Claude Code blocks the same by default and clears them by name.
 */
function infraRisk(part: string, prog: string, words: string[]): Risk | undefined {
  // The words that say what to do, not the names of things or flags' values: `pod/delete-worker`,
  // `s3://my-delete-bucket`, `-out=apply.plan`, `--bucket my-delete-bucket` and `data-set` aren't verbs.
  const verbs = ` ${words
    .slice(1)
    .filter((w, i, all) => !/^-|[=:/@]/.test(w) && !/^--[\w-]+$/.test(all[i - 1] ?? ''))
    .join(' ')} `;
  const says = (alternatives: string) => new RegExp(`\\s(?:${alternatives})(?=\\s)`).test(verbs);
  const sub = words.slice(1).join(' ');
  const prod = PROD.test(part);
  const deploy = wish(DEPLOY_WORDS, prod ? PROD_WORDS : undefined);
  const destroy = wish(DESTROY_WORDS, prod ? PROD_WORDS : undefined);
  if (/^(?:terraform|tofu|terragrunt|pulumi|cdk|cdktf|sst|serverless|sls)$/.test(prog)) {
    if (says('destroy') || (says('apply') && /\s-destroy\b/.test(sub)) || says('stack rm'))
      return severe('infra', 'tear down cloud infrastructure', true, destroy);
    if (says('apply|up|deploy|import|state (?:rm|mv|push)'))
      return prod
        ? severe('infra', 'change production infrastructure', true, deploy)
        : severe('infra', 'change cloud infrastructure', true, deploy);
  }
  if (/^(?:kubectl|oc)$/.test(prog)) {
    if (says('delete|drain|cordon'))
      return severe('infra', 'delete or drain things in a cluster', true, destroy);
    if (says('create (?:cluster)?rolebinding'))
      return severe('privilege', 'grant access in a cluster', true, wish(GRANT_WORDS));
    if (
      says(
        'apply|create|replace|patch|scale|rollout (?:restart|undo|pause|resume)|set|edit|annotate|label',
      )
    )
      return prod
        ? severe('infra', 'change a production cluster', true, deploy)
        : severe('infra', 'change a cluster', true, deploy);
  }
  if (prog === 'helm') {
    if (says('uninstall|delete|rollback'))
      return severe('infra', 'remove a release from a cluster', true, destroy);
    if (says('install|upgrade'))
      return prod
        ? severe('infra', 'change a production cluster', true, deploy)
        : severe(
            'infra',
            'change a cluster',
            true,
            wish(
              stems(
                'install|upgrad|deploy|release|updat|roll\\s*out',
                'installier|instal|installeer',
                ABROAD.deploy,
                ABROAD.update,
              ),
            ),
          );
  }
  if (/^(?:aws|gcloud|gsutil|az|doctl|linode-cli|hcloud|oci|ibmcloud|scw)$/.test(prog)) {
    if (
      /\b(?:iam\s+(?:attach|put|create-access-key|create-login-profile|add-user-to-group|update-assume-role)|add-iam-policy-binding|set-iam-policy|role\s+assignment\s+create|put-bucket-(?:policy|acl)|delete-public-access-block|put-public-access-block)/.test(
        verbs,
      )
    )
      return severe('privilege', 'grant access to cloud resources', true, wish(GRANT_WORDS));
    if (
      /\b(?:secretsmanager\s+(?:put|create|update)|kms\s+(?:schedule-key-deletion|disable)|route53\s+change|dns\s+record-sets|acm\s+delete)/.test(
        verbs,
      )
    )
      return severe(
        'infra',
        'change secrets, DNS or certificates in the cloud',
        true,
        wish(stems('secret|dns\\b|record|certificate|cert\\b|domain|key', ABROAD.secret)),
      );
    if (
      /\s(?:delete|terminate|remove|deregister|purge|destroy|rb)(?:[-\s]|$)|[a-z]-(?:delete|terminate|remove|deregister|purge)(?:[-\s]|$)|\sdelete-\w|\sterminate-\w/.test(
        verbs,
      ) ||
      /\brm\b.*(?:-r|--recursive)|\b(?:rm|rb)\s+(?:-\w+\s+)*gs:\/\//.test(sub)
    )
      return severe('infra', 'delete cloud resources', true, destroy);
    if (says('deploy|update-function-code|update-service|create-deployment'))
      return prod
        ? severe('infra', 'deploy to production', true, deploy)
        : severe('infra', 'deploy to the cloud', true, deploy);
  }
  if (
    /^(?:vercel|netlify|fly|flyctl|firebase|heroku|wrangler|railway|render|eb|amplify|surge)$/.test(
      prog,
    )
  ) {
    if (/\b(?:destroy|remove|rm|delete|apps:destroy|pg:reset|\w+:delete)\b/.test(sub))
      return severe('infra', 'delete a deployed app or its data', true, destroy);
    // A hosted database's own SQL (`wrangler d1 execute --remote`), read as a database's (2026-10-27).
    if (/\b(?:d1\s+execute|db\s+(?:query|execute))\b/.test(sub) && !/--local\b/.test(sub)) {
      if (DESTRUCTIVE_SQL.test(part))
        return severe('infra', 'delete data in a hosted database', true, destroy);
      if (/\b(?:UPDATE|INSERT|ALTER|CREATE|REPLACE)\b/i.test(part))
        return moderate('infra', 'change data in a hosted database', true, wish(INFRA_CHANGE));
      return undefined;
    }
    if (/\bsecret\s+(?:put|delete|bulk)\b|\benv\s+(?:add|rm|remove)\b/.test(sub))
      return severe(
        'infra',
        'change the secrets a deployed app runs with',
        true,
        wish(stems('secret|key|token|env|variable', ABROAD.secret)),
      );
    // Reading what's there (`fly logs -a api-prod`) changes nothing, production or not.
    const reads =
      /^\s(?:logs?|status|info|list|ls|apps|whoami|version|help|open|ps|releases|domains|inspect|describe|show|get|history|dashboard|monitor|tail|env|config)\s/.test(
        verbs,
      );
    if (
      /\b(?:deploy|publish|up|release|promote)\b/.test(sub) ||
      (prod && !reads) ||
      (words.length === 1 && /^(?:vercel|surge)$/.test(prog))
    )
      return prod
        ? severe('infra', 'deploy to production', true, deploy)
        : severe('infra', 'deploy where people can reach it', true, deploy);
  }
  if (prog === 'gh') {
    // A workflow run is someone else's machine doing whatever it says; a deploy, production.
    if (/\bworkflow\s+run\b/.test(sub) || /\bapi\b.*\/dispatches\b/.test(sub)) {
      const ships = /\b(?:deploy\w*|release\w*|publish\w*|prod\w*|live)\b/i.test(sub);
      return ships
        ? severe(
            'infra',
            'start a workflow that deploys or releases',
            true,
            wish(DEPLOY_WORDS, prod ? PROD_WORDS : undefined),
          )
        : moderate(
            'infra',
            'start a workflow on GitHub',
            true,
            wish(
              stems(
                'run|trigger|start|dispatch|kick\\s+off|rerun|re-run|workflow|action',
                ABROAD.run,
              ),
            ),
          );
    }
    if (
      /\b(?:repo\s+delete|release\s+delete|secret\s+(?:set|delete)|variable\s+set)\b/.test(sub) ||
      /\bapi\b.*(?:\s(?:-X|--method)\s*=?\s*DELETE\b)/i.test(` ${sub}`)
    )
      return severe(
        'infra',
        'delete a repository or change its secrets',
        true,
        wish(stems('delet|remov|secret|variable', ABROAD.delete, ABROAD.secret)),
      );
    if (
      /\brepo\s+(?:edit\b.*--visibility\s*=?\s*public|create\b.*--public)|gist\s+create\b.*--public/.test(
        sub,
      )
    )
      return severe(
        'publish',
        'make a repository or gist public',
        true,
        wish(stems('public|open[- ]sourc', ABROAD.public)),
      );
    if (
      /\bpr\s+merge\b.*--admin|\bapi\b.*(?:collaborators|branches\/[^/\s]+\/protection)/.test(sub)
    )
      return severe(
        'privilege',
        'change who can push or what protects a branch',
        true,
        wish(GRANT_WORDS),
      );
    // A comment or a review in the person's name where others read it (2026-10-27). A new issue
    // or pull request of the repository's own stays routine, as its corpus says.
    const field = /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\b/.test(` ${sub}`);
    const method = /(?:^|\s)(?:-X|--method)\s*=?\s*(POST|PUT|PATCH|GET)\b/i.exec(` ${sub}`)?.[1];
    const writes =
      /\b(?:issue|pr)\s+(?:comment|review)\b/.test(sub) ||
      (/\bapi\b/.test(sub) &&
        (method ? method.toUpperCase() !== 'GET' : field) &&
        (!/\bgraphql\b/.test(sub) || /\bmutation\b/i.test(sub)));
    if (writes) {
      if (/\$\(|`/.test(part))
        return moderate(
          'egress',
          'post what a command printed where people can read it',
          true,
          NEVER,
        );
      if (carriesSecrets({ text: part }))
        return severe('exfiltration', 'post a key where people can read it', true, NEVER);
      return moderate(
        'egress',
        'write on GitHub where other people read it',
        true,
        wish(
          new RegExp(
            `${SPEAK_WORDS.source}|${stems('review|approv|request\\s+changes|(?:open|file|create|raise|report)\\s+(?:an?\\s+|the\\s+)?(?:new\\s+)?(?:issue|bug)').source}`,
          ),
        ),
      );
    }
    if (/\brelease\s+create\b/.test(sub))
      return severe(
        'publish',
        'publish a release',
        true,
        wish(stems('release|publish|ship|tag', ABROAD.publish, 'rilasci')),
      );
    // This repository's own pull request, merged because the person said so (ADR 0117).
    if (/\bpr\s+merge\b/.test(sub))
      return moderate(
        'egress',
        'merge a pull request',
        true,
        /(?:^|\s)(?:-R|--repo)\b/.test(sub) ? NEVER : wish(MERGE_WORDS),
      );
  }
  if (
    /^(?:supabase|prisma|rails|rake|alembic|knex|sequelize|flyway|liquibase|dbmate|drizzle-kit)$/.test(
      prog,
    )
  ) {
    if (
      /\b(?:db\s+reset|migrate\s+reset|db:drop|db:reset|db:schema:load|drop)\b/.test(sub) ||
      /--force-reset\b|--accept-data-loss\b/.test(sub) ||
      (prog === 'drizzle-kit' && /\bpush\b/.test(sub) && /--force\b/.test(sub))
    )
      return severe('infra', 'wipe a database', true, destroy);
    // `supabase db push` changes the project it's linked to, production or not (2026-10-27).
    if (
      prog === 'supabase' &&
      /\bdb\s+push\b/.test(sub) &&
      !prod &&
      !/--dry-run\b|--local\b/.test(sub)
    )
      return moderate(
        'infra',
        'change the database of the Supabase project this folder is linked to',
        true,
        wish(
          stems(
            'migrat|push|apply|deploy|sync|updat|chang',
            ABROAD.migrate,
            ABROAD.update,
            ABROAD.change,
            ABROAD.push,
          ),
        ),
      );
    if (/\b(?:migrate|db:migrate|upgrade|db\s+push)\b/.test(sub) && prod)
      return severe(
        'infra',
        'change a production database',
        true,
        wish(
          stems(
            'migrat|upgrad|updat|chang|push',
            ABROAD.migrate,
            ABROAD.update,
            ABROAD.change,
            ABROAD.push,
          ),
          PROD_WORDS,
        ),
      );
  }
  if (
    /^(?:psql|mysql|mariadb|sqlite3|mongosh|mongo|redis-cli|cqlsh|clickhouse-client)$/.test(prog) ||
    /^(?:dropdb|dropuser)$/.test(prog)
  ) {
    if (/^(?:dropdb|dropuser)$/.test(prog))
      return severe('infra', 'delete a database', true, destroy);
    if (DESTRUCTIVE_SQL.test(part))
      return severe('infra', 'delete data in a database', true, destroy);
    // Every row changed at once: `UPDATE users SET role='admin'` with no WHERE.
    if (/\bUPDATE\s+[\w."`]+\s+SET\b(?![^;]*\bWHERE\b)/i.test(part))
      return severe(
        'infra',
        'change every row of a table in a database',
        true,
        wish(
          stems('updat|chang|set\\s+(?:all|every)|reset|overwrit', ABROAD.update, ABROAD.change),
        ),
      );
    if (prod && /\b(?:UPDATE|DELETE|INSERT|ALTER|CREATE|GRANT)\b/i.test(part))
      return severe(
        'infra',
        'change a production database',
        true,
        wish(
          stems(
            'updat|delet|insert|alter|creat|grant|chang|migrat|run\\b',
            ABROAD.update,
            ABROAD.delete,
            ABROAD.change,
            ABROAD.migrate,
            ABROAD.run,
            'einf(?:u|ue)g|inser|erstell|cre(?:e|er|ez|a|ar|are)\\b|cri(?:a|ar|e)\\b', // inserting, creating
          ),
          PROD_WORDS,
        ),
      );
  }
  return undefined;
}

/**
 * Money moved with a payment provider's own CLI (2026-10-27): refunds, charges, payouts,
 * transfers, subscriptions. Stripe's CLI works on test data unless told `--live`, so only a
 * live call counts; it's asked for only by naming what it acts on (`ch_…`, `sub_…`).
 */
function moneyRisk(prog: string, words: string[]): Risk | undefined {
  if (prog !== 'stripe') return undefined;
  const line = words.slice(1).join(' ');
  const moves =
    /\b(?:refunds|charges|payouts|transfers|subscriptions|subscription_schedules|payment_intents|invoices|topups)\s+(?:create|cancel|update|delete|pay|capture|void|finalize|confirm)\b/.test(
      line,
    ) || /^(?:post|delete)\s+\/v1\//i.test(line);
  if (!moves || !/(?:^|\s)--live\b|\b[sr]k_live_/.test(line)) return undefined;
  const id = words
    .map(
      (w) =>
        /(?:^|=)((?:ch|re|py|po|tr|sub|sub_sched|pi|in|cus|si|tu)_[A-Za-z0-9]{6,})/.exec(w)?.[1],
    )
    .find(Boolean);
  return severe(
    'spend',
    'move real money with Stripe',
    true,
    id
      ? wish(
          stems('refund|charg|pay|cancel|transfer|captur|void|invoic|subscri|bill|finaliz|confirm'),
          id,
        )
      : NEVER,
  );
}

/** Variables that hold a key, by the names people give them. */
const KEY_VAR =
  /^(?:[A-Z0-9]+_)*(?:TOKEN|API_?KEY|SECRET(?:_KEY)?|PASSWORD|PASSWD|PAT|ACCESS_KEY(?:_ID)?|PRIVATE_KEY|AUTH)$/;
/** The services a key is normally sent to: its own API, registry or git host (2026-10-27). */
const KEY_HOMES =
  /(?:^|\.)(?:github\.com|githubusercontent\.com|ghcr\.io|gitlab\.com|bitbucket\.org|cloudflare\.com|stripe\.com|supabase\.co|supabase\.com|vercel\.com|netlify\.com|fly\.io|heroku\.com|amazonaws\.com|googleapis\.com|azure\.com|digitalocean\.com|openai\.com|anthropic\.com|npmjs\.org|npmjs\.com|pypi\.org|docker\.io|docker\.com|slack\.com|linear\.app|notion\.com|sentry\.io|twilio\.com|sendgrid\.com|resend\.com|hetzner\.cloud|render\.com|railway\.app|openrouter\.ai|huggingface\.co)$/;

/**
 * A saved key put in a command that reaches somewhere other than its own service (2026-10-27):
 * the way a page that steers the model would take a key it can't see. Moderate and lasting, so
 * it asks after reading, unless the person named that address themselves.
 */
function leaksKey(part: string, places: Places): Risk | undefined {
  const keys = [...part.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)]
    .map((m) => m[1] ?? '')
    .filter((v) => places.secretNames?.includes(v) || KEY_VAR.test(v));
  if (!keys.length) return undefined;
  const away = [...part.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s'"]*@)?([^/:\s?#'"@]+)/gi)]
    .map((m) => (m[1] ?? '').toLowerCase())
    .filter((host) => !LOOPBACK.test(host) && !KEY_HOMES.test(host));
  if (!away.length) return undefined;
  return moderate(
    'exfiltration',
    `send a saved key (${keys[0]}) to ${away[0]}, which isn’t that service’s own address`,
    true,
    wish(WISHES.egress as RegExp, away[0]),
  );
}

/** Packages and releases going out to everyone. */
function publishRisk(prog: string, words: string[]): Risk | undefined {
  const sub = words.slice(1).filter((w) => !w.startsWith('-'));
  if (words.includes('--dry-run')) return undefined;
  const takeDown = wish(
    stems(
      'unpublish|deprecat|take\\s+(?:it\\s+)?down|remov|yank|pull\\s+(?:it\\s+)?(?:from|off)',
      ABROAD.delete,
    ),
  );
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog)) {
    if (sub[0] === 'unpublish' || sub[0] === 'deprecate')
      return severe('publish', 'take a published package down for everyone', true, takeDown);
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
  // An image for others to pull: before reading too, unless the person said to (ADR 0128).
  if (/^(?:docker|podman)$/.test(prog) && sub[0] === 'push')
    return severe(
      'publish',
      'push an image to a registry',
      true,
      wish(
        stems(
          'push|publish|upload|release|deploy|ship',
          ABROAD.push,
          ABROAD.publish,
          ABROAD.deploy,
          'hochlad|televers|carica',
        ),
      ),
    );
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

/**
 * Flags that send an install somewhere other than the registry's own index (or past the
 * computer's own Python's guard): what a page would add to steer a well-known name elsewhere.
 */
const OTHER_SOURCE =
  /^--(?:index-url|extra-index-url|find-links|trusted-host|registry|index|git|source|break-system-packages)(?:=|$)/;
/** A package already on this computer: a folder, a file, a tarball or a wheel. */
const LOCAL_SPEC =
  /^(?!.*:\/\/)(?:\.{1,2}(?:[\\/].*)?|[~/].*|file:.*|[A-Za-z]:[\\/].*|.*\.(?:tgz|tar\.gz|tar|whl))$/;

/** The same, set in the environment for the install that runs next. */
const REGISTRY_SET =
  /\b(?:PIP_(?:EXTRA_)?INDEX_URL|PIP_FIND_LINKS|PIP_TRUSTED_HOST|UV_(?:EXTRA_)?INDEX_URL|UV_INDEX|UV_FIND_LINKS|npm_config_registry|YARN_REGISTRY|YARN_NPM_REGISTRY_SERVER|BUN_CONFIG_REGISTRY|GOPROXY|GONOSUMDB|GOFLAGS)=/i;
/** The same, in a registry's own short flags: pip's `-i`/`-f`, gem's `-s`. */
const otherSource = (registry: Registry | undefined, flag: string) =>
  OTHER_SOURCE.test(flag) ||
  (registry === 'pypi' && /^-[if]$/.test(flag)) ||
  (registry === 'gem' && flag === '-s');

/**
 * Installing something that runs its own code as it arrives (ADR 0117, 2026-10-09). A
 * well-known package from its own registry is routine work, before and after reading: Auto
 * installs `fonttools` for a PDF without a word. An unknown name asks after reading (a page
 * could have named it); a name one slip off a famous one (`reqeusts`) asks always; so does an
 * address, and another registry asks after reading.
 */
function installRisk(
  prog: string,
  words: string[],
  places: Places,
  steered = false,
): Risk | undefined {
  // Redirections (`2>&1`, `> log.txt`) are the shell's, not names of packages.
  const sub = words
    .slice(1)
    .filter(
      (w, i, all) => !/^\d*(?:[<>]|&>)/.test(w) && !/^\d*(?:>>?|<|&>)$/.test(all[i - 1] ?? ''),
    );
  // Names, not flags, a requirements file, or what's already on this computer (`../lib`, a .tgz).
  const named = (from: number) =>
    sub
      .slice(from)
      .filter(
        (w, i, all) =>
          !w.startsWith('-') &&
          !/^(?:-r|-c|-e|--requirement|--constraint|--editable)$/.test(all[i - 1] ?? '') &&
          !/^(?:requirements.*)$/.test(w) &&
          !LOCAL_SPEC.test(w),
      );
  // An address, or a version that is one: `x@github:a/b`, `x@https://…`, pip's `x @ https://…`,
  // and npm's `a/b` for a GitHub repository.
  const fromUrl = (list: string[]) =>
    list.some(
      (w) =>
        /^(?:git\+|https?:\/\/|github:|git@)|:\/\//.test(w) ||
        /@\s*(?:git\+|git:|https?:|github:|gitlab:|bitbucket:|gist:)/.test(w) ||
        (registry === 'npm' &&
          /^(?:@[^/@]+\/[^/@]+@|[^/@]+@)?[\w-][\w.-]*\/[\w.-]+$/.test(w) &&
          !/\.(?:tgz|tar|tar\.gz)$/.test(w)),
    );
  // The package npx or `npm exec` fetches to run (`--package=x`, `-p x`), else its first name.
  const fetched = (from: number) => {
    const flagged = sub.flatMap((w, i) =>
      /^--package=/.test(w)
        ? [w.slice('--package='.length)]
        : /^(?:-p|--package)$/.test(sub[i - 1] ?? '')
          ? [w]
          : [],
    );
    if (flagged.length) return flagged;
    return named(from)
      .slice(0, 1)
      .filter((p) => !localTool(p, places));
  };
  let pkgs: string[] = [];
  let registry: Registry | undefined;
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog) && /^(?:i|install|add)$/.test(sub[0] ?? '')) {
    pkgs = named(1);
    registry = 'npm';
  } else if (/^(?:npx|bunx)$/.test(prog)) {
    pkgs = fetched(0);
    registry = 'npm';
  } else if (prog === 'npm' && /^(?:exec|x)$/.test(sub[0] ?? '')) {
    pkgs = fetched(1);
    registry = 'npm';
  } else if (
    /^(?:npm|pnpm|yarn|bun)$/.test(prog) &&
    /^(?:create|init)$/.test(sub[0] ?? '') &&
    named(1)[0]
  ) {
    // `npm create vite` runs create-vite; `npm init @scope` runs @scope/create.
    const spec = named(1)[0] ?? '';
    const scoped = /^(@[^/@]+)(?:\/([^@]+))?/.exec(spec);
    pkgs = [
      scoped
        ? `${scoped[1]}/${scoped[2] ? `create-${scoped[2]}` : 'create'}`
        : `create-${packageName('npm', spec)}`,
    ];
    registry = 'npm';
  } else if (/^(?:pnpm|yarn|bun)$/.test(prog) && sub[0] === 'dlx') {
    pkgs = named(1).slice(0, 1);
    registry = 'npm';
  } else if (/^pip\d?(?:\.\d+)?$/.test(prog) && sub[0] === 'install') {
    if (sub.some((w) => /^-(?:r|e|c)$|^--(?:requirement|editable|constraint)/.test(w)))
      return undefined;
    pkgs = named(1);
    registry = 'pypi';
  } else if (prog === 'uv' && (sub[0] === 'add' || (sub[0] === 'pip' && sub[1] === 'install'))) {
    pkgs = named(sub[0] === 'add' ? 1 : 2);
    registry = 'pypi';
  } else if (/^(?:uvx|pipx)$/.test(prog)) {
    pkgs = named(prog === 'pipx' ? 1 : 0).slice(0, 1);
    registry = 'pypi';
  } else if (prog === 'cargo' && sub[0] === 'install') {
    pkgs = named(1);
    registry = 'cargo';
  } else if (prog === 'go' && (sub[0] === 'install' || sub[0] === 'get')) {
    pkgs = named(1);
    registry = 'go';
  } else if (
    (prog === 'gem' || prog === 'brew' || prog === 'composer') &&
    /^(?:install|require)$/.test(sub[0] ?? '')
  ) {
    pkgs = named(1);
    if (prog !== 'composer') registry = prog === 'gem' ? 'gem' : 'brew';
  } else if (prog === 'dotnet' && sub[0] === 'add' && sub.includes('package')) pkgs = named(2);
  if (!pkgs.length) return undefined;
  // `lodash@npm:evil-pkg` installs evil-pkg under lodash's name.
  if (registry === 'npm') pkgs = pkgs.map((p) => /@npm:(.+)$/.exec(p)?.[1] ?? p);
  const installs = WISHES.install as RegExp;
  // The person named the address themselves ("install it from github.com/x/y"): theirs to ask.
  if (fromUrl(pkgs))
    return severe(
      'remote-code',
      'install and run code straight from an address on the internet',
      true,
      wish(installs, pkgs.map(hostOf).find(Boolean) ?? pkgs[0]),
    );
  const elsewhere = steered || sub.some((w) => otherSource(registry, w));
  if (registry) {
    const at = registry;
    const names = pkgs.map((p) => packageName(at, p));
    for (const name of names) {
      const known = imitates(at, name);
      if (known)
        return severe(
          'install',
          `install ${name}, a name one slip away from the well-known ${known}, which a stranger could have registered to catch that slip`,
          true,
          NEVER,
        );
    }
    if (elsewhere) {
      const source = sub.map(hostOf).find(Boolean);
      return severe(
        'install',
        `install ${names.slice(0, 2).join(' and ')} from somewhere other than its usual registry`,
        false,
        wish(installs, names[0], source),
      );
    }
    // Well known, or what the project itself declares (ADR 0128): routine, as Claude Code
    // allows installs from the manifests.
    const unknown = names.filter(
      (name) => !wellKnown(at, name) && !declared(places.workspace, at, name),
    );
    if (!unknown.length) return undefined;
    return moderate(
      'install',
      `install ${unknown.slice(0, 2).join(' and ')}, which isn’t a package I know well, and it runs its own code`,
      true,
      wish(installs, unknown[0]),
    );
  }
  return moderate(
    'install',
    `install ${pkgs.slice(0, 2).join(' and ')}, which runs its own code`,
    true,
    wish(installs, pkgs[0]),
  );
}

/** Paths whose files run again by themselves later, or let someone in. */
const PERSISTENT =
  /(?:^|[\\/])(?:Library[\\/]Launch(?:Agents|Daemons)|\.config[\\/](?:autostart|systemd)|etc[\\/](?:cron[^\\/]*|systemd|init\.d|rc\.local|profile(?:\.d)?|launchd\.conf))(?:[\\/]|$)|(?:^|[\\/])\.(?:bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin|config[\\/]fish[\\/]config\.fish)$/i;
const ACCESS =
  /(?:^|[\\/])(?:\.ssh[\\/](?:authorized_keys2?|rc)|etc[\\/]sudoers(?:\.d)?)(?:[\\/]|$)/i;
/** Files that tell an agent what it may do: writing them raises its own powers. */
const AGENT_CONFIG =
  /(?:^|[\\/])(?:\.claude[\\/]settings(?:\.local)?\.json|\.mcp\.json|\.codex[\\/]config\.toml|\.gemini[\\/]settings\.json|\.cursor[\\/](?:mcp\.json|permissions\.json)|\.vscode[\\/]tasks\.json)$/i;
const HOOKS =
  /(?:^|[\\/])(?:\.git[\\/](?:hooks[\\/]|config$)|\.husky[\\/]|\.github[\\/]workflows[\\/])/i;

/**
 * The computer's own files: what it starts from, its programs and settings.
 * Not `/usr/local` or `/opt` (where installs put programs), `/var/folders`
 * or `/var/tmp` (scratch), or `/dev`.
 */
const SYSTEM =
  /^(?:\/(?:etc|bin|sbin|boot|lib|lib32|lib64|System|Library|private\/etc|usr\/(?!local(?:[\\/]|$))[^/]+|var\/(?!folders|tmp)[^/]+)(?:\/|$)|[A-Za-z]:[\\/](?:Windows|Program Files(?: \(x86\))?)(?:[\\/]|$))/i;

/** Writing to a path: what that means beyond the file itself. */
function writeRisk(path: string): Risk | undefined {
  if (ACCESS.test(path))
    return severe('privilege', 'let someone sign in to this computer', true, NEVER);
  if (SYSTEM.test(path)) return severe('privilege', 'change the computer’s own system files');
  // An assistant's own permissions, raised by a file it writes: a way to more power that no
  // words ask for, so it asks whatever was read (ADR 0128; Claude Code blocks the same).
  if (AGENT_CONFIG.test(path))
    return severe('privilege', 'change what an assistant is allowed to do', true, NEVER);
  if (PERSISTENT.test(path))
    return severe('persistence', 'set something to run by itself later', false);
  if (HOOKS.test(path))
    return moderate('persistence', 'change what runs when you commit, push or build');
  return undefined;
}

/** Files that hold keys, sign-ins or saved passwords, named on a command line. */
const SECRET_FILES =
  /(?:^|[\s"'=/\\])(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|\.netrc|\.git-credentials|\.pgpass|credentials\.db|application_default_credentials\.json|access_tokens\.db|Login Data|key4\.db|logins\.json)(?=$|[\s"';|&)])/i;

/**
 * Where keys and sign-ins live, as absolute paths. `sandbox.ts` lists the
 * folders the box can't read; this is narrower, so reading a public key, a
 * folder's settings or Claude Code's skills isn't taken for a secret.
 */
const SECRET_PATHS: RegExp[] = [
  /[\\/]\.ssh[\\/](?![^\\/]*\.pub$)(?!config$)(?!known_hosts)[^\\/]+$/i,
  /[\\/]\.aws[\\/](?:credentials|sso[\\/]cache)/i,
  /[\\/]\.config[\\/]gcloud[\\/](?:credentials\.db|access_tokens\.db|application_default_credentials\.json|legacy_credentials)/i,
  /[\\/]\.azure[\\/](?:accessTokens|msal_token_cache)/i,
  /[\\/]\.kube[\\/]config$/i,
  /[\\/]\.docker[\\/]config\.json$/i,
  /[\\/]\.netrc$|[\\/]\.git-credentials$|[\\/]\.pgpass$/i,
  /[\\/]\.config[\\/]gh[\\/]hosts\.yml$/i,
  /[\\/]\.gnupg(?:[\\/]|$)/i,
  /[\\/]\.password-store(?:[\\/]|$)/i,
  /[\\/]Library[\\/](?:Keychains|Cookies)(?:[\\/]|$)/i,
  /[\\/]\.claude[\\/]\.credentials\.json$|[\\/]\.codex[\\/]auth\.json$/i,
  /[\\/]Group Containers[\\/]2BUA8C4S2C\.com\.1password|Bitwarden CLI[\\/]data\.json/i,
  /[\\/](?:Login Data|Cookies|key4\.db|logins\.json)$/i,
];

/** Registries' keys, kept in home: a project's own `.npmrc` names a registry, not a key. */
const HOME_KEYS = [
  '.npmrc',
  '.pypirc',
  '.gem/credentials',
  '.cargo/credentials',
  '.cargo/credentials.toml',
];

const isSecret = (path: string, home?: string) =>
  SECRET_PATHS.some((re) => re.test(path)) ||
  (home !== undefined &&
    HOME_KEYS.some((file) => path.toLowerCase() === join(home, file).toLowerCase()));
/** A whole folder of keys or sign-ins, copied or packed up at once. */
const SECRET_FOLDER =
  /[\\/](?:\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.password-store|\.config[\\/](?:gcloud|gh))[\\/]?$/i;

function secretsNamed(part: string, places: Places): boolean {
  if (SECRET_FILES.test(part)) return true;
  return wordsOf(part)
    .slice(1)
    .map((w) => placeOf(w, places))
    .some((p) => p !== undefined && isSecret(p, places.home));
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

/** An address on this computer itself: `localhost:3000`, `http://127.0.0.1/x`. */
const LOOPBACK = /^(?:https?:\/\/)?(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?:[:/]|$)/i;

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

/** ssh's own flags, before the computer it names: what follows is the command run there. */
function sshFlags(words: string[]): string[] {
  const flags: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? '';
    if (!w.startsWith('-')) break;
    flags.push(w);
    // A flag that takes a value, given apart: `-i key`, `-p 22`, `-R 8080:localhost:80`.
    if (/^-\w*[bcDEeFIiJLlmOopQRSWw]$/.test(w)) i++;
  }
  return flags;
}

/** One piece of a command line. */
/**
 * Vendors' own command-line tools, run through a package runner (`npx wrangler`, `pnpm dlx
 * vercel`, `bunx supabase`), by their npm name: each is judged as itself (2026-10-27), so a
 * deploy is a deploy and `wrangler tail` a look, not an install of something unknown.
 */
const VENDOR_CLIS: Record<string, string> = {
  wrangler: 'wrangler',
  vercel: 'vercel',
  netlify: 'netlify',
  'netlify-cli': 'netlify',
  supabase: 'supabase',
  prisma: 'prisma',
  'firebase-tools': 'firebase',
  firebase: 'firebase',
  'drizzle-kit': 'drizzle-kit',
  '@railway/cli': 'railway',
  railway: 'railway',
  heroku: 'heroku',
  'aws-cdk': 'cdk',
  cdk: 'cdk',
  serverless: 'serverless',
  sst: 'sst',
  surge: 'surge',
};

/** Shell-quotes a word that needs it, to rebuild a command from its words. */
const quoted = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;

/** The vendor CLI command a package runner runs, as if typed bare; undefined for anything else. */
function runnerInner(prog: string, words: string[]): string | undefined {
  let at = 1;
  if (/^(?:pnpm|yarn|bun)$/.test(prog) && /^(?:exec|dlx|x)$/.test(words[1] ?? '')) at = 2;
  else if (prog === 'npm' && /^(?:exec|x)$/.test(words[1] ?? '')) at = 2;
  else if (prog === 'yarn' && VENDOR_CLIS[words[1] ?? '']) at = 1;
  else if (!/^(?:npx|bunx)$/.test(prog)) return undefined;
  // Their own flags first (`npx -y`, `npm exec --`); a `--package` names something else to fetch.
  while (at < words.length && /^-/.test(words[at] ?? '')) {
    if (/^(?:-p|--package)(?:=|$)/.test(words[at] ?? '')) return undefined;
    at++;
  }
  // A name and at most a version: `wrangler@3`, never an address or another package's alias.
  const spec = /^(@?[\w.-]+(?:\/[\w.-]+)?)(?:@[\w.^~<>=*-]+)?$/.exec(words[at] ?? '');
  const cli = spec?.[1] ? VENDOR_CLIS[spec[1]] : undefined;
  if (!cli) return undefined;
  return [cli, ...words.slice(at + 1)].map(quoted).join(' ');
}

/** Bigger than any package.json people write by hand: not read. */
const MAX_MANIFEST = 512 * 1024;

/**
 * The script `npm run <name>` (`pnpm run`, `yarn run`, `bun run`) runs, from the work folder's
 * own package.json, one level deep: what `pnpm run deploy` does is what its script says.
 * Undefined when it's not a script run, it runs elsewhere (`--filter`, `--prefix`), or the
 * script can't be read.
 */
function scriptBody(prog: string, words: string[], places: Places): string | undefined {
  if ((places.depth ?? 0) >= 1 || !/^(?:npm|pnpm|yarn|bun)$/.test(prog)) return undefined;
  if (!/^(?:run|run-script)$/.test(words[1] ?? '')) return undefined;
  if (words.some((w) => /^(?:--filter|-F|--prefix|-C|--dir|--cwd|-w|--workspace)(?:=|$)/.test(w)))
    return undefined;
  const name = words.slice(2).find((w) => !w.startsWith('-'));
  if (!name) return undefined;
  try {
    const file = join(places.workspace, 'package.json');
    if (statSync(file).size > MAX_MANIFEST) return undefined;
    const json = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, unknown> };
    const body = json.scripts?.[name];
    return typeof body === 'string' && body.length < 4000 ? body : undefined;
  } catch {
    return undefined;
  }
}

function partRisk(part: string, places: Places): Risk | undefined {
  const words = wordsOf(part);
  const prog = program(part);
  if (!prog) return undefined;
  words[0] = prog;
  // `npx wrangler deploy` is `wrangler deploy`: a vendor's own CLI, judged by its own rule.
  const run = runnerInner(prog, words);
  if (run) return partRisk(run, places);
  // `npm run deploy` does what its script says: read it, one level deep.
  const script = scriptBody(prog, words, places);
  if (script) {
    const inner = commandRisk(script, places, (places.depth ?? 0) + 1);
    if (inner) return { ...inner, reason: `${inner.reason} (what its script runs)` };
  }
  // `… | xargs rm -rf`: what it deletes is only known when it runs.
  if (prog === 'xargs') {
    const inner = unwrap(
      part.replace(/^\S*xargs(?:\s+-[IdEnLPsa]\s*\S+|\s+--[\w-]+(?:=\S+)?|\s+-[\w-]+)*\s*/, ''),
    );
    if (!inner) return undefined;
    if (
      /^(?:rm|rmdir|shred|srm)$/.test(program(inner)) &&
      /(?:^|\s)-\w*[rR]|--recursive/.test(inner)
    )
      return severe(
        'wipe',
        'delete for good whatever a list names, only known when it runs',
        true,
        wish(WISHES.wipe as RegExp),
      );
    return partRisk(inner, places);
  }
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
  // `find … -delete` and `rsync --delete` delete as `rm -r` would: read their folders the same way.
  if (
    prog === 'find' &&
    /\s-delete\b|\s-(?:exec|execdir|ok|okdir)\s+(?:\S*[\\/])?(?:rm|rmdir|shred)\b/.test(part)
  ) {
    const starts: string[] = [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i] ?? '';
      if (/^-[HLP]$|^-O\d$/.test(w)) continue;
      if (w === '-D') {
        i++;
        continue;
      }
      if (w.startsWith('-') || w === '(' || w === '!') break;
      starts.push(w);
    }
    const risk = deletesIn(starts.length ? starts : ['.'], places);
    if (risk) return risk;
  }
  if (prog === 'rsync' && words.some((w) => /^--(?:delete|del)(?:-\w+)*$/.test(w))) {
    const dest = words.filter((w, i) => i > 0 && !w.startsWith('-')).pop();
    if (dest && !/^(?:[\w.-]+@)?[\w.-]+:/.test(dest)) {
      const risk = deletesIn([dest], places);
      if (risk) return risk;
    }
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
  const leak = leaksKey(part, places);
  if (leak) return leak;
  if (prog === 'git') return gitRisk(words, places);
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
    // Another password manager's secret, printed (2026-10-27): a command's `secrets` keeps it unseen.
    (prog === 'op' &&
      (/\bread\b/.test(part) || /\bitem\s+get\b.*(?:--reveal|--fields)/.test(part))) ||
    (prog === 'bw' && /\bget\b/.test(part)) ||
    (prog === 'pass' && /\bshow\b/.test(part)) ||
    (prog === 'vault' && /\b(?:kv\s+get|read)\b/.test(part)) ||
    (prog === 'heroku' && /\bauth:token\b/.test(part)) ||
    (prog === 'doctl' && /\bauth\b.*\btoken\b/.test(part)) ||
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
  // A tunnel the person asked for ("expose the dev server with ngrok") is theirs (ADR 0128).
  const tunnel = wish(
    stems(
      'tunnel|expos|ngrok\\b|cloudflared\\b|funnel\\b|forward|shar\\w*\\s[^.!?\\n]{0,30}\\b(?:server|port|site|app)\\b|reachable\\b|public(?:ly)?\\s+(?:url|address|link)',
      ABROAD.expose,
    ),
  );
  if (
    /^(?:ngrok|cloudflared|lt|localtunnel|bore|frpc|tailscale)$/.test(prog) &&
    /\b(?:http|tcp|tls|tunnel|local|funnel|start)\b|--port/.test(part)
  )
    return severe('exfiltration', 'open this computer to the internet', false, tunnel);
  if (prog === 'ssh' && sshFlags(words).some((w) => /^-\w*R/.test(w)))
    return severe('exfiltration', 'open this computer to another one', false, tunnel);
  const money = moneyRisk(prog, words);
  if (money) return money;
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
  // Where it goes, for the person to name ("post it to api.example.com", "copy it to the NAS").
  const to = words
    .slice(1)
    .map((w) => {
      const word = w.replace(/^["']|["']$/g, '');
      const bucket = /^(?:s3|gs):\/\/([^/\s]+)/.exec(word)?.[1];
      if (bucket) return bucket.toLowerCase();
      if (/^https?:\/\//i.test(word)) return hostOf(word);
      // `user@host:path`, as scp and rsync name it; a local file isn't a host.
      const host = /^(?:[\w.-]+@)?([\w.-]+):/.exec(word)?.[1];
      return host?.includes('.') ? host.toLowerCase() : undefined;
    })
    .find(Boolean);
  const sends = wish(WISHES.egress as RegExp, to);
  if (NETWORK.test(prog)) {
    // What a command prints, put in an address or a name to look up: a way out for anything.
    if (/\$\(|`/.test(part))
      return moderate('egress', 'send what a command printed to another computer', true, NEVER);
    if (words.some(carriesData))
      return moderate(
        'egress',
        'send something in a web address that could carry what it read',
        true,
        NEVER,
      );
  }
  // Sent to this computer's own servers, and nowhere else, it doesn't leave.
  const addresses = words.slice(1).filter((w) => LOOPBACK.test(w) || /^https?:\/\//i.test(w));
  const onlyHere = addresses.length > 0 && addresses.every((w) => LOOPBACK.test(w));
  if (/^(?:curl|wget|http|https|xh|httpie)$/.test(prog) && !onlyHere) {
    if (
      /\s(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|-F|--form(?:-string)?|-T|--upload-file|--json|--post-(?:data|file)|--body-(?:data|file))\b|\s-X\s*(?:POST|PUT|PATCH|DELETE)\b|--request\s+(?:POST|PUT|PATCH|DELETE)\b|--method=(?:POST|PUT|PATCH|DELETE)\b/i.test(
        part,
      ) ||
      (/^(?:http|https|xh)$/.test(prog) && /^(?:POST|PUT|PATCH|DELETE)$/i.test(words[1] ?? ''))
    )
      return moderate('egress', 'send data to an address on the internet', true, sends);
  }
  if (
    /Invoke-(?:WebRequest|RestMethod)\b.*-Method\s+(?:Post|Put|Patch|Delete)|-InFile\b/i.test(part)
  )
    return moderate('egress', 'send data to an address on the internet', true, sends);
  if (/^(?:nc|ncat|netcat|socat|telnet)$/.test(prog))
    return moderate('egress', 'open a raw connection to another computer', true, sends);
  if (
    /^(?:scp|sftp|rsync|rclone|lftp|ftp)$/.test(prog) &&
    /(?:^|\s)(?:[\w.-]+@)?[\w.-]+:(?!\/\/)|\s\w+:[^\s]*|s3:\/\/|gs:\/\//.test(part)
  )
    return moderate('egress', 'copy files to another computer', true, sends);
  if (prog === 'ssh' && words.filter((w) => !w.startsWith('-')).length >= 2)
    return moderate('egress', 'run a command on another computer', true, sends);
  if (/^(?:aws|gsutil|azcopy)$/.test(prog) && /\b(?:cp|sync|mv)\b.*(?:s3|gs|https):\/\//.test(part))
    return moderate('egress', 'copy files to cloud storage', true, sends);
  if (
    /^(?:python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php)$/.test(prog) &&
    /\s-(?:c|e|r|E)\b|\seval\b/.test(part) &&
    /\b(?:urllib|requests|httpx|http\.client|socket|fetch|https?\.request|net\.connect|XMLHttpRequest|IO::Socket|LWP|Net::HTTP|open-uri|curl_init|file_get_contents\s*\(\s*['"]https?)/.test(
      part,
    )
  )
    return moderate('egress', 'send data out from a script', true, NEVER);
  return undefined;
}

const RANK = (risk: Risk) =>
  2 * ((risk.harm === 'severe' ? 2 : 1) + (risk.lasting ? 1 : 0)) + (risk.asked ? 0 : 1);

/** The most serious of several; of two alike, the one nobody asked for. */
function worst(risks: (Risk | undefined)[]): Risk | undefined {
  let best: Risk | undefined;
  for (const risk of risks) if (risk && (!best || RANK(risk) > RANK(best))) best = risk;
  return best;
}

/** What a command line could do, at its worst. */
export function commandRisk(command: string, context: RiskContext, depth = 0): Risk | undefined {
  const places: Places = {
    workspace: resolve(context.workspace),
    home: context.home ?? homedir(),
    scratch: [tmpdir(), '/tmp', '/private/tmp', '/var/folders'].map((p) => resolve(p)),
    ...(context.said && { said: context.said }),
    ...(context.treeClean && { treeClean: context.treeClean }),
    ...(context.sameRemote && { sameRemote: context.sameRemote }),
    ...(context.currentBranch && { currentBranch: context.currentBranch }),
    ...(context.secretNames?.length && { secretNames: context.secretNames }),
    ...(depth > 0 && { depth }),
  };
  const risks: (Risk | undefined)[] = [];
  for (const script of scriptsOf(command)) {
    // Whole-line shapes: downloaded or decoded code handed straight to a shell. An installer
    // the person named by its host ("install it with the script from brew.sh") is theirs to
    // ask for (ADR 0128); code decoded from a blob is nobody's.
    let downloaded =
      new RegExp(
        `${DOWNLOADER.source}${UNQUOTED_RUN}(?:\\|\\s*[^|;&\\s][^|;&\\n]*)*?\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:env\\s+)?(?:\\S*[\\\\/])?(?:(?:ba|z|da|k|fi)?sh|python\\d?(?:\\.\\d+)?|node|perl|ruby|php|pwsh|powershell|iex|Invoke-Expression|osascript)(?=(?:\\s+-[\\w-]+)*\\s*(?:$|[;&|)\\n])|\\s+-s\\b|\\s+-(?:\\s|$)|\\s+--(?:\\s|$))`,
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
      );
    // Saved to a file first, then run: `curl -o i.sh … && bash i.sh`. Pip's own bootstrap isn't.
    for (const piece of splitLine(script)) {
      const saved = savedDownload(piece);
      if (!saved || fromTooling(piece)) continue;
      const name = saved.replace(/^\.\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const runs = new RegExp(
        `(?:^|[;&|\\n]\\s*)(?:(?:(?:ba|z|da|k|fi)?sh|source|\\.|python\\d?(?:\\.\\d+)?|node|perl|ruby|php|pwsh)\\s+(?:-\\S+\\s+)*["']?(?:\\.\\/)?|\\.\\/)${name}(?=$|[\\s;&|"'])`,
      );
      if (runs.test(script.slice(script.indexOf(piece) + piece.length))) downloaded = true;
    }
    const decoded =
      /base64\s+(?:-d|--decode|-D)\b[^|;&]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python\d?|perl|node)\b/.test(
        script,
      ) ||
      /\|\s*base64\s+(?:-d|--decode|-D)\b[^|;&]*\|\s*(?:(?:ba|z|da|k)?sh|python\d?|perl|node)\b/.test(
        script,
      ) ||
      /FromBase64String\([^)]{40,}\)/i.test(script);
    if (downloaded || decoded) {
      const host = [...script.matchAll(/https?:\/\/([^/\s"'`)]+)/gi)]
        .map((m) => (m[1] ?? '').replace(/:\d+$/, '').toLowerCase())
        .find(Boolean);
      risks.push(
        severe(
          'remote-code',
          'run code downloaded from the internet without reading it first',
          true,
          decoded || !host ? NEVER : wish(WISHES['remote-code'] as RegExp, host),
        ),
      );
    }
    // Run as the computer's administrator, wherever in the line.
    const bare = blankQuoted(script, true);
    if (
      /(?:^|[;&|\n(]\s*|\$\(\s*|`\s*)(?:sudo|doas|pkexec|gsudo|run0)\b/i.test(bare) ||
      /(?:^|[;&|\n]\s*)su(?:\s+-\S*)*(?:\s+[\w-]+)?\s*(?:$|[;&|]|-c\b)/.test(bare)
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
  // A registry of someone else's, set for what runs next: every install in the line goes there.
  if (scriptsOf(command).some((script) => REGISTRY_SET.test(script)))
    for (const part of commandParts(command))
      risks.push(installRisk(program(part), wordsOf(part), places, true));
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
  // What the person's words say about each (ADR 0128), then the worst of them: of two alike,
  // the one nobody asked for.
  const risk = worst(risks.map((r) => (r ? wanted(r, places.said) : r)));
  // An asked-for push with keys added on the same line is keys leaving: it asks after reading.
  if (risk?.asked && commandParts(command).some((part) => addsSecrets(part, places)))
    return { ...risk, asked: false };
  return risk;
}

/** `git add` forcing in what's ignored, or naming a `.env`, a key or a saved sign-in. */
function addsSecrets(part: string, places: Places): boolean {
  if (program(part) !== 'git') return false;
  const words = wordsOf(part);
  const at = words.indexOf('add');
  if (at < 1) return false;
  return words.slice(at + 1).some((w) => {
    if (/^-[A-Za-z]*f[A-Za-z]*$/.test(w) || w === '--force') return true;
    if (w.startsWith('-')) return false;
    if (/(?:^|[\\/])\.env(?!\.(?:example|sample|template|dist|defaults?)$)(?:\.[\w-]+)?$/i.test(w))
      return true;
    if (/\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(w) || SECRET_FILES.test(` ${w}`)) return true;
    const path = placeOf(w, places);
    return path !== undefined && isSecret(path, places.home);
  });
}

/**
 * Programs whose everyday use is reading, building, testing and tidying a
 * project, and the tools whose risky uses the rules above already read. A
 * review (`auto-review.ts`) adds nothing for a line made only of these.
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
  // Making documents and fonts (ADR 0117, 2026-10-09): rendering a PDF is everyday work.
  ...'pyftsubset fonttools ttx qpdf gs pdftotext pdfinfo pdftoppm pdfunite pdfseparate mutool wkhtmltopdf weasyprint typst latexmk pdflatex xelatex lualatex rsvg-convert inkscape cwebp'.split(
    ' ',
  ),
]);

/** Interpreters given code on the line itself, not a file of the project's. */
const INLINE_CODE =
  /^(?:python\d?(?:\.\d+)?|node|deno|bun|perl|ruby|php|pwsh|powershell|osascript|lua|Rscript)$/i;

/**
 * What in code on the line could reach out, run something else, decode a blob, or touch keys
 * and settings (ADR 0117, 2026-10-09). `python3 -c "import fontTools; print(…)"` has none of
 * it: checking a version, sorting a file, or printing a sum is routine, after reading too.
 */
const REACHING_CODE =
  /\b(?:socket|subprocess|os\.(?:system|popen|exec\w*|spawn\w*|environ|remove|unlink|rmdir)|shutil\.rmtree|popen|exec|eval|compile|__import__|child_process|spawn\w*|exec(?:Sync|File)?|urllib\d?|requests|httpx|aiohttp|http\.client|ftplib|smtplib|paramiko|fetch|XMLHttpRequest|WebSocket|net\.connect|https?\.(?:request|get)|base64|b64decode|atob|Buffer\.from|marshal|pickle|ctypes|getenv|process\.env|ENV\[|keychain|Net::HTTP|IO::Socket|LWP|open-uri|Invoke-\w+|do shell script)\b|https?:\/\/|\.ssh\b|\.aws\b|\.gnupg\b|\/dev\/(?:tcp|udp)|rmSync|unlinkSync/i;

/**
 * Whether a command is worth a second look by a small model, once the chat
 * has read something (`auto-review.ts`): the rules found nothing, and it isn't
 * only everyday work, and it can reach the internet or your sign-ins (it
 * runs outside the sealed box, or names an address or a program that sends).
 */
export function wantsSecondLook(command: string, unsealed: boolean): boolean {
  const parts = commandParts(command);
  const unusual = parts.some((part) => {
    const prog = program(part);
    if (!prog) return false;
    if (INLINE_CODE.test(prog))
      return /\s-(?:c|e|r|E|Command)\b|\seval\b/i.test(part) && REACHING_CODE.test(part);
    // Fetching pip's bootstrap or Python itself from their own hosts is bootstrapping.
    if (NETWORK.test(prog) && fromTooling(part)) return false;
    return !EVERYDAY.has(prog);
  });
  if (!unusual) return false;
  return (
    unsealed ||
    /\/dev\/(?:tcp|udp)\//i.test(command) ||
    parts.some(
      (part) => (NETWORK.test(program(part)) || /https?:\/\//i.test(part)) && !fromTooling(part),
    )
  );
}

// ── Any step ──────────────────────────────────────────────────────────────

const FILE_WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FILE_READERS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
/** Conch's own steps that delete in your apps. */
export const DELETES =
  /(?:^|_|-)(?:delete|destroy|purge|drop|wipe|erase|trash|unpublish|revoke)(?:_|-|$)/i;
/** An app's change that spends money (ADR 0117): a payment, a purchase, a transfer. */
export const PAYS =
  /(?:^|_|-)(?:pay|pays|payment|purchase|buy|checkout|transfer|donate|tip|charge|refund|withdraw|send_money|place_order)(?:_|-|$)/i;
/** An app's change that speaks for the person to others, or makes something public (ADR 0117). */
export const SPEAKS =
  /(?:^|_|-)(?:send|post|publish|share|invite|tweet|reply|forward|broadcast|notify|comment|email|sms|message|announce)(?:_|-|$)/i;
/** All the words a call sends, counted: a read that sends pages of text is no ordinary lookup. */
export function wordsSent(args: Record<string, unknown>): number {
  let total = 0;
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || total > 100_000) return;
    if (typeof value === 'string') total += value.length;
    else if (Array.isArray(value)) for (const v of value) walk(v, depth + 1);
    else if (value && typeof value === 'object')
      for (const v of Object.values(value)) walk(v, depth + 1);
  };
  walk(args, 0);
  return total;
}
/** More text than a lookup sends (a food, a city, a date): it could carry what the chat read. */
export const HEAVY_READ = 600;
/**
 * An app's change that gives someone access or changes who can reach the person's things
 * (ADR 0118): a collaborator, a role, a token, a webhook. Lasting, and a classic way to keep
 * a foothold, so it asks after reading.
 */
export const GRANTS =
  /(?:^|_|-)(?:grant|grants|permission|permissions|role|roles|collaborator|collaborators|member|members|access|token|tokens|apikey|api_key|secret|secrets|webhook|webhooks|deploy_key|ssh_key|oauth)(?:_|-|$)/i;
/** An app's step that runs code it's given (ADR 0118): whatever the code says, it does. */
export const RUNS =
  /(?:^|_|-)(?:execute|exec|eval|run_code|run_script|run_sql|query_sql|sql)(?:_|-|$)/i;

/**
 * What the code or query an app's step runs does, read from its own words (ADR 0118,
 * 2026-10-27): `read` when it only looks (a SELECT, a GET, a GraphQL query), `delete` when it
 * deletes or empties, `write` when it changes something, `unknown` when it can't be told (code
 * built at run time, `eval`). The code runs on the app's servers as the person; this reads it.
 */
export type AppCode =
  | 'read'
  | 'write'
  | 'delete'
  | 'unknown'
  /** Changes who can reach something: a token, a member, a role, a webhook, a grant. */
  | 'grant'
  /** Opens data to anyone: a grant to the public or anonymous roles, row security off. */
  | 'opens'
  /** Sends what it read somewhere other than the app itself. */
  | 'egress';

/** The first string an app's step gives under one of these names. */
function argText(args: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = args[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

const SQL_ARGS = ['query', 'sql', 'statement', 'statements', 'q'] as const;
const CODE_ARGS = ['code', 'script', 'source', 'js', 'program'] as const;

/**
 * Functions a query may call and still only look (2026-10-27): counting, dates, text, JSON
 * built from what it read. Anything else (a function of the database's own, an extension's)
 * can do anything, so a SELECT that calls one can't be told.
 */
const PURE_SQL = new Set(
  (
    'count sum avg min max now date_trunc date_part extract coalesce nullif greatest least ' +
    'json_agg jsonb_agg array_agg string_agg json_build_object jsonb_build_object ' +
    'json_array_length jsonb_array_length array_length unnest generate_series to_char ' +
    'to_timestamp to_date to_number age date timezone lower upper initcap length char_length ' +
    'substring substr trim ltrim rtrim replace split_part concat concat_ws left right position ' +
    'strpos round floor ceil ceiling abs mod power sqrt trunc random row_number rank dense_rank ' +
    'ntile lag lead first_value last_value percentile_cont percentile_disc mode bool_and ' +
    'bool_or every pg_size_pretty pg_total_relation_size pg_relation_size pg_database_size ' +
    'pg_table_size pg_indexes_size current_setting md5 encode decode format cast'
  ).split(' '),
);

/** Words SQL writes before a parenthesis that aren't calls: `IN (`, `AS (`, `numeric(10,2)`. */
const SQL_NOT_CALLS = new Set(
  (
    'in as from join on and or not exists any all some values select where when then else ' +
    'case over filter within group partition by having using lateral distinct window limit ' +
    'offset into table with recursive returning numeric decimal varchar char character ' +
    'timestamp timestamptz interval float double real int integer bigint smallint text time ' +
    'array row is null like ilike between union intersect except order asc desc'
  ).split(' '),
);

/** Calls that send what a query read elsewhere, or read the server's own files (2026-10-27). */
const SQL_OUT =
  /^(?:net\.http_\w+|http(?:_\w+)?|extensions\.http\w*|dblink\w*|pg_read_\w*file|pg_ls_dir|lo_import|lo_export|pg_file_write)$/;
/** Calls that change whose rights a query runs with, or reload what the database allows. */
const SQL_GRANTS = /^(?:set_config|set_role|pg_reload_conf)$/;
/** Who can reach the data (2026-10-27): a grant, a role, row security off, a policy for all. */
const SQL_GRANT =
  /^(?:grant|revoke)\b|^(?:create|alter|drop)\s+(?:role|user|group)\b|^alter\s+default\s+privileges\b|^set\s+(?:session\s+)?role\b|\bdisable\s+row\s+level\s+security\b|\bno\s+force\s+row\s+level\s+security\b|^create\s+policy\b[\s\S]*\busing\s*\(\s*true\s*\)/;
/** A grant that opens the data to anyone: the public or anonymous roles, or row security off. */
const SQL_OPENS =
  /\bto\s+(?:public|anon|anonymous|authenticated)\b|\bdisable\s+row\s+level\s+security\b|\busing\s*\(\s*true\s*\)/;

/** From least to most a query can do: one statement's effect never makes the whole one less. */
const CODE_ORDER: readonly AppCode[] = [
  'read',
  'write',
  'unknown',
  'grant',
  'opens',
  'egress',
  'delete',
];
const worse = (a: AppCode, b: AppCode): AppCode =>
  CODE_ORDER.indexOf(b) > CODE_ORDER.indexOf(a) ? b : a;

/** SQL, its comments and quoted strings set aside, read statement by statement. */
export function sqlEffect(sql: string): AppCode {
  const text = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .toLowerCase();
  const statements = text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!statements.length) return 'unknown';
  let effect: AppCode = 'read';
  for (const statement of statements) {
    if (SQL_GRANT.test(statement)) {
      effect = worse(effect, SQL_OPENS.test(statement) ? 'opens' : 'grant');
      continue;
    }
    if (/\b(?:drop|truncate|delete)\b/.test(statement)) return 'delete';
    if (/^update\b/.test(statement) && !/\bwhere\b/.test(statement)) return 'delete';
    // COPY to a file or a program: what it read leaves the database.
    if (/^copy\b[\s\S]*\b(?:program|to)\b/.test(statement)) return 'egress';
    // Every call a statement makes, read by its name: a pure one only looks.
    for (const m of statement.matchAll(/([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)\s*\(/g)) {
      const name = (m[1] ?? '').replace(/^(?:pg_catalog|public)\./, '');
      if (SQL_OUT.test(name)) return 'egress';
      // A table and its columns (`into notes(body)`, `references users(id)`) aren't a call; a
      // function after FROM or JOIN is (`from dblink(…)`, `from cleanup()`).
      if (
        /\b(?:into|table|references|on|update|index|view|type)\s+$/.test(
          statement.slice(0, m.index),
        )
      )
        continue;
      if (SQL_NOT_CALLS.has(name) || PURE_SQL.has(name)) continue;
      if (SQL_OUT.test(name)) return 'egress';
      effect = worse(effect, SQL_GRANTS.test(name) ? 'grant' : 'unknown');
    }
    if (
      /^(?:select|with|explain|show|describe|desc|values|table|pragma)\b/.test(statement) &&
      !/\b(?:insert|update|merge|upsert|alter|create|grant|revoke|copy|call|do|vacuum|into)\b/.test(
        statement,
      )
    )
      continue;
    effect = worse(effect, /^(?:call|do)\b/.test(statement) ? 'unknown' : 'write');
  }
  return effect;
}

/** Paths an app's API keeps who can reach things under: tokens, members, roles, webhooks. */
const GRANT_PATHS =
  /\/(?:api_tokens|tokens|members|memberships|roles|role_assignments|webhooks|hooks|secrets|collaborators|invites|deploy_keys|keys|access)\b(?![_-])/i;

/** The registered name of a host: "api.cloudflare.com" is "cloudflare". */
function hostName(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  // "foo.supabase.co", "api.example.co.uk": the label before the public suffix.
  const two = /^(?:co|com|org|net|gov|ac|edu)$/.test(labels.at(-2) ?? '') && labels.length > 2;
  return labels.at(two ? -3 : -2) ?? labels[0] ?? '';
}

/**
 * Code an app runs (Cloudflare's code mode, a script tool): it reads when every request it
 * makes is a GET, or a GraphQL query, and nothing calls an SDK's change or builds its method at
 * run time. Strict on purpose (2026-10-27): a method it can't read, a property built from pieces
 * (`api['del' + 'ete']`) or `eval` can't be told; a request to a site other than the app's own
 * sends what it read away; a change under tokens, members, roles or webhooks is a grant.
 */
export function codeEffect(code: string, names: readonly string[] = []): AppCode {
  if (
    /\b(?:eval|Function)\s*\(|\bimport\s*\(|\bReflect\.|\b(?:globalThis|window|self|this)\s*\[/.test(
      code,
    )
  )
    return 'unknown';
  // A method picked at run time and called: `x['del' + 'ete'](…)`, `x[verb](…)`. Reading
  // `rows[i]` is fine; calling what a bracket names can't be told.
  if (/\[[^\]\n]+\]\s*\(/.test(code)) return 'unknown';
  // A request to a site that isn't the app's: what it read leaves for somewhere else.
  const own = names.map((name) => name.toLowerCase().replace(/[\s_-]+|-\d+$/g, '')).filter(Boolean);
  for (const m of code.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) {
    const host = hostName(m[1] ?? '');
    if (!own.length) return 'unknown';
    if (!own.some((name) => host === name || host.replace(/[-_]/g, '') === name)) return 'egress';
  }
  let effect: AppCode = 'read';
  // `method: 'GET'`, `"method": "DELETE"`, `method = "POST"`: every one is read.
  for (const m of code.matchAll(/["'`]?\bmethod["'`]?\s*[:=]\s*(?:(['"`])([A-Za-z]+)\1)?/g)) {
    const method = m[2]?.toUpperCase();
    if (!method) return 'unknown';
    if (method === 'DELETE') return 'delete';
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') continue;
    // A GraphQL query rides on POST; a mutation is a change.
    if (method === 'POST' && /graphql/i.test(code) && !/\bmutation\b/.test(code)) continue;
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return 'unknown';
    effect = 'write';
  }
  if (
    /-X\s*DELETE\b/i.test(code) ||
    /\.(?:delete|destroy|purge|remove|del)\s*\(/.test(code) ||
    /\b(?:delete\s+from|drop\s+(?:table|database|schema)|truncate)\b/i.test(code)
  )
    return 'delete';
  if (
    /\bmutation\b|\.(?:create|update|edit|put|post|patch|set|add|upsert|insert)\s*\(/.test(code) ||
    /\b(?:insert\s+into|update\s+\w+\s+set|alter\s+table)\b/i.test(code)
  )
    effect = 'write';
  // A change under tokens, members, roles or webhooks changes who can reach things.
  if (effect === 'write' && GRANT_PATHS.test(code)) return 'grant';
  if (effect === 'write' && /\.(?:tokens|members|roles|webhooks|secrets)\.\w+\s*\(/.test(code))
    return 'grant';
  if (effect === 'write') return 'write';
  // A read needs something that reads: a request, a GraphQL query, an SDK's list or get.
  // Code that shows none ("x", a call by another name) can't be told, so it stays code.
  const reads =
    /\bfetch\s*\(|\.request\s*\(|graphql|\.(?:list|get|read|query|search|describe|retrieve|find|browse)\w*\s*\(/i;
  return reads.test(code) ? 'read' : 'unknown';
}

/** What an app's code-running step does, by its query or its code. */
export function appCodeEffect(
  args: Record<string, unknown>,
  tool: string,
  names: readonly string[] = [],
): AppCode {
  const sql = argText(args, SQL_ARGS);
  const code = argText(args, CODE_ARGS);
  if (sql && (/sql/i.test(tool) || !code)) return sqlEffect(sql);
  if (code) return codeEffect(code, names);
  return 'unknown';
}

/** An app's tool by its parts: `mcp__cloudflare__execute` is server `cloudflare`, tool `execute`. */
function appTool(toolName: string): { server?: string; tool: string } {
  const mcp = /^mcp__(?!conch__)([a-z0-9_-]+?)__(.+)$/.exec(toolName);
  return mcp
    ? { server: mcp[1], tool: mcp[2] ?? '' }
    : { tool: toolName.replace(/^mcp__conch__/, '') };
}

/**
 * The rules read this app step for what it does (2026-10-27): it isn't code or a query, or its
 * code or query was read as a lookup or an ordinary change. Only then may "nothing found" mean
 * nothing there; for code it couldn't read, it means it couldn't tell.
 */
export function positivelyRead(toolName: string, input: unknown, app?: string): boolean {
  const { server, tool } = appTool(toolName);
  if (!RUNS.test(tool)) return true;
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const effect = appCodeEffect(
    args,
    tool,
    [app, server].filter((n): n is string => Boolean(n)),
  );
  return effect === 'read' || effect === 'write';
}

/** The app step's code or query only looks, read by the rules (2026-10-27): nothing to review. */
export function codeOnlyReads(toolName: string, input: unknown, app?: string): boolean {
  const { server, tool } = appTool(toolName);
  if (!RUNS.test(tool)) return false;
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return (
    appCodeEffect(
      args,
      tool,
      [app, server].filter((n): n is string => Boolean(n)),
    ) === 'read'
  );
}

/** Words for changing something in an app, said with the app's name (ADR 0128, 2026-10-27). */
const APP_CHANGE_WORDS = stems(
  'block|unblock|ban|allow|fix|update|add|set|create|change|apply|configure|enable|disable|turn\\s+(?:on|off)|rotate|deploy|edit|insert|write|rate[- ]?limit|protect|mitigat|run|execut|quer(?:y|ies)\\b',
  ABROAD.update,
  ABROAD.deploy,
  ABROAD.change,
  ABROAD.run,
);

/** The names a person calls an app by: its own, and its server's ("cloudflare", "github-2"). */
function appNames(app: string | undefined, server: string | undefined): RegExp | undefined {
  const names = [app, server?.replace(/-\d+$/, '')]
    .map((name) => fold(name ?? '').trim())
    .filter((name) => name.length >= 3)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s_-]+/g, '[\\s_-]*'));
  return names.length ? new RegExp(`\\b(?:${[...new Set(names)].join('|')})\\b`) : undefined;
}

/**
 * The person asked for a change in this app in their own words: a change word and the app's
 * name together in a message of theirs ("block those scanner IPs at Cloudflare", ADR 0128).
 */
export function askedInApp(
  said: readonly string[] | undefined,
  app: string | undefined,
  server?: string,
): boolean {
  const name = appNames(app, server);
  if (!name) return false;
  const change = moderate('infra', 'change something in one of your apps', true);
  // Only their latest message (2026-10-27): a change asked for turns ago doesn't stretch to
  // whatever a later read suggests.
  const latest = said?.length ? [said[said.length - 1] ?? ''] : said;
  return Boolean(wanted({ ...change, wish: wish(APP_CHANGE_WORDS, name) }, latest).asked);
}

/** Shapes keys and tokens have, whatever they're called (ADR 0118). */
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk)-(?:[a-z]+-)?[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** Every string a call sends, walked as `wordsSent` does. */
function stringsOf(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || out.length > 500) return;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const v of value) walk(v, depth + 1);
    else if (value && typeof value === 'object')
      for (const v of Object.values(value)) walk(v, depth + 1);
  };
  walk(args, 0);
  return out;
}

/**
 * What an app's step would send that no lookup or ordinary change needs (ADR 0118): a key or
 * token by its shape, or a long encoded blob (base64 with mixed case and digits, or long hex).
 * Ids, UUIDs, dates, names, sentences and notes don't: their pieces are short or plain words.
 */
export function carriesSecrets(args: Record<string, unknown>): 'key' | 'blob' | undefined {
  const strings = stringsOf(args);
  if (strings.some((s) => SECRET_SHAPES.some((shape) => shape.test(s)))) return 'key';
  const blob = (token: string) =>
    (token.length >= 48 &&
      /^[A-Za-z0-9+/=_-]+$/.test(token) &&
      /\d/.test(token) &&
      /[A-Z]/.test(token) &&
      /[a-z]/.test(token)) ||
    /^[0-9a-f]{80,}$/i.test(token);
  return strings.some((s) => s.split(/[\s"'`,;:.()[\]{}<>|&]+/).some(blob)) ? 'blob' : undefined;
}

/**
 * Whether an app's step sends more than a short lookup (ADR 0118): any one value over 100
 * characters, or over 200 in all. Only then is a step in someone else's app worth a second
 * look; a food, a date, an id or a city never is.
 */
export function sendsMoreThanALookup(args: Record<string, unknown>): boolean {
  const strings = stringsOf(args);
  return strings.some((s) => s.length > 100) || wordsSent(args) > 200;
}

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
  // A script (ADR 0123) is judged by what each of its calls does, at that call, never as a
  // whole: its words are code, and any of it could be anything.
  if (isRunScript(toolName)) return undefined;
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
    return commandRisk(args.command, {
      ...context,
      ...(Array.isArray(args.secrets) && {
        secretNames: args.secrets.flatMap((ref: unknown) =>
          ref && typeof ref === 'object' && typeof (ref as { name?: unknown }).name === 'string'
            ? [(ref as { name: string }).name]
            : [],
        ),
      }),
    });
  const said = (risk: Risk | undefined) => (risk ? wanted(risk, context.said) : undefined);
  if (FILE_WRITERS.has(toolName)) {
    const raw = String(args.file_path ?? args.notebook_path ?? '');
    const path = raw ? placeOf(raw, places) : undefined;
    return said(path ? writeRisk(path) : undefined);
  }
  if (FILE_READERS.has(toolName)) {
    const raw = String(
      args.file_path ?? args.path ?? (toolName === 'Glob' ? args.pattern : '') ?? '',
    );
    const path = raw ? placeOf(raw, places) : undefined;
    return path && isSecret(path, home)
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
  const mcp = /^mcp__(?!conch__)([a-z0-9_-]+?)__(.+)$/.exec(toolName);
  const app = mcp?.[2];
  const server = mcp?.[1];
  const step = app ?? (/^(?:google|slack|app)_/.test(bare) ? bare : '');
  // A key, a token or an encoded blob sent to an app, read or change (ADR 0118): nothing a
  // lookup or an ordinary change needs, and the shape of a chat's secrets leaving it. Read
  // before what the step is called, so a key in a message, a comment or a deletion's note
  // never passes as one of those (2026-10-27).
  const carried = step ? carriesSecrets(args) : undefined;
  if (carried === 'key')
    return severe(
      'exfiltration',
      'send something that looks like a key or token to an app',
      false,
      NEVER,
    );
  if (carried === 'blob')
    return severe('exfiltration', 'send a long block of encoded data to an app', false, NEVER);
  // The person's words naming this app with a change word ask for its change too (ADR 0128,
  // 2026-10-27): "block those scanner IPs at Cloudflare".
  const inApp = (risk: Risk): Risk => {
    const read = said(risk) ?? risk;
    if (read.asked || read.held || !askedInApp(context.said, context.app, server)) return read;
    return { ...read, asked: true };
  };
  // The person's words lift an app's step too (ADR 0128): "delete the old entries", "send it
  // to the team", "give Bo access". Money and keys are nobody's to ask for this way.
  if (DELETES.test(step)) return said(severe('app-delete', 'delete something in one of your apps'));
  // MCP's destructiveHint says what a tool may do, not what these arguments will do.
  // Keep its approval gate; don't guess that arbitrary executor code is read-only.
  if (context.destructive)
    return said({
      ...severe('app-delete', 'make changes or delete data in one of your apps'),
      possible: true,
    });
  // What an app's change does with money or other people, by what its tool is called
  // (ADR 0117). Only for a tool known to change things: `get_order` only looks.
  const tool = step.replace(/^app_[a-z0-9_]+?__/, '');
  if (context.access === 'write' && step && PAYS.test(tool))
    return severe('spend', 'spend money in one of your apps', true, NEVER);
  if (context.access === 'write' && step && SPEAKS.test(tool))
    return said(
      moderate(
        'egress',
        'send something to other people from one of your apps',
        true,
        wish(SPEAK_WORDS),
      ),
    );
  // Who can reach the person's things, and code run as they say (ADR 0118): after reading.
  if (context.access === 'write' && step && GRANTS.test(tool))
    return said(moderate('privilege', 'change who can reach something in one of your apps'));
  if (step && RUNS.test(tool)) {
    // Read by what its code or query does (2026-10-27): a SELECT or a GET only looks; a DELETE,
    // a DROP or an UPDATE without WHERE deletes; other changes are ordinary changes in the
    // person's own app; code that can't be read stays code it wrote.
    const effect = appCodeEffect(
      args,
      tool,
      [context.app, server].filter((n): n is string => Boolean(n)),
    );
    if (effect === 'read') return undefined;
    if (effect === 'delete')
      return said({
        ...severe('app-delete', 'delete or empty something in one of your apps'),
        inApp: true,
      });
    // What it read, sent to another site: never anyone's to ask for in passing.
    if (effect === 'egress')
      return {
        ...moderate('egress', 'send what an app read to another site', true, NEVER),
        inApp: true,
      };
    // Who can reach the person's things: asked for in words about access, never by a change word.
    if (effect === 'opens')
      return said({
        ...severe('privilege', 'open data in one of your apps to anyone'),
        inApp: true,
      });
    if (effect === 'grant')
      return said({
        ...moderate('privilege', 'change who can reach something in one of your apps'),
        inApp: true,
      });
    // Code it couldn't read is only the review's to lift: no words ask for what can't be told.
    if (effect === 'unknown')
      return {
        ...moderate('remote-code', 'run code it wrote in one of your apps', true, NOT_BY_WORDS),
        inApp: true,
      };
    const runs = wish(stems('run|execut|script|code\\b|quer(?:y|ies)\\b|sql\\b', ABROAD.run));
    return inApp({
      ...moderate('infra', 'change something in one of your apps', true, runs),
      inApp: true,
    });
  }
  // A read that sends pages of text to the app's site: it could carry what was read.
  if (context.access === 'read' && step && wordsSent(args) > HEAVY_READ)
    return moderate('egress', 'send a lot of text from this chat to an app’s website', true, NEVER);
  return undefined;
}

/** Speaking for the person to other people, as they ask for it. */
const SPEAK_WORDS = stems(
  'send|post|reply|share|invite|publish|email|mail|message|text|notify|comment|tweet|forward|announce|tell|let\\s+\\w+\\s+know|respond|answer|broadcast|dm|ping|write\\s+(?:to|back)|get\\s+back\\s+to',
  ABROAD.send,
  ABROAD.publish,
  'invit|einlad|uitnodig|convid|antwort|repond|respond|rispond|contest(?:a|ar)\\b|antwoord', // inviting, replying
  '(?:schreib\\w*|ecri\\w*|escrib\\w*|escrev\\w*|scriv\\w*|schrijf)\\s+(?:an|a|aan|para|al|alla?|ao|aux?)\\b', // writing to someone
);

/** Fields a send names its people or place by: who it goes to, the channel, the guests. */
const RECIPIENT_FIELDS = new Set([
  'to',
  'cc',
  'bcc',
  'recipient',
  'recipients',
  'attendees',
  'guests',
  'invitees',
  'emails',
  'email',
  'channel',
  'channelName',
  'channel_name',
  'user',
  'users',
]);
/** Fields that say a send answers a thread already there. */
const THREAD_FIELDS = ['threadId', 'thread_ts', 'threadTs', 'inReplyTo', 'replyTo', 'replyToId'];

/** Every person or place a send names, as written in its arguments. */
function recipientsOf(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number, named: boolean) => {
    if (depth > 4 || out.length > 100) return;
    if (typeof value === 'string') {
      if (named) out.push(...value.split(/[,;]\s*/).filter(Boolean));
    } else if (Array.isArray(value)) for (const v of value) walk(v, depth + 1, named);
    else if (value && typeof value === 'object')
      for (const [key, v] of Object.entries(value))
        walk(v, depth + 1, named || RECIPIENT_FIELDS.has(key) || (depth > 0 && key === 'email'));
  };
  for (const [key, value] of Object.entries(args))
    if (RECIPIENT_FIELDS.has(key)) walk(value, 1, true);
  return out;
}

/** The message names this person or place: the address, its name before the @, or a name in it. */
function namesRecipient(message: string, recipient: string): boolean {
  const text = fold(recipient).replace(/^[#@]/, '').trim();
  if (!text) return false;
  const email = /<?([^\s<>]+@[^\s<>]+)>?/.exec(text)?.[1];
  const candidates = email
    ? [email, email.split('@')[0] ?? '', ...(email.split('@')[0] ?? '').split(/[._+-]/)]
    : [text, ...text.split(/[\s._-]+/)];
  return candidates.some((name) => name.length >= 3 && names(message, name));
}

/**
 * The person's latest message asks for exactly this send (2026-10-27): it asks to send, reply,
 * post or invite, and names everyone it goes to, or it answers the thread already there and
 * adds no one. When no review can run, these words decide; anything less shows the card.
 */
export function sendAsked(
  said: readonly string[] | undefined,
  args: Record<string, unknown>,
): boolean {
  const latest = said?.at(-1);
  if (!latest) return false;
  const send = moderate('egress', 'send something to other people', true, wish(SPEAK_WORDS));
  if (!wanted(send, [latest]).asked) return false;
  const message = fold(ownWords(latest));
  const people = recipientsOf(args);
  if (!people.length) return THREAD_FIELDS.some((field) => Boolean(args[field]));
  return people.every((person) => namesRecipient(message, person));
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
