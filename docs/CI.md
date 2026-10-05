# CI: dependable checks and useful failures

`pnpm check` runs formatting, repository tooling tests, lint, types and every unit
suite locally, with bounded concurrency. Browser journeys and desktop journeys
also run in GitHub Actions. The workflow keeps the name **CI** and a final
**check** job that succeeds only when every required job succeeds. Website
publication continues to require the successful whole workflow.

## Running and diagnosing

```sh
pnpm check
pnpm e2e
pnpm exec playwright test -c e2e/playwright.config.ts --project=channels-mail
CONCH_E2E_SHARD=1/4 pnpm e2e
pnpm desktop:e2e
```

The direct Playwright command uses the existing web build; build it first after
changing the web app. Local journeys normally use installed Chrome; set
`CONCH_TEST_BROWSER` to another Chromium executable if needed. CI installs the
Chromium version matching the locked Playwright package. The gateway's own
browser tests still exercise Conch's browser discovery and healing.

- **Static checks/builds:** formatting, installer/tooling tests, lint, types,
  Storybook and the documentation build.
- **Unit tests:** the server split into two Vitest shards, Nacre on its own runner,
  and web/docs/protocol/desktop on another. At most two Vitest workers per runner;
  the last group runs one workspace at a time.
- **Browser journeys:** four project shards, two workers each. Selection happens
  before `webServer` creation, so a runner starts only its 13–14 gateways rather
  than all 54. Every project's tests stay together. `--project=browser` now starts
  just that gateway; during a full shard the browser runs after its neighbours.
- **Desktop:** the packaged layout and real Electron, separately. Its existing
  retry remains visible, with retained traces even when the retry succeeds.

Use `CONCH_E2E_SHARD`, not Playwright's native `--shard`, for these journeys.
Native sharding happens after config evaluation, so it would still start all the
configured servers, and project dependencies could expand the work. The selection
tests reject invalid names/shards; `--list` across all four shards was also checked
against the complete test list: all 151 tests appeared exactly once.

Matrix jobs use `fail-fast: false`: one failure does not cancel unrelated results.
The final gate rejects failed, skipped or cancelled dependencies. New pushes still
cancel obsolete runs on the same branch. Explicit job timeouts bound hangs.
Ubuntu 24.04 is pinned to avoid silently moving the test environment with the
`ubuntu-latest` label.

Download `e2e-results-N` for its HTML report, failed screenshots and traces.
Download `desktop-e2e-results` for desktop diagnostics, including failed attempts
that passed on retry. Unit jobs print directly to their own logs instead of hiding
one workspace's output inside a long Turbo run of the entire repository.
Electron's manually launched context records its trace explicitly; the normal
Playwright page-fixture trace setting does not start recording that context.

## Audit: 5 October 2026

Snapshot: **08:43–22:43 Europe/Berlin (06:43–20:43 UTC)**. All 23 CI runs in that
window were inventoried, their job/step outcomes inspected, and full logs read for
the completed test runs. Screenshots/page snapshots and network traces were
examined for the recurring email and Discover failures. The one run without a
check log was investigated through its check annotations.

**14 failed, 7 cancelled, 1 succeeded, 1 still running.** The single green run was
the release-aware-site PR; no completed main CI run was green in this window.
Other workflow names were counted separately: successful Website and Push on main
runs are not evidence that CI passed, and skipped Evals are not failed tests.

### Failure patterns

| Cause                                                                     |                       Runs affected | Evidence and disposition                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporary test home deleted while a chat still persisted its final writes |                                   6 | Every assertion passed, but Vitest caught an unhandled `ENOENT` in `learn-gateway.test.ts`, writing `conversations/*.jsonl` or `index.json`. The fix already landed in `25e39552`: wait for the interrupted turn's persisted completion before cleanup. Keep the test.                                                      |
| Release journey asserted the previous Settings flow                       |                                   6 | It expected the update card under Settings after **What's new** had begun opening a dedicated dialog. This was deterministic test drift, not a timeout flake. Already corrected by PR #11 (`24993e4f`); the successful PR and subsequent main run passed those journeys.                                                    |
| Rollback journey depended on the previous test having installed 0.2.0     |                              Same 6 | The second error, expected 0.2.0/received 0.1.0, was fallout from the first. Declare the deliberately shared release scenario serial, so a failed prerequisite skips rollback instead of creating a second apparent root cause.                                                                                             |
| Email revocation raced the background connection handshake                |                                   2 | POST creates the channel, but the inbox connection starts asynchronously. The trace revoked it immediately; the failed page showed **Reconnecting**, not an authentication refusal. Wait for `health.state=online` before revocation; reset mock credentials before each test so a failed repair cannot poison later tests. |
| Discover's search debounce overwrote navigation to a skill                | 1, alongside release/email failures | The trace requested the wallet listing, then searched `q=wallet`, returning to the shelf before preview. Cancel the timer synchronously on selection and allow search navigation only on the shelf route. Add deterministic regression tests with the debounce held pending. This fixes user-visible behaviour.             |
| GitHub could not acquire a hosted runner                                  |                                   1 | Check annotation: “The job was not acquired by Runner of type hosted even after multiple attempts.” No test executed in that check job. This is infrastructure failure, not a source regression.                                                                                                                            |
| Desktop's first chat attempt timed out, then passed on retry              |           2 successful desktop jobs | Both waited for “Ask me to” after pressing Enter. Visibility alone was the readiness check. Wait for composer focus, as the browser helper already does, and retain failed-attempt evidence. A lost early keypress is a likely cause; historical logs alone do not prove it.                                                |

The rows overlap: the release failure and its dependent rollback are one cause;
one run also had both the email and Discover failures. There were **13 failed test
runs plus one infrastructure failure**, not 14 unrelated regressions. The seven
cancelled runs were superseded work, not seven more demonstrated test failures.

### Every failed run

Times are UTC; links retain the exact revisions and full GitHub logs.

| Started | Run                                                                                 | Observed cause                                                     |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 06:55   | [37274936691](https://github.com/georgevibing/conch-agent/actions/runs/37274936691) | Learning test cleanup                                              |
| 07:47   | [37279763404](https://github.com/georgevibing/conch-agent/actions/runs/37279763404) | Release UI drift + dependent rollback                              |
| 08:38   | [37284879988](https://github.com/georgevibing/conch-agent/actions/runs/37284879988) | Release UI drift + rollback; email revocation; Discover navigation |
| 09:51   | [37292777718](https://github.com/georgevibing/conch-agent/actions/runs/37292777718) | Learning test cleanup                                              |
| 10:27   | [37296738618](https://github.com/georgevibing/conch-agent/actions/runs/37296738618) | Learning test cleanup; desktop first attempt also failed           |
| 10:51   | [37299249989](https://github.com/georgevibing/conch-agent/actions/runs/37299249989) | Release UI drift + dependent rollback                              |
| 12:30   | [37310036075](https://github.com/georgevibing/conch-agent/actions/runs/37310036075) | Learning test cleanup                                              |
| 12:57   | [37313119315](https://github.com/georgevibing/conch-agent/actions/runs/37313119315) | Learning test cleanup                                              |
| 13:37   | [37318196456](https://github.com/georgevibing/conch-agent/actions/runs/37318196456) | Release UI drift + dependent rollback                              |
| 14:15   | [37323217386](https://github.com/georgevibing/conch-agent/actions/runs/37323217386) | Release UI drift + dependent rollback                              |
| 15:18   | [37331695896](https://github.com/georgevibing/conch-agent/actions/runs/37331695896) | Learning test cleanup; desktop first attempt also failed           |
| 16:06   | [37338263750](https://github.com/georgevibing/conch-agent/actions/runs/37338263750) | Release UI drift + dependent rollback                              |
| 19:01   | [37360403976](https://github.com/georgevibing/conch-agent/actions/runs/37360403976) | Hosted runner not acquired                                         |
| 19:05   | [37360811235](https://github.com/georgevibing/conch-agent/actions/runs/37360811235) | Email revocation                                                   |

Comparison: [successful PR run](https://github.com/georgevibing/conch-agent/actions/runs/37343981645).
The final main run [37370695533](https://github.com/georgevibing/conch-agent/actions/runs/37370695533)
was still running at the snapshot; its result is not counted as known here.

### Time spent and changes

The completed green run took **35 minutes of check-job execution** and waited
about **95 minutes for that runner to start**. Queue time and execution time are
different problems. Sharding reduces execution time; it cannot promise a fix for
GitHub's runner availability.

Across completed check jobs, step medians were:

| Step               |      Median | Interpretation                                               |
| ------------------ | ----------: | ------------------------------------------------------------ |
| Dependency install |         6 s | Already cached well; not the bottleneck.                     |
| `pnpm check`       | 15 min 26 s | Includes early failed runs. The green run took about 17 min. |
| Storybook build    |        15 s | Small compared with tests.                                   |
| Docs build         |        28 s | Small compared with tests.                                   |
| `pnpm e2e`         | 14 min 58 s | Includes build, gateway startup, tests and teardown.         |

The successful run spent roughly 8 min 15 s on server unit tests, 3 min 12 s on
web tests, 2 min 38 s on Nacre and 26 s on docs, serialized. Separate runners and
two server shards remove that serial sum. Browser test durations sum to about
25 minutes across the two workers, before startup/teardown. Four project shards
reduce per-runner work and idle gateway pressure. Using historical test durations,
the four shards contain approximately 464/319/358/338 seconds of test work,
before two-worker scheduling. **Actual hosted speedup must be measured after the
workflow runs**; those sums are not wall-clock promises.

### What to keep, what to change next

- Keep release signature/refusal/rollback, revoked-password recovery and learning
  persistence coverage. They assert important behaviour; deleting them would hide
  actual regressions. No failing test was disabled to make the gate green.
- Do not add blanket retries or sleeps. Establish fixture state explicitly, await
  completion before cleanup, and use fake time for deterministic debounce races.
  A retry that succeeds is still evidence to investigate.
- Keep isolation for unit files: this repository has mutable environment variables,
  mocks, sockets and temporary homes. Turning isolation off for speed risks making
  order dependence worse. Do not raise worker counts indiscriminately on one runner.
- Centralize fixture shutdown as more tests are touched: `Services.stop()` requests
  several asynchronous stops without draining all work. Tests that start a turn
  must await its completion before removing its home, including interruption paths.
- Fix or revert a known deterministic failure before stacking unrelated main pushes.
  A broken release assertion persisted across six completed runs, making the later
  red runs much less useful.
- Protect main with the final **check** status and require it before merging. The
  branch-protection endpoint reported no protection during this audit; repository
  rulesets were not audited. No remote settings were changed.
- After deployment of this workflow, compare queue time, runner minutes, execution
  time and failed first attempts across a meaningful sample. Add caching or rebalance
  shards only where those measurements show a bottleneck.

Implementation references: [Playwright sharding](https://playwright.dev/docs/test-sharding)
and [fixture lifecycle](https://playwright.dev/docs/test-fixtures).

### Local verification and limits

- `pnpm check` passed: formatting, 41 tooling tests, lint, types and all six unit
  suites. Server, docs and desktop tests ran fresh; web, Nacre and protocol used
  valid Turbo cache entries. The fresh server run passed 4,552 tests, with 18
  existing skips. Earlier overlapping local runs were interrupted after timeout
  failures under load; the complete bounded run passed without those failures.
- Discover's eight unit tests passed, including two deterministic pending-debounce
  navigation regressions. The six email/Discover browser journeys and both signed
  release/rollback journeys passed.
- All seven packaged desktop journeys passed. After adding explicit Electron
  tracing, the chat smoke test passed again; an intentional failure in a temporary
  copy outside the repository produced a screenshot and a trace containing page
  snapshots and screenshot frames.
- Workflow validation with actionlint passed. The complete Playwright test list
  and the four shard lists matched exactly, without omissions or duplicates.
- The live fourth shard exposed an additional macOS fixture issue: `tmpdir()` used
  the `/var` alias while file access compared canonical `/private/var` roots. The
  Office attachment was refused by the guard. E2E temporary roots now use
  `realpathSync(tmpdir())`, matching the guard and the Linux fixture layout.
  The complete fourth shard then passed all 35 tests in 2.2 minutes, including
  browser control, email recovery and Office attachments. This is a local result,
  not a hosted-runner benchmark.

These checks ran locally on macOS. The changed hosted workflow has not run yet;
its Linux results, queue behaviour and execution-time improvement remain to be
measured. The full 151-test browser suite was enumerated, not rerun in its entirety.
