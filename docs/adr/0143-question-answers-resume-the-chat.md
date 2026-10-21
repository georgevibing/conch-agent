# 0143: Question answers resume the chat

- Status: accepted
- Date: 2026-10-21

## Problem

A question's answer only resolved the promise returned by `ask`. If inference
had ended, resolving that promise did not give the assistant a new turn. A
normal turn finish also skipped unanswered questions, and the transcript disabled
cards whenever the chat was idle.

## Decision

QuestionDesk distinguishes an attached waiter, a detached question and explicit
cancellation. A natural finish detaches only that turn's question, releases its
orphaned waiter with a still-waiting result, and retains the card. Stop and
deletion cancel without continuation. Restart retains the existing skip behavior.
A tool arriving after its turn ended is detached as soon as it asks.

An attached answer continues through the existing tool result. A detached answer
calls its chat's continuation hook with canonical validated words. An idle chat
starts a reply through the existing wake path. A busy chat receives the answer
at its next host-update boundary, the same hook every provider uses for resource
feedback and messages from other chats. If the reply finishes without reading it,
the answer starts one subsequent reply. A send still being admitted goes first.
Stopping clears queued answers. Card presses invent no user messages; typed
answers retain the person's message.

Open unanswered cards stay enabled independently of turn activity. The server
remains authoritative for validation and duplicate rejection.

## Boundaries and verification

The existing authenticated, same-origin answer route validates field values and
regenerates their labels. Answers cannot resolve permission prompts, change a
mode, bypass a tool guard or authorize another chat. No endpoint, stored power,
permission or security-checkup option is added. Detached questions remain in-memory
state, not a new backup file.

Tests cover attached delivery, idle card and typed answers, busy delivery with
and without a boundary, duplicates, Skip, Stop, restart, and tools arriving after
their turn closes. The web regression ends inference before choosing an answer.

Sources read on 21 October 2026:

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): preserve authenticated user-action boundaries.
- [MCP security best practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices): keep tool authority separate from conversational content.
