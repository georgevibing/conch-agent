# 0072 — Every model gets its tools

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0050](./0050-models-that-cannot-use-apps.md) (what "chat only" means for a
  turn), [ADR 0036](./0036-provider-consistency.md) (a model without tools got none)
- Goes with: [ADR 0053](./0053-more-providers.md) (one adapter for every chat API),
  [ADR 0055](./0055-long-chats-on-every-model.md) (fitting the window)

## Context

Conch's promise is that apps, memory, files and the browser work on every model. In practice
tool calling failed on weak models and odd providers in five ways:

- **Errors a model couldn't act on.** A call that missed the schema got "The tool arguments
  do not match its schema." Bad JSON got "call again". A small model tried the same thing
  again, or gave up.
- **Slips nobody forgave.** `"3"` for a number, `"true"` for a boolean, a trailing comma, a
  fence around the JSON, `[ref=e12]` copied from the page text. Each one was a refused call.
- **Schemas a provider refused.** MCP servers send `$ref`, `$defs`, `anyOf` with `null`,
  `additionalProperties`, formats. Gemini's OpenAI endpoint refuses the whole request over
  one of them. Worse, the refusal's words ("… is not supported") matched the check for "this
  model can't use tools", so every tool was dropped for the rest of the session.
- **No tools at all.** A model the provider listed without tools, or that refused them, went
  chat-only, though many small models (Qwen, Llama, Gemma, Hermes) follow a tool format in
  words well.
- **OpenRouter's short list.** Tool support was read from the picker's first 60 models, so a
  chat on any other model, or one whose list failed to load, was chat-only (`?? false`),
  against ADR 0050's "unknown counts as able".

Hermes Agent repairs malformed calls; OpenClaw has a lean mode for weak models. Neither
gives a model that can't call tools natively its tools.

## Decision

**Arguments are read forgivingly and checked strictly** (`engines/tools/args.ts`). Every
engine that runs Conch's tools for a model reads a call the same way: the model APIs,
Codex's dynamic tools and the door ACP programs reach (all through `buildTools`), and
Claude Code's in-process server (its shape is advertised unchanged through Zod metadata,
`lenientShape`, so Conch's check sees the call instead of the SDK refusing it).

1. **Read.** Almost-JSON is mended by a small in-house reader (`repair.ts`): trailing commas,
   single quotes, bare keys, Python's `True`/`None`, comments, a fence, an unclosed brace or
   string, a few objects run together (pieces of one call are joined; different calls keep
   the first, and the model is told). Arguments sent as a JSON string, or inside an
   `{"arguments": …}` envelope the tool doesn't take, are unwrapped. No dependency: the
   repairs are few, the reader is about 300 lines, and owning it means owning its limits
   (size, depth, no evaluation, `__proto__` as a plain key).
2. **Normalise**, guided only by the tool's own schema: a field it doesn't take is dropped
   and named in the result; `"3"` becomes 3 where a number is wanted; exactly `"true"` or
   `"false"` becomes a boolean; a list or object sent as JSON text is read; one value where
   a list is wanted becomes a list of one; an option in the wrong case is the option when
   only one matches. Browser refs copied as `[ref=e12]`, `ref=e12` or `e12]` are unwrapped
   (`unwrapRef`) and must still be a bare ref.
3. **Check** the tool's strict schema, as before. When it fails, the model reads each field,
   what was wanted, what it sent and the valid values, then a one-line signature:

   ```
   The arguments for search_mail don’t fit. Fix these and call it again:
   - query: required (text), but it was missing.
   - limit: expected a number, got the text "ten".
   It takes: {query: string, limit?: integer, order?: "newest"|"oldest"}
   ```

   An integration's tool is checked only for the plain mistakes (a required field missing,
   a wrong type, an option that isn't one) where its schema says so simply; anything else is
   left to its server, so a valid call is never refused by Conch.

Nothing here widens what a call may do: the normalised call passes the same strict check,
the guard and every permission see exactly what runs, no text is rewritten, no value is
invented, and an unknown field never reaches the tool. The abuse tests in `args.test.ts`,
`repair.test.ts` and `browser/ref.test.ts` hold each of these.

**Each provider family gets the schema in its dialect** (`engines/api/schemas.ts`,
`Wire.schemaFamily`): `gemini` for Gemini's endpoint and Google models at OpenRouter (the
OpenAPI subset: references inlined with limits, `null` branches as `nullable`, options as
text, every node typed, unknown keywords dropped, a default or format kept in the
description), `anthropic` for Anthropic (one object at the root), `permissive` for the rest
(as sent). OpenAI's strict mode isn't used anywhere, so it has no dialect.

**A refusal over tools is classified, never a reason to drop them** (`refusals.ts`). Schema
words are read first: a refused schema is an `ApiError` of kind `schema`, and the engine
sends the request again once with the `strict` dialect (type, description, enum, items,
properties, required). A model that takes no tools (Ollama's "does not support tools",
OpenRouter's "No endpoints found that support tool use") is kind `tools`. Both are healed
before the model has said a word, and what each model taught is remembered for later turns.

**A model that can't take tools natively gets them in words** (`prompted.ts`, `toolplan.ts`).
When the provider says a model has no tools, or refuses them, or refuses even the strict
schemas, the tools are listed in the system prompt, one line each, and the model asks in the
format Hermes and Qwen models are trained on:

```
<tool_call>
{"name": "remember", "arguments": {"content": "Likes tea"}}
</tool_call>
```

The reader also takes what small models drift into: the same JSON in a fence (only when it
names a tool), Llama's `<function=name>{…}</function>`, Qwen-Coder's `<parameter=…>` lines, a
reply that is only the call's JSON, `"parameters"` for `"arguments"`. It reads the stream as
it comes: words go out at once, a call is held until it closes, code fences pass through
untouched, and a `<tool_response>` the model writes itself is never shown or believed. A
block it can't read becomes a failed call that says how to write one. Answers go back as the
next user message, in `<tool_response>` blocks that a tool's own text can't close. Earlier
native calls in the transcript are shown in the same words; the transcript itself is kept
as it was.

The list is as long as the window allows: full descriptions in 15% of it, first sentences
in 25%, names and arguments in 40%. **Chat-only is what's left**: only a model whose window
can't hold even the shortest list goes without tools, and only then does the chat say so.

**OpenRouter knows every model** (`OpenRouterWire.toolsFor`). Tool support comes from the
whole catalogue the last list read, not the picker's 60. A model it doesn't have, or a list
that never came, is looked up in the public catalogue (kept 30 minutes, one lookup at a
time, not retried for every turn after a failure). Unknown counts as able, as ADR 0050 says:
a model that then refuses tools gets them in words.

## Consequences

- A tool's pictures go in words to a model using its tools in words, whose answers are text
  ([ADR 0070](./0070-every-model-sees-the-page.md)'s describer), even when the model can see.
- `ApiErrorKind` gains `schema` and `tools`. `Wire.toolsFor` may be async; `Wire.schemaFamily`
  is new. The `no-tools` notice is gone: tools are never dropped silently.
- The picker's **Chat only — can't use your apps** badge and ADR 0050's switch offer still
  follow `ModelInfo.tools` (native tool calling), so a message that needs an app is still
  offered a model made for tools. **Answer without it** now gets tools in words rather than
  none. Whether the badge's words should change for these models is left to a later change
  in Nacre, the web app and the e2e journey together.
- Prompted calling depends on the model following instructions. It was checked with
  `qwen3:4b-instruct` on Ollama, natively and with tools refused by the server: both
  remembered a fact and called a three-argument tool correctly. Very small models (1B) will
  still fumble; the precise errors give them a second chance.
- Tests: `engines/tools/{repair,args}.test.ts`, `engines/api/{schemas,refusals,prompted,
toolmodes}.test.ts` (a fake-fetch matrix: a model past the top 60, a failed list, the public
  lookup, OpenRouter's 404, Gemini's schema refusal and the strict retry, tools in words end
  to end), `browser/ref.test.ts`.
