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

export function childEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
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
