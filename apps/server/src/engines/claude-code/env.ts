/**
 * Environment for child Claude Code processes.
 *
 * When Conch itself is launched from inside a Claude Code session (common for
 * developers), variables describing *that* session leak into ours and make the
 * child believe it's nested. We strip them, keep everything else (provider
 * config such as CLAUDE_CODE_USE_BEDROCK, proxies, PATH) and add our own.
 */
const SESSION_VARS = [
  /^CLAUDECODE$/,
  /^CLAUDE_CODE_ENTRYPOINT$/,
  /^CLAUDE_CODE_SESSION/,
  /^CLAUDE_CODE_CHILD_SESSION$/,
  /^CLAUDE_CODE_MESSAGING_/,
  /^CLAUDE_CODE_EXECPATH$/,
  /^CLAUDE_CODE_PATH$/,
  /^CLAUDE_PID$/,
];

/**
 * Conch's own configuration never reaches the agent: it could otherwise read
 * CONCH_TOKEN (a sign-in credential) with a simple `env`.
 */
const CONCH_VARS = /^CONCH_/;

/**
 * Claude Code's background model calls whose output Conch never shows. Each
 * one spends the person's plan or key for nothing, so every Claude Code that
 * Conch starts has them off. Only defaults: a value the person set in Conch's
 * own environment wins. Nothing here touches the model, effort, thinking,
 * compaction or tools, so answers are the same (code.claude.com/docs/en/env-vars).
 */
export const QUIET: Readonly<Record<string, string>> = {
  // Terminal titles, and with them the small-model call that names the session:
  // there is no terminal, and Conch names its chats itself.
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  // Prompt suggestions, a call after every answer: Conch never shows them (the
  // SDK only hands them over with `promptSuggestions`, which Conch doesn't ask for).
  CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
  // Session recaps for someone who stepped away: drawn only in Claude Code's own
  // terminal screen; Conch's chat keeps everything on the page.
  CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '0',
  // Check-ins on Claude Code's own `/goal`: Conch's `/goal` is its own (it goes in
  // the system prompt, `conversations/goal.ts`) and shadows Claude Code's, which
  // never runs in a Conch chat.
  CLAUDE_CODE_GOAL_CHECKIN_MINUTES: '0',
};

export function childEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = { ...QUIET };
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || CONCH_VARS.test(key) || SESSION_VARS.some((re) => re.test(key)))
      continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
