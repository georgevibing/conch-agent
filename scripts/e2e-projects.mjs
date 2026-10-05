/**
 * Partition whole journeys before Playwright creates webServer processes.
 * Playwright's --shard divides tests after loading the config: using it alone
 * would still start every gateway on every runner, and expand dependencies.
 * Keep every test in a project together: some journeys share an installed app.
 *
 * @param {string[]} names
 * @param {{ argv?: string[], only?: string, shard?: string }} options
 */
export function selectProjects(names, { argv = [], only, shard } = {}) {
  const requested =
    only
      ?.split(',')
      .map((name) => name.trim())
      .filter(Boolean) ?? [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) requested.push(arg.slice('--project='.length));
    if (arg === '--project') {
      const start = requested.length;
      while (argv[i + 1] && !argv[i + 1].startsWith('-')) requested.push(argv[++i]);
      if (requested.length === start) throw new Error('--project needs a project name.');
    }
  }
  const matches = requested.map((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    const found = names.filter((name) => new RegExp(`^${escaped}$`, 'i').test(name));
    if (!found.length) throw new Error(`Unknown E2E project: ${pattern}`);
    return found;
  });
  let selected = requested.length ? names.filter((name) => matches.flat().includes(name)) : names;
  if (shard) {
    const parsed = /^(\d+)\/(\d+)$/.exec(shard);
    const index = Number(parsed?.[1]);
    const total = Number(parsed?.[2]);
    if (!Number.isSafeInteger(total) || index < 1 || index > total)
      throw new Error(`CONCH_E2E_SHARD must be INDEX/TOTAL (1-based), received: ${shard}`);
    selected = selected.filter((_, i) => i % total === index - 1);
  }
  if (!selected.length) throw new Error('No E2E projects selected. Check the project and shard.');
  return new Set(selected);
}
