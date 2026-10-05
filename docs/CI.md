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
CI uses the explicit `chromium` channel (the full browser's headless mode), with
`playwright install --with-deps --no-shell chromium`. Omitting the channel selects
the separate Headless Shell, which crashes on these pages. A local override is
not validation of the CI browser: reproduce with `CI=1` and `CONCH_TEST_BROWSER`
unset. Server unit runners also install full Chromium for their real CDP fixture.

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

## Follow-up: the first sharded hosted run

[Run 37376545092](https://github.com/georgevibing/conch-agent/actions/runs/37376545092)
on `ca5772b5` failed. Static checks, Nacre, the web/docs/protocol/desktop unit group,
and server shard 2 passed. All four browser shards and server shard 1 failed;
the aggregate correctly refused success. Desktop passed only after a retry.

- **A regression introduced by the CI change:** leaving out the browser channel
  selected Chromium Headless Shell 153.0.8010.12. The browser shards reported
  108 failed tests, with repeated `Target crashed`/`Page crashed` errors. Local
  validation had substituted a full Chrome executable and therefore failed to
  validate the actual CI runtime. The crash reproduced locally with the original
  CI configuration. The correction explicitly selects `channel: 'chromium'` and
  installs only the matching full Chromium build. This follows Playwright's
  [documented new headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
- **A fragile external-browser fixture:** `browser/backends.test.ts` spawned the
  runner's Chrome directly and waited ten seconds for a port file. The fixture
  never became ready; all assertions in that suite were blocked. It now prefers
  the installed Playwright Chromium and launches a persistent context through
  Playwright, then exposes CDP to Conch. Launch readiness and process shutdown
  are awaited. The tests still verify that Conch leaves the fixture's own tab and
  browser alive after disconnecting.
- **Desktop's early keypress was still unreliable:** the retained trace showed
  `hello` left in the composer, no chat created, and no send after Enter. Waiting
  for DOM focus had not solved it. The packaged desktop smoke test now clicks its
  visible Send button, which auto-waits for readiness. Enter-to-send coverage
  remains in browser journeys and Composer component tests.

The hosted run started its jobs after about five minutes queued; server shard 2
finished after roughly 5 min 18 s of execution. Fast failure in the browser shards
is not a speed benchmark for successful browser coverage.

Correction checks: the original CI configuration reproduced the crash locally;
the corrected configuration passed all 35 tests in shard 2 with `CI=1` and no
executable override. All eight backend tests passed, and the packaged desktop
chat passed five consecutive runs with retries disabled. Hosted validation must
still run every job on the pushed revision before calling the correction green.

## Hosted validation and the next revision

[Run 37379268078](https://github.com/georgevibing/conch-agent/actions/runs/37379268078)
on `4fe04e0d` passed all eleven jobs, including the final gate. All 152 browser
journeys and seven desktop journeys passed without retries. The workflow took
6 min 29 s from creation to completion, compared with about 35 minutes of check
execution in the earlier green run. This is one measured result, not a guarantee
about runner availability or future timing.

Main then advanced with the security follow-up. Its
[run 37380076577](https://github.com/georgevibing/conch-agent/actions/runs/37380076577)
exposed two more failures:

- The new Gmail account-generation test compared whole verification scopes from
  successive calls. Each scope intentionally expires one hour from the call;
  the two expiry timestamps differed by one millisecond. The test now compares
  the account and authorization identity, and still requires reconnection with
  the same password to change the authorization identity.
- The first browser journey timed out waiting for its panel. The trace confirmed
  that the message was sent and Conch was still in the `starting` browser phase,
  selecting `/usr/bin/google-chrome-stable`. The remaining four browser journeys
  passed. CI now chooses the installed, locked Chromium for Conch's browser as
  well as the Playwright driver, and asserts that selection. The first panel wait
  allows 30 seconds for cold startup (which launches twice to remember the user
  agent); subsequent UI assertions retain their ten-second bound. Browser
  discovery and fallback remain covered by the server tests.

No test was removed, no retry was added, and the aggregate gate correctly rejected
the two failing jobs. A green revision does not establish that later changes are
green; the exact current main revision must finish all checks.

## Email recovery: the page lost a live update

[Run 37381720109](https://github.com/georgevibing/conch-agent/actions/runs/37381720109)
passed all static and unit jobs, desktop, and three browser shards. Shard 4 failed
on email revocation, so its dependent browser-control project did not run.

The trace established that the channel was online before revocation. The server
then reconnected, detected the refused password, and delivered `channel.changed`
with `health.state=needs-token` over the page's socket about one second later.
The page nevertheless remained on **Reconnecting** for its entire twenty-second
wait. Waiting for the initial handshake had fixed a fixture precondition, but
had not fixed this separate client-side race.

Channel events arriving before the initial list populated the query cache were
discarded; invalidating an already pending initial query did not fetch it again.
A live change during a later refetch could also be overwritten by that request's
older response. Channel queries now retain changes and deletions received during
each fetch and fold them into its result. The complete catalog still comes from
the response, and existing views receive live changes immediately.

Four controlled regression cases failed before this fix and pass afterwards:
changes and deletions during both initial loading and refetching. The existing
channel UI tests also pass. This repairs actual stale UI state without removing
the revoked-password recovery journey or increasing its timeout.

The full local shard also exposed a chat-list setup race: the second message was
typed immediately after **New chat**, while the old composer could still be
mounted. The trace showed the first chat completed, then a blank new-chat view
with the second message lost. That journey now waits for the new-chat URL and
composer focus before typing. Its list, folder, drag and archive assertions stay
the same.

Running the full web suite after local midnight revealed another clock-dependent
fixture: chat-list tests labelled `Date.now() - one hour` as **Today**, although
it was yesterday. Those date-grouping tests now fix only the Date clock at noon;
interaction and query timers remain real. The assertions still check the actual
Today and month groups.
