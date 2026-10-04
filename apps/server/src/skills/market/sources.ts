/** Which places Discover asks (ADR 0070), for the way Conch runs. */
import { AnthropicSource } from './anthropic';
import { ClawHubSource, SkillsShSource } from './clawhub';
import { GitHubSkills } from './github';
import type { HttpDeps } from './http';
import { PretendMarket } from './pretend';
import type { MarketSource } from './types';

/**
 * `on`: Anthropic's skills on GitHub, ClawHub, and skills.sh (searched
 * through ClawHub's index, downloaded from GitHub). `pretend`: made-up skills
 * from memory, never online (the mock engine, end-to-end tests).
 */
export function marketSources(
  mode: 'on' | 'pretend',
  version: string,
  deps: Omit<HttpDeps, 'version'> = {},
): MarketSource[] {
  if (mode === 'pretend') return [new PretendMarket()];
  const http = { ...deps, version };
  const github = new GitHubSkills(http);
  const hub = new ClawHubSource(http);
  return [new AnthropicSource(github, deps.now), hub, new SkillsShSource(github, hub)];
}
