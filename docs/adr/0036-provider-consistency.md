# 0036 — Conch owns tool execution and the ChatGPT connection

- Status: accepted
- Date: 2026-10-02
- Amends: 0010, 0012, 0028 and 0031 (Codex exec limitations; API host capabilities)

## Decision

Claude Code keeps its existing Agent SDK integration. API engines and Codex share Conch’s validated host tool registry. `Capabilities.tools` describes host/files/shell/approval availability, and `ModelInfo.tools` preserves per-model tool support. Unknown API model tool support is conservative, not an invented universal capability. A chat-only model gets no tool definitions and an explicit notice before inference. User-authorized offline/limit fallbacks must preserve declared tool capabilities; no new provider, data destination or spending choice is invented.

The new file tools use canonical Read/LS/Write/Edit/Bash policy names, so existing taint, skill, approval and Undo paths apply. Every call validates arguments, consults the always-on guard, checks mode/approval and rechecks cancellation. Links and protected locations are refused. Reads are bounded; file writes are scoped to existing directories in the work folder. Trusted verification metadata lets task ledgers confirm actual read results or exact file-content digests, not model claims. A mismatching uncertain write stays unknown.

Commands use the maintained `@anthropic-ai/sandbox-runtime` (0.0.78), not a home-grown shell filter. The dependency is justified by cross-platform OS confinement already used by the Claude ecosystem. A separate short-lived Node worker owns each sandbox runtime, avoiding its process-global configuration crossing chats. Only process plumbing is inherited, not ambient API keys/tokens. Commands have no network, workspace-only writes, protected-location denial, bounded output/time and process-group termination. Sandbox startup failures never retry unrestricted. Linux dependencies are an explicit setup need and Health check; Windows is file/app capable but command-free.

## Codex and subscription sign-in

Use the documented stdio app-server RPC (`initialize`, `account/login/start` with `chatgptDeviceCode`, `account/read`, `model/list`, `thread/start`, `turn/start`, `item/tool/call`, `turn/interrupt`, `account/logout`). Codex owns OAuth and token renewal; Conch neither invents endpoints nor copies another app’s credentials. The device ceremony works for a remote host because the short code is entered on OpenAI’s page, not at the host’s localhost callback.

This is the supported **Codex-managed ChatGPT** route, not the separate SIWC dynamic-registration/Responses flow launched in September. The latter is documented, but unnecessary for using an existing ChatGPT subscription through Codex. Models/limits depend on the account. Account validation and catalog discovery do not prove inference entitlement; setup does not spend a token to pretend they do.

`CodexHome` owns a separate encrypted `codex.secrets.json` through Conch’s existing device sealer. Only a 0700 temporary process home contains plaintext auth while Codex needs it; its file is 0600, closed before re-sealing and removed afterwards. Runtime copies are excluded from backups, the encrypted store is a secret backup entry, and all locations are protected from agent tools. Refresh ownership is serialized per connection to prevent concurrent rotated-token writes. Other providers remain concurrent. Ambient CODEX_HOME, provider credentials and OpenClaw auth are never inherited.

Dynamic tools are an explicitly experimental app-server surface. The minimum supported CLI is 0.159.0. Codex native environment access, shell, web, apps, browsing, hooks and child agents are disabled; native tool requests for greater privileges are declined. Native execution stays read-only with protected paths denied. Useful actions go through the Conch dynamic registry, not an unguarded second path. Tool execution is serialized, duplicate call IDs refused, and event-consumption acknowledgments wait for manager taint/Undo processing before the next call.

Codex starts a fresh thread each turn because the current supported resume schema cannot replace persisted dynamic-tool definitions. The manager supplies its bounded full transcript via `conversationHistory`; this handles old exec-era chats as well. Tradeoff: more input tokens, but no stale app/permission capability retained by a native session. Requests never silently substitute a different model.

## Threat model and recovery

The model, skill text, web/app output and project files are untrusted. They cannot select credential homes, expand permissions, bypass a refused action, inherit provider keys or redirect the authentication URL. Sign-in pages are pinned to HTTPS auth.openai.com. Raw Codex stderr/RPC errors are not surfaced because they may contain credentials. RPC messages and tool arguments are bounded and validated. Cancellation closes the owned process and active shell process group; successful-looking text is not a successful turn unless `turn/completed` says completed. Revoked access, malformed transport, timeout and tool failures end with actionable errors.

This is not a defense against a malicious process with the same OS user, which can inspect this user’s active processes/files. File tools refuse symlink and hard-link targets and do not claim the workspace is an adversarial multi-user filesystem. The OS sandbox is the shell boundary. No live auth, paid model request, browser or full build is needed for the deterministic transport/permissions tests.

## Primary sources and local parity review

- [Codex app-server](https://learn.chatgpt.com/docs/app-server): managed ChatGPT device login, account validation, logout, dynamic tools, approvals and turn lifecycle. Protocol fields cross-checked with the installed CLI’s `app-server generate-ts --experimental` output, without reading credentials.
- [SIWC registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): distinguishes the new optional SIWC route from Codex-managed auth and explains catalog vs entitlement.
- [Anthropic sandbox runtime](https://github.com/anthropics/sandbox-runtime): maintained isolation API, prerequisites and platform behavior.
- [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): least privilege, per-action validation, separation of untrusted content and instructions.
- [OWASP secrets management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html): lifecycle, isolation, protected storage and avoiding secrets in logs.
- Local OpenClaw `openai-chatgpt-provider` and `openai-chatgpt-oauth.runtime` implementation reviewed read-only: its existing-subscription OAuth route and remote/manual return UX informed parity. No auth file or secret was read/copied.

## Verification boundary

The installed CLI passed a real isolated, signed-out `initialize`, `account/read` and environment-free dynamic-tool `thread/start` smoke check, without inference. An initial native-environment startup failed because this shared host denies Bubblewrap loopback namespace setup (`RTM_NEWADDR`). The supported `environments: []` thread and turn setting disables that native environment; it does not weaken a sandbox or enable native execution. This is enforced in protocol tests. Shell capability uses a cached real no-op OS sandbox probe, not merely executable discovery, so commands are omitted when kernel/container restrictions prevent confinement. Deterministic protocol, permissions, auth failure, cancellation, file and UI tests pass; real subscription login/inference still requires the user’s account.
