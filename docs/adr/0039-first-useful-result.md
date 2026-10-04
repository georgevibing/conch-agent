# 0039: A useful result before personalization

- Status: superseded for onboarding by [ADR 0068](./0068-a-welcome-not-a-task.md); the
  verified first-job task and its API remain
- Date: 2026-10-02
- Builds on: 0036 (provider capabilities), 0037 (Google accounts), 0038 (verified tasks)

## Decision

Onboarding has three essential steps: choose a job, connect a suitable provider,
and review its result. Import, personality and profile questions come afterwards
and are optional. An explicit **Explore on my own** escape remains available;
skipping does not claim that any job succeeded.

The three starter jobs are:

| Job                  | Input                                          | Authorized actions                                                      | Required evidence                                                               |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Make a useful brief  | Pasted notes or a small text/Markdown/CSV file | Create one Conch artifact                                               | Read back the exact saved document                                              |
| Prepare me for today | One selected Gmail and Calendar account        | Read sources; create one briefing                                       | Successful mail search, calendar read and saved-document receipt                |
| Draft my follow-ups  | One selected Gmail account                     | Read sources; save up to three approved reply drafts; create one report | Mail search and saved report, plus a receipt for every draft described as saved |

No starter job can send mail, run commands, use arbitrary integrations, delegate
work or change existing files. Tool names, account, per-tool limits and required
receipts are chosen by the server, not supplied by a model or browser request.
Each job receives only its bounded tool scope. Read calls are limited to ten per
tool per goal revision; artifact creation is limited to one and drafts to three.

## Provider and account consistency

The chosen model must explicitly support Conch host tools and be connected before
the job starts. Both the UI and server check this. Conch never silently switches
provider, sends source notes to a different account or invents a fallback model.
Changing the provider in onboarding preserves the user's unsent notes in memory.

Google sign-in stays inside the job flow. Account identity and requested access
are visible. An interrupted job offers reconnection for the same account and an
explicit **Continue from saved progress** action. The scope cannot change to a
different account while resuming. An operator must first register a Google OAuth
application; the setup UI and direct connector do not eliminate this external
provider requirement.

## Durable progress, not a finished-looking animation

`POST /api/first-job` validates the strict protocol schema and uses a client
request ID as the task idempotency key. Changed input gets a new ID; retrying a
lost response uses the same ID. The server refuses a second starter job while
one is active. `GET /api/first-job` recovers the saved task after reload.

The page subscribes to the task's conversation for approvals and polls the saved
task state. **Ready to review** requires `done` and `verification: verified`.
Model completion without required receipts is not presented as success. Partial
results remain inspectable and the task can be continued in its original chat.

Artifact creation uses a stable operation-derived ID, checks duplicate content,
syncs saved content and metadata, and verifies the actual bytes on readback.
Fenced model output cannot create an artifact in a task conversation, because
that would bypass its scope and effect ledger. Verified storage is not a claim
that every sentence in a model-written document is factually correct: the user
still reviews the content and its sources.

Approvals display the exact draft account, recipients, subject and plain-text
body. Untrusted markup is inert. Starter approvals do not offer **Always allow**.
Saving a Gmail draft and sending an email remain different actions; sending is
not exposed by the connector or these jobs.

## Data and limits

Unsent notes stay in component memory, not browser local storage. Only the chosen
job kind is remembered in session storage. The source limit is 12,000 characters;
the file picker accepts text, Markdown or CSV up to 48 KB before applying that
character limit. PDF, DOCX and OCR extraction are not implied by this first path.

The welcome and profile screens distinguish local storage from processing by a
cloud model. The result page links verified receipts and embeds the saved artifact.
Finishing sets the onboarding flag and opens the actual task conversation.

## Verification

Focused tests cover strict request boundaries, unsupported models, account/scopes,
bounded actions, idempotency, lost HTTP responses, interrupted reloads, deliberate
skip, deferred personalization, inert accessible draft previews, exact artifact
readback and the fenced-output bypass. Mock E2E journeys exercise the real task
and artifact service. They do not establish live Google consent or paid-provider
quality; those require credentials and a separate live acceptance run.
