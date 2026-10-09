# 0068 — A welcome, not a task

- Status: accepted, amended 2026-10-09 (three screens; see [Amendment](#amendment-three-screens))
- Date: 2026-10-04
- Supersedes: [ADR 0039](./0039-first-useful-result.md) for onboarding (its verified first job
  stays as an API; onboarding no longer runs it)
- Goes with: [ADR 0010](./0010-providers.md) (providers), [ADR 0035](./0035-come-home.md)
  (come home), [ADR 0060](./0060-the-chat-knows-conch.md) (the chat offers what it needs)

## Context

ADR 0039 put a job first: before Conch knew your name, it asked what you wanted done, then had
you connect what that job needed and wait for a verified result. Trying it fresh:

- **Asking for a task is a strange first thing to say.** People opening an assistant for the first
  time want to be welcomed and shown around, not handed a form for work.
- **The jobs dragged in the hardest setup there is.** "Prepare me for today" and "Draft my
  follow-ups" opened the advanced Google connection in the middle of onboarding, with Google
  Cloud project steps, for a person who had been using Conch for thirty seconds.
- **Personality came last, as two forms**: an assistant name, a tone, custom instructions, then a
  name and a free-text "anything I should know?" box. Typing about yourself into an empty box is
  hard; most people skipped it, so Conch knew nothing.

Conch is meant to be the assistant anyone can set up. The first minute should feel like meeting
someone, and ask only for what it can't work out.

## Decision

The welcome is a handful of moments, one calm thing on screen at a time:

1. **Hello.** The pearl, "Hi, I'm Conch.", one line about what Conch is, one button, and one line
   about where things are kept.
2. **Your name**, typed large as the screen's only field. Enter carries on; it can be skipped.
3. **What you'd like a hand with**, as chips to tap: writing, coding, research, email and calendar,
   planning, work, learning, ideas, home and life. They become one sentence in "About you" ("I'd
   mostly like a hand with coding and research."), which every provider reads in every chat and
   the person can edit in Settings. Running the welcome again replaces that sentence, never what
   they wrote themselves.
4. **How it should sound**: the four voices, each heard as a message from the assistant that writes
   itself out to the person by name as it's chosen.
5. **A mind to think with**: the provider setup that already finds what's on the computer, carrying
   on by itself once one works. It can be put off.
6. **The apps you live in**: up to nine apps that connect in a press or two (a sign-in, or Gmail's
   app password), the ones the picks call for first, each opening its usual connection. Google
   Calendar and Drive need a Google Cloud project of your own, so they are left to Apps, where
   that's explained. Skipping is fine: the chat offers an app when it would help (ADR 0060).
7. **Come home**, only when another assistant is found (ADR 0035).
8. **Ready**: "You're all set, Ada.", with three things to ask first made from the picks. One opens
   a chat with those words in the composer, ready to send or change; **Open Conch** opens an empty one.

Each answer is saved as the person moves on, so a reload carries on from the same step (kept in
session storage) with what they said. The assistant's own name and custom instructions are no
longer asked: they're in Settings for those who want them.

### How it moves

The welcome is built from Nacre's `Welcome` pattern: `WelcomeStage` (one moment, centred),
`WelcomeRise` (its lines surface a beat apart, so a screen arrives like a sentence being said),
`WelcomeBackdrop` (a pearl dawn that drifts and warms as the person goes, on a registered custom
property so it eases between steps), `WelcomeSteps`, `WelcomeName`, `WelcomeChoices` (a toggle
group: one tab stop, arrows, Space), `WelcomeVoice` (`StreamingText`), `WelcomeApps` and
`WelcomeStarters`. Everything moves on Nacre's springs, and is still and complete under reduced
motion or `data-nacre-motion="reduced"`.

## Consequences

- Getting started is a name, a few taps and one connection, about a minute, and nothing on the way
  needs a Google Cloud project.
- Conch knows what the person cares about from the first chat, in words they can see and change.
- The first job's verified-result machinery (ADR 0038, 0039) stays as an API, but nothing in the app
  starts it any more; it can be removed separately, or brought back as a starter that needs it.
- The journeys (`e2e/ready.spec.ts`, `import.spec.ts`, `signed-out.spec.ts`,
  `not-installed.spec.ts`) walk the new welcome; `e2e/app.ts` `toProviders` skips to the provider
  step for the ones about providers.

## Amendment: three screens

- Date: 2026-10-09

Six to nine screens was still too many before the first chat. Each one was skippable, but every
skip is a decision, and most of what was asked has a better moment later, in the chat
(ADR 0060). The welcome is now three screens:

1. **Hello and your name**, together: the pearl, "Hi, I'm Conch.", "What should I call you?" with
   the name field, **Let's begin** (an empty name is fine), and the line about where things stay.
2. **A mind to think with**, as before: carries on by itself once a provider works, or
   **I'll do this later**.
3. **Ready**, as before, with three things to ask first.

What was dropped, and where it went:

- **What you'd like a hand with** is no longer asked. Nothing new is written into "About you".
  A sentence an earlier welcome wrote still picks the starters (`interestsIn`); otherwise they are
  the three for anyone.
- **Who it is** (name, face, voice) is no longer asked. The first agent keeps its defaults (Conch,
  warm) and Settings → Agents changes them.
- **The apps you live in** is no longer a screen. The new chat's "Connect Gmail, Notion, GitHub
  and more" line and the chat's own offers (ADR 0060) carry it.
- **Come home** (ADR 0035) and **your past chats** (ADR 0111) are offered on the new chat
  instead, one quiet line each under the composer (`features/import/BringHints`), only while
  there's something to bring, each opening its place in Settings → Memory where nothing moves
  until the person says so.

Progress shows three dots on every screen; Back appears from the second. A step remembered from
the longer welcome starts again at the hello. `WelcomeChoices`, `WelcomeApps` and the
assistant step's pieces stay in Nacre (Settings → Agents and the new-agent dialog use the
voice and face pickers).
