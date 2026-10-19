# 0138 — Phone calls on the SMS number

- Status: accepted
- Date: 2026-10-19
- Amends: [ADR 0076](./0076-sms.md) (the number takes calls too), [ADR 0045](./0045-teams-matrix-wechat.md) (the public door takes a WebSocket), [ADR 0108](./0108-the-phone-without-native-apps.md) (one more place a lock-screen-safe step can be allowed)

## Context

The Twilio number Conch texts from (ADR 0076) is a phone number. People
asked for two things it could do:

1. **Call your assistant** while driving: talk, hear the answer, hands-free.
2. **Get a call when an OK is waiting** and you haven't seen the notification,
   and answer it there.

What Twilio offers (checked 2026-10-19, twilio.com/docs):

- **A call** to the number goes to its `VoiceUrl`, signed with
  `X-Twilio-Signature` exactly as a text is (HMAC-SHA1 of the full address,
  query included, and the sorted form fields). Inbound calls in the US carry
  `StirVerstat`, the carrier's SHAKEN/STIR verdict on the caller ID.
- **TwiML** says what happens next: `<Gather input="speech dtmf">` hears words
  (Twilio's recognizer) or keys, `<Say>` speaks with Twilio's voice,
  `<Redirect>` moves on, `<Connect><Stream>` hands the call's audio to a
  WebSocket.
- **Media Streams**: `<Connect><Stream>` opens a bidirectional WebSocket to an
  address of yours. Twilio sends 8 kHz μ-law, 20 ms a message, plus `start`,
  `mark`, `dtmf` and `stop`; you send audio back, `mark` to know when it
  played, and `clear` to stop it at once. The handshake carries
  `X-Twilio-Signature`; custom `<Parameter>`s arrive in `start`. When the
  socket closes, the call carries on with the TwiML after `<Connect>`.
- **Placing a call** is `POST Calls.json` with `TimeLimit` (seconds) and
  `MachineDetection` (an answering machine is told apart in `AnsweredBy`).
- It costs: about 1 cent a minute to receive and 1.4 cents to place in the
  US, a little more for machine detection. Twilio reports a call's price
  only later, and Conch's own prices (`usage/prices.ts`) are for models.

## Decision

**Calls are part of the SMS channel**, on the same number, the same door and
the same signature check. Two switches on the channel's page, both off until
the person turns them on (`ChannelSettings.calls`, `@conch/protocol`
`phone-calls.ts`); turning either on needs this computer or a fresh sign-in.

### Calling your assistant

- Conch points the number's `VoiceUrl` at the channel's hook once **Answer
  your calls** is on, as it points `SmsUrl` (ADR 0076).
- **Only the owner's number** (the first person let in) gets the assistant.
  Any other caller, and the owner's number when `StirVerstat` says the caller
  ID failed, hears one fixed sentence and the call ends: no model turn, no
  request, nothing kept. With calls off, a stranger's call is rejected (no
  charge) and the owner hears how to turn calls on.
- **And only once it's surely the owner** (amended the same day, see
  "Security"). The owner's number counts as the owner only when `StirVerstat`
  is `TN-Validation-Passed-A` (full attestation: the carrier knows the caller
  and that they may use the number), or after the caller keys the **call
  passcode**. Until then nothing is heard, said, streamed or claimed: the
  call is answered with `<Gather input="dtmf">` ("Enter your call passcode,
  then press the pound key"), before any `<Connect><Stream>`, so it works the
  same with Media Streams and with Gather. B, C, no verdict, or anything else,
  without a passcode set, hears "I can't confirm it's you calling, so I can't
  help on this call" and the call ends.
- **The passcode** is 6 to 12 digits, set on the number's page (`PUT
/api/channels/:id/call-passcode`, `SetCallPasscodeBody` on both sides;
  this computer or a fresh sign-in, as for turning calls on). A digit
  repeated, a run (123456, 987654) and part of the owner's or the Twilio
  number are refused (NIST SP 800-63B-4's blocklist of values an attacker
  tries first). Only its scrypt hash is kept (`auth/secrets.ts`
  `hashPassword`, N=2^17, r=8, p=1), in `calls.secrets.json`: sealed under
  the device key, protected from the agent's own file tools, backed up as a
  secret. The page learns only `callPasscode.setAt`. Keys are checked with
  `verifyPassword` (`timingSafeEqual`); anything that isn't 1 to 12 digits is
  wrong without being hashed.
- **Bounded tries.** Three wrong passcodes end a call; a silence asks once
  more and then ends it, without counting. Five wrong ones in a day
  (`ChannelCallUsage.passcodeFails`, on the person's clock, counted in
  `channels.json` before the call hears it was wrong, so a restart gives
  none back) lock calls the carrier doesn't vouch for until tomorrow: no more
  tries, right or wrong, and the owner is texted on the number and notified
  on their devices (the `devices` topic). Setting a new passcode lifts the
  lock: the person chose it.
- **The call is the owner's SMS chat, by voice.** Each thing said becomes a
  message there, marked `spoken: 'a phone call'`, so it's read like a voice
  note's words (ADR 0077): a voice on a line can be anyone's. Answers are
  spoken instead of texted while the call lasts; a question with buttons is
  still texted (numbered, as on SMS) and the call says so. After the call,
  answers go by text again.
- **One call at a time**; a call ends after `maxMinutes` (10 by default, 30
  at most), after a few silences in a row, or after waiting 90 seconds for an
  answer ("I'll text you the answer").

### Media Streams first, Gather when it must

The preferred path keeps the audio on this computer (`calls/stream.ts`):

- the call is answered with `<Connect><Stream>` to `wss://…/hooks/<id>/stream`
  with a one-use ticket (32 random bytes; only its SHA-256 kept, 30 seconds,
  bound to the CallSid) as a `<Parameter>`;
- the door (ADR 0045) accepts the upgrade only after the hook checks Twilio's
  signature over the socket's address, and the socket only after its `start`
  names a call that expects it with that ticket; every message is checked
  with `TwilioStreamMessage` (Zod) and a flood is cut off;
- μ-law is decoded in memory (`calls/audio.ts`, G.711), an energy detector
  ends each utterance after 800 ms of quiet (30 s at most), the words are
  heard by whisper.cpp (`VoiceService.transcribe`, 16 kHz), and answers are
  spoken by the reply voice (`SpeechService.speak`, Piper) and sent back as
  μ-law, a few sentences at a time, cut to about 900 characters;
- **barge-in**: speech clearly louder than the line while Conch talks, or
  any key, sends `clear` and the next words are heard.

It's used when whisper.cpp, its model and a reply voice are ready. Otherwise,
or when the public address doesn't carry WebSockets (an own reverse proxy
without upgrades), the call falls back to `<Gather input="speech">` and
`<Say>`: Twilio hears and speaks. The fallback needs nothing from the
person: the TwiML after `<Connect>` redirects to it when the stream never
started, and it's a "Fixed on its own" note. Barge-in works there too
(`bargeIn` on `<Gather>`). Waiting for an answer is a short `<Pause>` and
`<Redirect>`, each step signed like any other.

### Conch rings you about an OK

- **Call me when an OK waits** (`calls/approvals.ts`): when a question has
  waited `after` minutes (5 by default) and is still waiting, Conch places a
  call from the number to the owner's, unless it's the owner's quiet hours
  (22:00–07:00 by default, the check-ins' own `QuietHours`) or the day's
  calls are used up (`perDay`, 3 by default, 10 at most). A call is counted
  before it's dialled, in `channels.json`, so a restart can't give a free one.
- **What a call may allow is what a lock-screen tap may** (`lockScreenCheck`,
  ADR 0108), asked of `PushService.approval` itself so the two never
  disagree, and asked again the moment the person answers. Such a step is
  read as one sentence ("It needs your OK to run the tests"), and **1** or a
  clear "yes" allows it, **2** or "no" denies it. Anything else, or anything
  unclear twice, changes nothing. A step a lock-screen tap may not allow is
  never read out: the call says "Something needs you in Conch" and allows
  nothing.
- **Bound to the call Conch placed**: the step's address names the call by a
  random id (not a secret: every step is signed), and only the CallSid Twilio
  returned, to the owner's number, from this number, is answered.
- `MachineDetection` is on: an answering machine hears only that something
  needs you. `TimeLimit` caps the call at three minutes.

### Whole Conch

A Repair everything check per number with calls on (the door, the owner,
the line; a warning when calls are answered without a passcode, with the
page's own words; and a passcode whose hash didn't come back, as after a
backup restored without its keys); a security checkup line for answering
calls that says what gets through; a `phone-calls`
backup power, so a restored backup names a number that answers or rings;
the person's today's calls and minutes on the page, with Twilio's price in
words (Conch can't price a call itself yet); ⌘K finds **Phone calls on
<number>**.

## Security

Threat model, by who can reach it:

- **The internet**, at the door: every webhook and the socket's handshake
  must carry Twilio's signature with this account's Auth Token, over the
  exact address with its query, in constant time; the account must be this
  one. Forged calls (another token, tampered fields, unsigned, another
  account) are tested to be 403s that reach nothing (`calls/calls.test.ts`).
  The socket also needs the call's one-use ticket (tested: wrong, reused).
- **A stranger who knows the number**: hears one sentence. Tested: no turn,
  no request.
- **Someone faking the owner's caller ID** (NIST SP 800-63B-4 treats the
  phone network as a restricted channel for exactly this reason). Faking a
  caller ID is easy, and most calls carry no verdict at all, while in Auto
  reads don't ask (ADR 0100): the first version, which let the owner's
  number in unless the verdict said Failed, let a faker ask "read my latest
  email" and hear the answer. Now the owner's number alone gets nothing:
  only full attestation (A) or the call passcode does. Attestation A means
  the originating carrier authenticated the customer and their right to the
  number (ATIS-1000074 SHAKEN); B and C don't, so they're asked. What the
  passcode protects is guessed at most three times a call and five times a
  day: with a million or more passcodes, a faker's chance is at most 5 in a
  million a day, and the first lock tells the owner. Tested: Passed-A
  without a passcode gets the assistant; Passed-B, Passed-C, none and
  No-TN-Validation without one hang up; the right passcode gets it; three
  wrong ones hang up, five lock the day and text the owner; the hash and the
  digits never reach the page, an event or `channels.json`; the compare is
  `timingSafeEqual` (`calls/phone.test.ts`, `calls/calls.test.ts`). After
  that, what's said is still read as untrusted words, so Auto still asks
  about steps that matter after reading (ADR 0028, ADR 0117), and **a call
  to Conch never allows anything**: questions go by text, or ring the real
  owner from Conch. Someone who has the owner's phone, or saw the passcode,
  can still ask questions and hear answers; the security checkup says so,
  and calls are off by default.
- **The passcode itself** crosses Twilio (its keys are a `Digits` field in a
  signed webhook) and may sit in Twilio's request logs for the account, as
  any keypad entry does. Conch never logs it, never keeps it, and keeps no
  copy it could show. It's a second factor against a faked caller ID, not a
  secret from the phone company.
- **Someone near the owner's phone** when Conch rings could press 1: it's
  exactly what a lock-screen tap could allow, no more.
- **Prompt injection in the spoken words** (Greshake et al., 2023): what's
  said is a person's untrusted words, never an instruction to Conch; what's
  spoken back is escaped into TwiML (`calls/twiml.ts`), so an answer can't
  become `<Dial>`.
- **Cost**: `TimeLimit`, `maxMinutes`, `perDay`, one call at a time, and an
  idle line put down. Following OWASP ASVS 5.0's guidance on webhooks
  (authenticate the sender, bind to the expected resource, limit rate) and
  the door's existing per-address limit.

## Consequences

- Hands-free works on any phone with no app; with Conch's own voice set up,
  what's said on a call is heard on this computer. Twilio still carries the
  call itself, as any phone company would.
- Without private dictation and a natural voice, Twilio's recognizer hears
  the call: the guide says so.
- The assistant isn't told it's on a call beyond the word "phone call" in
  where the words came from; long answers are cut when spoken ("the rest is
  in Conch").
- The voice approval's "yes" goes through Twilio's recognizer (the keypad
  doesn't): an unclear or long answer allows nothing.
- To verify on a real number: Twilio's signature on the Media Streams
  handshake (if it were missing, calls would fall back to Gather, which is
  safe), and barge-in thresholds on a noisy line.
- A call that isn't fully vouched for costs a few seconds of keypad first.
  Outside the US, where `StirVerstat` is rarely sent, every call asks for the
  passcode; the page says to set one so calls always work.
