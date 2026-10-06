# 0096 — Bounded browser steps

- Status: accepted
- Date: 2026-10-06

## Decision

Every provider's Conch browser tools share an active-work deadline of two minutes.
Approval, password-unlock and explicit user-control waits pause that budget and
show their reason in the existing browser trail. Resuming a wait consumes the
remaining budget rather than starting a fresh one. Stop remains effective during
both execution and human waits.

Only one browser step per conversation runs at a time. Queued steps say what they
are waiting for. On an active timeout or Stop, Conch requests closure of that
conversation's tabs, rejects late continuations and does not replay the action.
Another browser step cannot create replacement tabs until closure is confirmed.
A blocked stop is reported through browser status and Repair everything.
A failed close stays blocked until browser repair; it never silently resumes an
uncertain action. Other conversations and the user's unrelated Chrome tabs are
not closed. A human wait cancelled by Stop leaves the user's browser open.

The result says an action may already have reached the site and asks the agent to
inspect before repeating it. A timeout cannot undo a purchase, message or other
remote effect. Existing origin, secrets, permission and taint checks still apply.

## Verification

Fake-clock tests cover deadlines, paused budgets, Stop and late results. Tool
integration tests cover stuck page reads, delayed approvals, cancellation and
no replay. Browser trail stories and accessibility tests cover the waiting state
in both themes. Existing browser interaction and security tests remain required.
